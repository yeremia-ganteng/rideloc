import type { Estimate, EstimateRequest, PricingConfig } from '@rideloc/shared';
import { haversineMeters } from '../../lib/geo';
import { AppError } from '../../lib/errors';
import { calculateFare } from '../pricing/fare';
import { estimateFallback } from '../routing/fallback';
import type { RouteResult, RoutingClient } from '../routing/types';

export interface EstimateServiceDeps {
  routing: RoutingClient;
  pricing: PricingConfig;
  maxTripKm: number;
  logger: { warn: (obj: object, msg: string) => void };
}

export function createEstimateService({
  routing,
  pricing,
  maxTripKm,
  logger,
}: EstimateServiceDeps) {
  return {
    async estimate(input: EstimateRequest): Promise<Estimate> {
      // Cheap guard BEFORE calling the external routing service.
      if (haversineMeters(input.pickup, input.dropoff) > maxTripKm * 1000) {
        throw new AppError(422, 'TRIP_TOO_LONG', `Trip distance exceeds the ${maxTripKm} km limit`);
      }

      let route: RouteResult;
      let source: Estimate['source'];
      try {
        route = await routing.route(input.pickup, input.dropoff);
        source = 'osrm';
      } catch (err) {
        logger.warn({ err }, 'routing failed, using fallback estimate');
        route = { ...estimateFallback(input.pickup, input.dropoff), polyline: null };
        source = 'fallback';
      }

      return {
        vehicleType: input.vehicleType,
        distanceM: route.distanceM,
        durationS: route.durationS,
        fareIdr: calculateFare(route, pricing[input.vehicleType]),
        polyline: route.polyline,
        source,
      };
    },
  };
}

export type EstimateService = ReturnType<typeof createEstimateService>;
