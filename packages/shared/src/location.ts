import { z } from 'zod';

/** Fixes with a worse accuracy than this (in meters) are discarded. */
export const MAX_LOCATION_ACCURACY_M = 50;

/** Redis GEO rejects latitudes beyond this (Web Mercator limit). */
const GEO_MAX_LAT = 85.05112878;

export const DriverLocationSchema = z.object({
  lat: z.number().min(-GEO_MAX_LAT).max(GEO_MAX_LAT),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).max(100_000),
});
export type DriverLocation = z.infer<typeof DriverLocationSchema>;
