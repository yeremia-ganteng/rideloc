import { z } from 'zod';
import { VehicleTypeSchema } from './auth';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLngSchema>;

export const EstimateRequestSchema = z.object({
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  vehicleType: VehicleTypeSchema,
});
export type EstimateRequest = z.infer<typeof EstimateRequestSchema>;

export const EstimateSourceSchema = z.enum(['osrm', 'fallback']);

export const EstimateSchema = z.object({
  vehicleType: VehicleTypeSchema,
  distanceM: z.number().int().nonnegative(),
  durationS: z.number().int().nonnegative(),
  fareIdr: z.number().int().nonnegative(),
  /** Google encoded polyline, precision 5 (OSRM default). Null when the fallback was used. */
  polyline: z.string().nullable(),
  source: EstimateSourceSchema,
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const EstimateResponseSchema = z.object({ estimate: EstimateSchema });
export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;
