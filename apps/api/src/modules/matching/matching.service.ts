import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import {
  DRIVER_ACTIVE_STATUSES,
  MAX_OFFER_ATTEMPTS,
  SEARCH_RADII_M,
  type OfferAck,
  type OfferRejectReason,
  type VehicleType,
} from '@rideloc/shared';
import type { Database } from '../../db/types';
import { isUniqueViolation } from '../../lib/errors';
import type { MinimalLogger } from '../../lib/logger';
import { MATCHING, REDIS_KEYS } from '../../lib/redis-keys';
import { assertTransition } from '../rides/transition';
import { parseGeoSearchWithDist, type GeoCandidate } from './geo-candidates';
import type { Notifier } from './notifier';

/** Deletes a key only if it still belongs to us (compare-and-delete, atomic). */
const RELEASE_IF_OWNER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

class RideUnavailableError extends Error {}

interface SearchingRide {
  id: string;
  rider_id: string;
  vehicle_type: VehicleType;
  fare_idr: number;
  distance_m: number;
  age_s: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
}

type OfferResult = 'offered' | 'changed' | 'skip';

export interface MatchingDeps {
  db: Kysely<Database>;
  redis: Redis;
  notifier: Notifier;
  logger: MinimalLogger;
  offerTtlS: number;
  searchTimeoutS: number;
}

