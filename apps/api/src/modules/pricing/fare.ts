import type { VehiclePricing } from '@rideloc/shared';

export const FARE_ROUNDING_IDR = 500;

export interface FareInput {
  /** Whole meters. */
  distanceM: number;
  /** Whole seconds. */
  durationS: number;
}

/**
 * fare = max(minimum, base + km * perKm + minutes * perMinute), rounded UP to Rp500.
 *
 * Exact integer math: with km = m/1000 and minutes = s/60, multiplying everything by 60,000
 * gives base*60000 + m*perKm*60 + s*perMinute*1000. Only the final division is not exact,
 * and ceil() on it cannot flip across a multiple of 500 (the fractional part is >= 1/(3e7)).
 */
export function calculateFare(input: FareInput, pricing: VehiclePricing): number {
  const { distanceM, durationS } = input;
  if (!Number.isSafeInteger(distanceM) || distanceM < 0) {
    throw new RangeError('distanceM must be a non-negative integer');
  }
  if (!Number.isSafeInteger(durationS) || durationS < 0) {
    throw new RangeError('durationS must be a non-negative integer');
  }

  const SCALE = 60_000;
  const scaled =
    pricing.base * SCALE + distanceM * pricing.perKm * 60 + durationS * pricing.perMinute * 1000;
  const computed = Math.ceil(scaled / (SCALE * FARE_ROUNDING_IDR)) * FARE_ROUNDING_IDR;
  const minimum = Math.ceil(pricing.minimum / FARE_ROUNDING_IDR) * FARE_ROUNDING_IDR;
  return Math.max(computed, minimum);
}
