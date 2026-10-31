import { describe, expect, it } from 'vitest';
import { DriverLocationSchema, MAX_LOCATION_ACCURACY_M } from './location';

const valid = { lat: -6.1751, lng: 106.8272, heading: 90, accuracy: 12 };

describe('DriverLocationSchema', () => {
  it('menerima payload valid; heading opsional', () => {
    expect(DriverLocationSchema.safeParse(valid).success).toBe(true);
    const noHeading = { lat: valid.lat, lng: valid.lng, accuracy: valid.accuracy };
    expect(DriverLocationSchema.safeParse(noHeading).success).toBe(true);
  });

  it('menolak koordinat di luar batas Redis GEO dan di luar rentang bujur', () => {
    expect(DriverLocationSchema.safeParse({ ...valid, lat: 86 }).success).toBe(false);
    expect(DriverLocationSchema.safeParse({ ...valid, lat: -90 }).success).toBe(false);
    expect(DriverLocationSchema.safeParse({ ...valid, lng: 181 }).success).toBe(false);
  });

  it('menolak akurasi negatif, heading di luar 0-360, dan tipe salah', () => {
    expect(DriverLocationSchema.safeParse({ ...valid, accuracy: -1 }).success).toBe(false);
    expect(DriverLocationSchema.safeParse({ ...valid, heading: 361 }).success).toBe(false);
    expect(DriverLocationSchema.safeParse({ ...valid, lat: '-6.17' }).success).toBe(false);
    expect(DriverLocationSchema.safeParse(null).success).toBe(false);
  });

  it('membuang field tak dikenal (misalnya klaim driverId dari klien)', () => {
    const parsed = DriverLocationSchema.parse({ ...valid, driverId: 'orang-lain' });
    expect('driverId' in parsed).toBe(false);
  });

  it('batas akurasi bisnis = 50 m', () => {
    expect(MAX_LOCATION_ACCURACY_M).toBe(50);
  });
});