export function createMatchingService({
  db,
  redis,
  notifier,
  logger,
  offerTtlS,
  searchTimeoutS,
}: MatchingDeps) {
  async function releaseKey(key: string, owner: string): Promise<void> {
    try {
      await redis.eval(RELEASE_IF_OWNER, 1, key, owner);
    } catch (err) {
      logger.warn({ err, key }, 'failed to release redis key'); // it expires on its own
    }
  }

  async function geoSearch(lng: number, lat: number, radiusM: number): Promise<GeoCandidate[]> {
    const raw = await redis.call(
      'GEOSEARCH',
      REDIS_KEYS.geo,
      'FROMLONLAT',
      String(lng),
      String(lat),
      'BYRADIUS',
      String(radiusM),
      'm',
      'ASC',
      'COUNT',
      String(MATCHING.CANDIDATES_PER_SCAN),
      'WITHDIST',
    );
    return parseGeoSearchWithDist(raw);
  }

  /** Online, alive, not busy, not currently holding another offer, and the right vehicle. */
  async function filterEligible(
    candidates: GeoCandidate[],
    vehicleType: VehicleType,
  ): Promise<GeoCandidate[]> {
    if (candidates.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const c of candidates) {
      pipeline.exists(REDIS_KEYS.online(c.driverId));
      pipeline.exists(REDIS_KEYS.heartbeat(c.driverId));
      pipeline.exists(REDIS_KEYS.busy(c.driverId));
      pipeline.exists(REDIS_KEYS.offerLock(c.driverId));
    }
    const results = await pipeline.exec();
    if (!results) return [];

    // A failed check means "unknown": treat the driver as not eligible this round.
    const flag = (i: number, k: number): number | null => {
      const r = results[i * 4 + k];
      return r && !r[0] ? Number(r[1]) : null;
    };
    const alive = candidates.filter(
      (_, i) => flag(i, 0) === 1 && flag(i, 1) === 1 && flag(i, 2) === 0 && flag(i, 3) === 0,
    );
    if (alive.length === 0) return [];

    const rows = await db
      .selectFrom('drivers')
      .select('user_id')
      .where(
        'user_id',
        'in',
        alive.map((c) => c.driverId),
      )
      .where('vehicle_type', '=', vehicleType)
      .where('is_online', '=', true)
      .execute();
    const allowed = new Set(rows.map((r) => r.user_id));
    return alive.filter((c) => allowed.has(c.driverId));
  }

  async function isStillAvailable(driverId: string): Promise<boolean> {
    const pipeline = redis.pipeline();
    pipeline.exists(REDIS_KEYS.online(driverId));
    pipeline.exists(REDIS_KEYS.heartbeat(driverId));
    pipeline.exists(REDIS_KEYS.busy(driverId));
    const results = await pipeline.exec();
    if (!results) return false;
    const value = (i: number): number | null => {
      const r = results[i];
      return r && !r[0] ? Number(r[1]) : null;
    };
    return value(0) === 1 && value(1) === 1 && value(2) === 0;
  }

  /** Tries to create the (single) pending offer for this ride, addressed to this driver. */
  async function offerTo(ride: SearchingRide, cand: GeoCandidate): Promise<OfferResult> {
    const lockKey = REDIS_KEYS.offerLock(cand.driverId);

    // LAYER 0: one pending offer per driver. The value is the ride id so only the owner releases it.
    const got = await redis.set(
      lockKey,
      ride.id,
      'PX',
      (offerTtlS + MATCHING.OFFER_LOCK_GRACE_S) * 1000,
      'NX',
    );
    if (got !== 'OK') return 'skip';

    // Re-check after locking: the driver may have gone offline or busy since the scan.
    if (!(await isStillAvailable(cand.driverId))) {
      await releaseKey(lockKey, ride.id);
      return 'skip';
    }

    let expiresAt: Date | null;
    try {
      expiresAt = await db.transaction().execute(async (trx): Promise<Date | null> => {
        // RISKY (race condition): serialize every advance of this ride on its row.
        const locked = await trx
          .selectFrom('rides')
          .select('status')
          .where('id', '=', ride.id)
          .forUpdate()
          .executeTakeFirst();
        if (!locked || locked.status !== 'SEARCHING') return null;

        const pending = await trx
          .selectFrom('ride_offers')
          .select('id')
          .where('ride_id', '=', ride.id)
          .where('outcome', 'is', null)
          .executeTakeFirst();
        if (pending) return null;

        const made = await trx
          .selectFrom('ride_offers')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('ride_id', '=', ride.id)
          .executeTakeFirstOrThrow();
        if (made.n >= MAX_OFFER_ATTEMPTS) return null;

        const row = await trx
          .insertInto('ride_offers')
          .values({
            ride_id: ride.id,
            driver_id: cand.driverId,
            distance_m: cand.distanceM,
            expires_at: sql<Date>`now() + ${offerTtlS}::int * interval '1 second'`,
          })
          .returning('expires_at')
          .executeTakeFirstOrThrow();
        return row.expires_at;
      });
    } catch (err) {
      await releaseKey(lockKey, ride.id);
      // A unique index fired: another advance already offered this ride. Stop; the next round re-reads.
      if (isUniqueViolation(err)) return 'changed';
      throw err;
    }

    if (!expiresAt) {
      await releaseKey(lockKey, ride.id);
      return 'changed';
    }

    notifier.offerNew(cand.driverId, {
      rideId: ride.id,
      pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng },
      dropoff: { lat: ride.dropoff_lat, lng: ride.dropoff_lng },
      fareIdr: ride.fare_idr,
      distanceM: ride.distance_m,
      pickupDistanceM: cand.distanceM,
      expiresAt: expiresAt.toISOString(),
    });
    return 'offered';
  }

  async function offerToNearest(
    ride: SearchingRide,
    offered: ReadonlySet<string>,
  ): Promise<'offered' | 'changed' | 'none'> {
    for (const radiusM of SEARCH_RADII_M) {
      const near = await geoSearch(ride.pickup_lng, ride.pickup_lat, radiusM);
      const fresh = near.filter((c) => !offered.has(c.driverId));
      for (const cand of await filterEligible(fresh, ride.vehicle_type)) {
        const result = await offerTo(ride, cand);
        if (result !== 'skip') return result;
      }
    }
    return 'none';
  }

  async function failSearch(rideId: string, riderId: string): Promise<void> {
    const changed = await db.transaction().execute(async (trx): Promise<boolean> => {
      const locked = await trx
        .selectFrom('rides')
        .select('status')
        .where('id', '=', rideId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked || locked.status !== 'SEARCHING') return false;

      const pending = await trx
        .selectFrom('ride_offers')
        .select('id')
        .where('ride_id', '=', rideId)
        .where('outcome', 'is', null)
        .executeTakeFirst();
      if (pending) return false; // an offer is in flight: do not fail the search under it

      assertTransition('SEARCHING', 'NO_DRIVER_FOUND');
      await trx
        .updateTable('rides')
        .set({ status: 'NO_DRIVER_FOUND' })
        .where('id', '=', rideId)
        .execute();
      return true;
    });
    if (changed) notifier.rideUpdated(riderId, { rideId, status: 'NO_DRIVER_FOUND' });
  }

  /**
   * Idempotent: safe to call from the request path, from a reject, and from the tick at the same time.
   * It either creates the next offer, finishes the search, or does nothing.
   */
  async function advance(rideId: string): Promise<void> {
    const ride = await db
      .selectFrom('rides')
      .select([
        'id',
        'rider_id',
        'vehicle_type',
        'fare_idr',
        'distance_m',
        sql<number>`extract(epoch from now() - requested_at)::float8`.as('age_s'),
        sql<number>`ST_Y(pickup::geometry)`.as('pickup_lat'),
        sql<number>`ST_X(pickup::geometry)`.as('pickup_lng'),
        sql<number>`ST_Y(dropoff::geometry)`.as('dropoff_lat'),
        sql<number>`ST_X(dropoff::geometry)`.as('dropoff_lng'),
      ])
      .where('id', '=', rideId)
      .where('status', '=', 'SEARCHING')
      .executeTakeFirst();
    if (!ride) return;

    const offers = await db
      .selectFrom('ride_offers')
      .select(['driver_id', 'outcome'])
      .where('ride_id', '=', rideId)
      .execute();
    if (offers.some((o) => o.outcome === null)) return; // an offer is in flight

    if (offers.length >= MAX_OFFER_ATTEMPTS) {
      await failSearch(ride.id, ride.rider_id);
      return;
    }

    const outcome = await offerToNearest(ride, new Set(offers.map((o) => o.driver_id)));
    if (outcome === 'none' && ride.age_s >= searchTimeoutS) {
      await failSearch(ride.id, ride.rider_id);
    }
  }

  async function missingOfferReason(driverId: string, rideId: string): Promise<OfferRejectReason> {
    const offer = await db
      .selectFrom('ride_offers')
      .select('outcome')
      .where('ride_id', '=', rideId)
      .where('driver_id', '=', driverId)
      .executeTakeFirst();
    if (!offer) return 'OFFER_NOT_FOUND';
    // Pending but not answerable => it expired. Already answered => nothing to answer.
    return offer.outcome === null || offer.outcome === 'TIMEOUT'
      ? 'OFFER_EXPIRED'
      : 'OFFER_NOT_FOUND';
  }

  /** If the unique index had to stop a double assignment, the Redis busy flag was wrong: fix it. */
  async function healBusyFlag(driverId: string, tempOwner: string): Promise<void> {
    try {
      const active = await db
        .selectFrom('rides')
        .select('id')
        .where('driver_id', '=', driverId)
        .where('status', 'in', [...DRIVER_ACTIVE_STATUSES])
        .executeTakeFirst();
      if (active) {
        await redis.set(REDIS_KEYS.busy(driverId), active.id, 'EX', MATCHING.BUSY_TTL_S);
        await redis.zrem(REDIS_KEYS.geo, driverId);
      } else {
        await releaseKey(REDIS_KEYS.busy(driverId), tempOwner);
      }
    } catch (err) {
      logger.warn({ err, driverId }, 'failed to heal busy flag');
    }
  }

  async function acceptOffer(driverId: string, rideId: string): Promise<OfferAck> {
    if ((await redis.exists(REDIS_KEYS.online(driverId))) !== 1) {
      return { ok: false, reason: 'DRIVER_OFFLINE' };
    }

    // LAYER 1: claim the busy flag. Only one concurrent acceptance can win this.
    const claimed = await redis.set(
      REDIS_KEYS.busy(driverId),
      rideId,
      'EX',
      MATCHING.BUSY_TTL_S,
      'NX',
    );
    if (claimed !== 'OK') return { ok: false, reason: 'DRIVER_BUSY' };

    let riderId: string | null;
    try {
      riderId = await db.transaction().execute(async (trx): Promise<string | null> => {
        // LAYER 2: conditional UPDATEs. The offer must be this driver's, unanswered, and not expired.
        const offer = await trx
          .updateTable('ride_offers')
          .set({ outcome: 'ACCEPTED', responded_at: sql<Date>`now()` })
          .where('ride_id', '=', rideId)
          .where('driver_id', '=', driverId)
          .where('outcome', 'is', null)
          .where('expires_at', '>', sql<Date>`now()`)
          .returning('id')
          .executeTakeFirst();
        if (!offer) return null;

        assertTransition('SEARCHING', 'DRIVER_ASSIGNED');
        const ride = await trx
          .updateTable('rides')
          .set({ status: 'DRIVER_ASSIGNED', driver_id: driverId, accepted_at: sql<Date>`now()` })
          .where('id', '=', rideId)
          .where('status', '=', 'SEARCHING')
          .where('driver_id', 'is', null)
          .returning('rider_id')
          .executeTakeFirst();
        // Throwing rolls back the offer update above: it must stay unanswered.
        if (!ride) throw new RideUnavailableError();
        return ride.rider_id;
      });
    } catch (err) {
      // LAYER 3 fired: the partial unique index stopped a second active ride for this driver.
      if (isUniqueViolation(err)) {
        logger.error(
          { driverId },
          'unique index stopped a double assignment: busy flag was missing',
        );
        await healBusyFlag(driverId, rideId);
        return { ok: false, reason: 'DRIVER_BUSY' };
      }
      await releaseKey(REDIS_KEYS.busy(driverId), rideId);
      await releaseKey(REDIS_KEYS.offerLock(driverId), rideId);
      if (err instanceof RideUnavailableError) return { ok: false, reason: 'RIDE_UNAVAILABLE' };
      throw err;
    }

    if (riderId === null) {
      await releaseKey(REDIS_KEYS.busy(driverId), rideId);
      await releaseKey(REDIS_KEYS.offerLock(driverId), rideId);
      return { ok: false, reason: await missingOfferReason(driverId, rideId) };
    }

    // Committed. The rest is best effort: a failure here must not undo the assignment.
    try {
      await redis.zrem(REDIS_KEYS.geo, driverId); // no longer matchable
      await releaseKey(REDIS_KEYS.offerLock(driverId), rideId);
    } catch (err) {
      logger.warn({ err, driverId }, 'post-accept cleanup failed');
    }
    notifier.rideUpdated(riderId, { rideId, status: 'DRIVER_ASSIGNED' });
    return { ok: true, accepted: true };
  }

  async function rejectOffer(driverId: string, rideId: string): Promise<OfferAck> {
    const rows = await db
      .updateTable('ride_offers')
      .set({ outcome: 'REJECTED', responded_at: sql<Date>`now()` })
      .where('ride_id', '=', rideId)
      .where('driver_id', '=', driverId)
      .where('outcome', 'is', null)
      .returning('id')
      .execute();
    if (rows.length === 0) return { ok: false, reason: await missingOfferReason(driverId, rideId) };

    await releaseKey(REDIS_KEYS.offerLock(driverId), rideId);
    void advance(rideId).catch((err: unknown) =>
      logger.error({ err }, 'advance after reject failed'),
    );
    return { ok: true, accepted: false };
  }

  return {
    advance,

    /** Called by the driver (socket) with the decision on the offer. */
    respond(driverId: string, rideId: string, accept: boolean): Promise<OfferAck> {
      return accept ? acceptOffer(driverId, rideId) : rejectOffer(driverId, rideId);
    },

    /** One matching round: expire stale offers, then push idle searching rides forward. */
    async tick(): Promise<{ expired: number; advanced: number }> {
      const expired = await db
        .updateTable('ride_offers')
        .set({ outcome: 'TIMEOUT', responded_at: sql<Date>`now()` })
        .where('outcome', 'is', null)
        .where('expires_at', '<=', sql<Date>`now()`)
        .returning(['ride_id', 'driver_id'])
        .execute();
      await Promise.allSettled(
        expired.map((o) => releaseKey(REDIS_KEYS.offerLock(o.driver_id), o.ride_id)),
      );

      const idle = await sql<{ id: string }>`
        select r.id from rides r
        where r.status = 'SEARCHING'
          and not exists (select 1 from ride_offers o where o.ride_id = r.id and o.outcome is null)
        order by r.requested_at
        limit 100`.execute(db);

      const ids = idle.rows.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 10) {
        await Promise.allSettled(
          ids
            .slice(i, i + 10)
            .map((id) =>
              advance(id).catch((err: unknown) => logger.error({ err }, 'advance failed')),
            ),
        );
      }
      return { expired: expired.length, advanced: ids.length };
    },
  };
}

export type MatchingService = ReturnType<typeof createMatchingService>;
