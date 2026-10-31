import { sql, type Kysely } from 'kysely';
import type { CreateRideRequest, LatLng, RideDto } from '@rideloc/shared';
import type { Database } from '../../db/types';
import { AppError, isUniqueViolation } from '../../lib/errors';
import type { MinimalLogger } from '../../lib/logger';
import type { MatchingService } from '../matching/matching.service';
import type { EstimateService } from './estimate.service';
import { assertTransition } from './transition';

export interface RidesServiceDeps {
  db: Kysely<Database>;
  estimate: EstimateService;
  matching: Pick<MatchingService, 'advance'>;
  logger: MinimalLogger;
}

const point = (p: LatLng) =>
  sql<string>`ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326)::geography`;

export function createRidesService({ db, estimate, matching, logger }: RidesServiceDeps) {
  return {
    async create(riderId: string, input: CreateRideRequest): Promise<RideDto> {
      // The fare is computed HERE, from the route, and nothing from the client is trusted (ADR-018).
      const est = await estimate.estimate({
        pickup: input.pickup,
        dropoff: input.dropoff,
        vehicleType: input.vehicleType,
      });

      let created: { id: string; requested_at: Date };
      try {
        created = await db.transaction().execute(async (trx) => {
          const inserted = await trx
            .insertInto('rides')
            .values({
              rider_id: riderId,
              status: 'REQUESTED',
              vehicle_type: input.vehicleType,
              pickup: point(input.pickup),
              pickup_address: input.pickupAddress ?? null,
              dropoff: point(input.dropoff),
              dropoff_address: input.dropoffAddress ?? null,
              distance_m: est.distanceM,
              duration_s: est.durationS,
              fare_idr: est.fareIdr,
              route_polyline: est.polyline,
            })
            .returning(['id', 'requested_at'])
            .executeTakeFirstOrThrow();

          assertTransition('REQUESTED', 'SEARCHING');
          await trx
            .updateTable('rides')
            .set({ status: 'SEARCHING' })
            .where('id', '=', inserted.id)
            .where('status', '=', 'REQUESTED')
            .execute();
          return inserted;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'RIDER_HAS_ACTIVE_RIDE', 'You already have an active ride');
        }
        throw err;
      }

      // Start matching right away (NFR: first offer in < 3 s). The tick is the safety net.
      void matching
        .advance(created.id)
        .catch((err: unknown) => logger.error({ err }, 'initial matching failed'));

      return {
        id: created.id,
        status: 'SEARCHING',
        vehicleType: input.vehicleType,
        pickup: input.pickup,
        dropoff: input.dropoff,
        pickupAddress: input.pickupAddress ?? null,
        dropoffAddress: input.dropoffAddress ?? null,
        distanceM: est.distanceM,
        durationS: est.durationS,
        fareIdr: est.fareIdr,
        polyline: est.polyline,
        requestedAt: created.requested_at.toISOString(),
      };
    },
  };
}

export type RidesService = ReturnType<typeof createRidesService>;
