import { describe, expect, it } from 'vitest';
import { EstimateRequestSchema } from './rides';

const valid = {
  pickup: { lat: -6.1751, lng: 106.8272 },
  dropoff: { lat: -6.2088, lng: 106.8456 },
  vehicleType: 'MOTORCYCLE',
};

describe('EstimateRequestSchema', () => {
  it('menerima payload valid dan membuang field tak dikenal', () => {
    const parsed = EstimateRequestSchema.parse({ ...valid, fareIdr: 1 });
    expect('fareIdr' in parsed).toBe(false);
  });

  it('menolak koordinat di luar rentang', () => {
    expect(EstimateRequestSchema.safeParse({ ...valid, pickup: { lat: 91, lng: 0 } }).success).toBe(
      false,
    );
    expect(
      EstimateRequestSchema.safeParse({ ...valid, dropoff: { lat: 0, lng: 181 } }).success,
    ).toBe(false);
  });

  it('menolak koordinat berupa string dan jenis kendaraan tak dikenal', () => {
    expect(
      EstimateRequestSchema.safeParse({ ...valid, pickup: { lat: '-6.1', lng: '106.8' } }).success,
    ).toBe(false);
    expect(EstimateRequestSchema.safeParse({ ...valid, vehicleType: 'BUS' }).success).toBe(false);
  });
});
