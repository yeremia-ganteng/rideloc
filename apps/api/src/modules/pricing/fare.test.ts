import { DEFAULT_PRICING } from '@rideloc/shared';
import { describe, expect, it } from 'vitest';
import { calculateFare } from './fare';

const MOTO = DEFAULT_PRICING.MOTORCYCLE; // base 2000, 2500/km, 200/min, min 8000
const CAR = DEFAULT_PRICING.CAR; // base 5000, 4000/km, 400/min, min 15000

describe('calculateFare', () => {
  it('motor 5 km / 15 menit = 2000 + 12500 + 3000 = 17500 (sudah kelipatan 500)', () => {
    expect(calculateFare({ distanceM: 5000, durationS: 900 }, MOTO)).toBe(17_500);
  });

  it('naik 1 meter melewati kelipatan 500 menaikkan ke 18000 (bulat ke atas)', () => {
    expect(calculateFare({ distanceM: 5001, durationS: 900 }, MOTO)).toBe(18_000);
  });

  it('motor 10 km / 1000 dtk = 30333,33 -> 30500', () => {
    expect(calculateFare({ distanceM: 10_000, durationS: 1000 }, MOTO)).toBe(30_500);
  });

  it('mobil 10 km / 1000 dtk = 51666,67 -> 52000', () => {
    expect(calculateFare({ distanceM: 10_000, durationS: 1000 }, CAR)).toBe(52_000);
  });

  it('perjalanan pendek mengikuti tarif minimum', () => {
    expect(calculateFare({ distanceM: 500, durationS: 120 }, MOTO)).toBe(8_000);
    expect(calculateFare({ distanceM: 0, durationS: 0 }, MOTO)).toBe(8_000);
  });

  it('minimum yang bukan kelipatan 500 ikut dibulatkan ke atas', () => {
    const odd = { base: 0, perKm: 0, perMinute: 0, minimum: 8_250 };
    expect(calculateFare({ distanceM: 0, durationS: 0 }, odd)).toBe(8_500);
  });

  it('selalu kelipatan 500, >= minimum, dan tidak turun saat jarak naik', () => {
    let prev = 0;
    for (let m = 0; m <= 60_000; m += 137) {
      const fare = calculateFare({ distanceM: m, durationS: Math.round(m / 6) }, MOTO);
      expect(fare % 500).toBe(0);
      expect(fare).toBeGreaterThanOrEqual(MOTO.minimum);
      expect(fare).toBeGreaterThanOrEqual(prev);
      prev = fare;
    }
  });

  it('menolak input pecahan atau negatif (harus dibulatkan oleh pemanggil)', () => {
    expect(() => calculateFare({ distanceM: 1.5, durationS: 10 }, MOTO)).toThrow(RangeError);
    expect(() => calculateFare({ distanceM: 10, durationS: -1 }, MOTO)).toThrow(RangeError);
    expect(() => calculateFare({ distanceM: Number.NaN, durationS: 10 }, MOTO)).toThrow(RangeError);
  });
});
