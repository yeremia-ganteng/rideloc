import type { LatLng } from '@rideloc/shared';
import { haversineMeters } from '../../lib/geo';

export const FALLBACK_ROAD_FACTOR = 1.3;
export const FALLBACK_SPEED_KMH = 25;

/** Straight-line distance x 1.3 at 25 km/h. Used only when the routing service fails. */
export function estimateFallback(
  from: LatLng,
  to: LatLng,
): { distanceM: number; durationS: number } {
  const distanceM = Math.round(haversineMeters(from, to) * FALLBACK_ROAD_FACTOR);
  const metersPerSecond = (FALLBACK_SPEED_KMH * 1000) / 3600;
  return { distanceM, durationS: Math.round(distanceM / metersPerSecond) };
}
