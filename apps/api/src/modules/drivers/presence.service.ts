import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { MAX_LOCATION_ACCURACY_M, type DriverLocation, type LocationAck } from '@rideloc/shared';
import type { Database } from '../../db/types';
import { AppError } from '../../lib/errors';
import type { MinimalLogger } from '../../lib/logger';
import { PRESENCE, REDIS_KEYS } from '../../lib/redis-keys';

/**
 * RISKY (race condition): everything that decides "is this driver in the GEO set" runs
 * inside ONE atomic script, so a concurrent offline cannot be undone by a late location.
 *
 * KEYS: 1 online, 2 busy, 3 geo, 4 heartbeat
 * ARGV: 1 lng, 2 lat, 3 driverId, 4 heartbeat ttl, 5 online ttl
 * Returns: 0 not online, 1 added to GEO, 2 driver is busy (removed from GEO)
 */
const LOCATION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
redis.call('SET', KEYS[4], '1', 'EX', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
if redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('ZREM', KEYS[3], ARGV[3])
  return 2
end
redis.call('GEOADD', KEYS[3], ARGV[1], ARGV[2], ARGV[3])
return 1
`;

export interface PresenceDeps {
  redis: Redis;
  db: Kysely<Database>;
  logger: MinimalLogger;
}

export interface SweepResult {
  removedFromGeo: number;
  markedOffline: number;
}

export function createPresenceService({ redis, db, logger }: PresenceDeps) {
  async function persistLocation(driverId: string, loc: DriverLocation): Promise<void> {
    const throttleKey = REDIS_KEYS.persistThrottle(driverId);
    try {
      const first = await redis.set(throttleKey, '1', 'EX', PRESENCE.PERSIST_INTERVAL_S, 'NX');
      if (first !== 'OK') return; // saved less than 30s ago
      try {
        await sql`
          UPDATE drivers
          SET last_location = ST_SetSRID(ST_MakePoint(${loc.lng}::float8, ${loc.lat}::float8), 4326)::geography,
              last_seen_at = now()
          WHERE user_id = ${driverId}`.execute(db);
      } catch (err) {
        await redis.del(throttleKey); // let the next update retry
        throw err;
      }
    } catch (err) {
      // The live position (Redis) is already updated. A failed backup write must not fail the update.
      logger.warn({ err, driverId }, 'failed to persist last_location');
    }
  }

  return {
    async goOnline(driverId: string): Promise<void> {
      const res = await db
        .updateTable('drivers')
        .set({ is_online: true, last_seen_at: new Date() })
        .where('user_id', '=', driverId)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');
      }
      await redis.set(REDIS_KEYS.online(driverId), '1', 'EX', PRESENCE.ONLINE_TTL_S);
    },

    /** TODO Phase 4: refuse to go offline while the driver has an active ride (busy key). */
    async goOffline(driverId: string): Promise<void> {
      // A driver in the middle of a ride cannot disappear.
      const active = await sql<{ n: number }>`
        select count(*)::int as n from rides
        where driver_id = ${driverId}
          and status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS')`.execute(
        db,
      );
      if ((active.rows[0]?.n ?? 0) > 0) {
        throw new AppError(
          409,
          'DRIVER_HAS_ACTIVE_RIDE',
          'Finish your current ride before going offline',
        );
      }

      await db
        .updateTable('drivers')
        .set({ is_online: false })
        .where('user_id', '=', driverId)
        .execute();
      const results = await redis
        .multi()
        .del(REDIS_KEYS.online(driverId), REDIS_KEYS.heartbeat(driverId))
        .zrem(REDIS_KEYS.geo, driverId)
        .exec();
      if (!results || results.some(([err]) => err)) {
        throw new Error('failed to clear driver presence in Redis');
      }
    },

    async updateLocation(driverId: string, loc: DriverLocation): Promise<LocationAck> {
      if (loc.accuracy > MAX_LOCATION_ACCURACY_M) return { ok: false, reason: 'LOW_ACCURACY' };

      // Contoh di updateLocation:
      const raw = await redis.eval(
        LOCATION_SCRIPT,
        '4', // ← ubah dari number ke string
        REDIS_KEYS.online(driverId),
        REDIS_KEYS.busy(driverId),
        REDIS_KEYS.geo,
        REDIS_KEYS.heartbeat(driverId),
        String(loc.lng),
        String(loc.lat),
        String(driverId),
        String(PRESENCE.HEARTBEAT_TTL_S),
        String(PRESENCE.ONLINE_TTL_S),
      );
      const code = Number(raw);
      if (code === 0) return { ok: false, reason: 'NOT_ONLINE' };

      await persistLocation(driverId, loc);
      return { ok: true, availability: code === 2 ? 'BUSY' : 'AVAILABLE' };
    },

    /** Removes "ghost" drivers: in GEO without a heartbeat, or online in the DB but long silent. */
    async sweepGhosts(): Promise<SweepResult> {
      let removedFromGeo = 0;

      const members = await redis.zrange(REDIS_KEYS.geo, 0, '-1');
      if (members.length > 0) {
        const pipeline = redis.pipeline();
        for (const id of members) pipeline.exists(REDIS_KEYS.heartbeat(id));
        const results = await pipeline.exec();
        if (!results) throw new Error('heartbeat check returned no result');

        const stale: string[] = [];
        members.forEach((id, i) => {
          const [err, exists] = results[i] ?? [new Error('missing result'), null];
          // On error we do NOT know the driver is dead: keep them, the next sweep retries.
          if (!err && exists !== 1) stale.push(id);
        });
        if (stale.length > 0) removedFromGeo = await redis.zrem(REDIS_KEYS.geo, ...stale);
      }

      const cutoff = new Date(Date.now() - PRESENCE.ONLINE_TTL_S * 1000);
      const res = await db
        .updateTable('drivers')
        .set({ is_online: false })
        .where('is_online', '=', true)
        .where('last_seen_at', '<', cutoff)
        .executeTakeFirst();

      return { removedFromGeo, markedOffline: Number(res.numUpdatedRows) };
    },
  };
}

export type PresenceService = ReturnType<typeof createPresenceService>;
