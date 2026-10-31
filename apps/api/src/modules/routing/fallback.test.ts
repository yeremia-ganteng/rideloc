import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../../lib/geo';
import { estimateFallback } from './fallback';

const a = { lat: -6.1751, lng: 106.8272 };
const b = { lat: -6.2088, lng: 106.8456 };

describe('estimateFallback', () => {
  it('nol untuk titik yang sama', () => {
    expect(estimateFallback(a, a)).toEqual({ distanceM: 0, durationS: 0 });
  });

  it('jarak = Haversine x 1,3 (integer)', () => {
    const { distanceM } = estimateFallback(a, b);
    expect(Number.isInteger(distanceM)).toBe(true);
    expect(Math.abs(distanceM - haversineMeters(a, b) * 1.3)).toBeLessThan(1);
  });

  it('durasi sesuai kecepatan 25 km/jam', () => {
    const { distanceM, durationS } = estimateFallback(a, b);
    expect(Math.abs(durationS - distanceM / (25_000 / 3600))).toBeLessThan(1);
  });
});
