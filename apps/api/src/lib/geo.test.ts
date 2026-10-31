import { describe, expect, it } from 'vitest';
import { haversineMeters } from './geo';

const monas = { lat: -6.1751, lng: 106.8272 };
const sudirman = { lat: -6.2088, lng: 106.8456 };

describe('haversineMeters', () => {
  it('nol untuk titik yang sama', () => {
    expect(haversineMeters(monas, monas)).toBe(0);
  });

  it('simetris', () => {
    expect(haversineMeters(monas, sudirman)).toBeCloseTo(haversineMeters(sudirman, monas), 6);
  });

  it('1 derajat bujur di ekuator ≈ 111,195 km', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d).toBeCloseTo(111_195, -1);
  });

  it('Monas ke Sudirman ≈ 4,27 km (cocok dengan GEOSEARCH Fase 0)', () => {
    const d = haversineMeters(monas, sudirman);
    expect(d).toBeGreaterThan(4_200);
    expect(d).toBeLessThan(4_330);
  });
});
