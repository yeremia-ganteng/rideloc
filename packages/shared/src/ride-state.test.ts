import { describe, expect, it } from 'vitest';
import {
  CreateRideRequestSchema,
  DRIVER_ACTIVE_STATUSES,
  RIDER_ACTIVE_STATUSES,
  RIDE_TRANSITIONS,
  RideStatusSchema,
  canTransition,
  type RideStatus,
} from './ride-state';

const ALL = RideStatusSchema.options;

describe('ride state machine', () => {
  it('alur bahagia valid secara berurutan', () => {
    const path: RideStatus[] = [
      'REQUESTED',
      'SEARCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i] as RideStatus, path[i + 1] as RideStatus)).toBe(true);
    }
  });

  it('status terminal tidak punya transisi keluar', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND'] as const) {
      expect(RIDE_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('tidak boleh loncat atau mundur', () => {
    expect(canTransition('SEARCHING', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('DRIVER_ASSIGNED', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'SEARCHING')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'DRIVER_ARRIVED')).toBe(false);
    expect(canTransition('SEARCHING', 'SEARCHING')).toBe(false);
  });

  it('CANCELLED hanya dari SEARCHING sampai DRIVER_ARRIVED', () => {
    const cancellable = ALL.filter((s) => canTransition(s, 'CANCELLED'));
    expect(cancellable).toEqual([
      'SEARCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
    ]);
  });

  it('NO_DRIVER_FOUND hanya dari SEARCHING', () => {
    expect(ALL.filter((s) => canTransition(s, 'NO_DRIVER_FOUND'))).toEqual(['SEARCHING']);
  });

  it('status aktif driver adalah himpunan bagian dari status aktif penumpang', () => {
    for (const s of DRIVER_ACTIVE_STATUSES) expect(RIDER_ACTIVE_STATUSES).toContain(s);
    expect(DRIVER_ACTIVE_STATUSES).not.toContain('SEARCHING');
    expect(RIDER_ACTIVE_STATUSES).toContain('SEARCHING');
  });
});

describe('CreateRideRequestSchema', () => {
  const valid = {
    pickup: { lat: -6.1751, lng: 106.8272 },
    dropoff: { lat: -6.2088, lng: 106.8456 },
    vehicleType: 'MOTORCYCLE',
  };

  it('membuang tarif, status, dan driver dari klien (mass assignment)', () => {
    const parsed = CreateRideRequestSchema.parse({
      ...valid,
      fareIdr: 1,
      status: 'COMPLETED',
      driverId: 'x',
    });
    expect(Object.keys(parsed).sort()).toEqual(['dropoff', 'pickup', 'vehicleType']);
  });

  it('alamat di-trim, dan alamat kosong atau terlalu panjang ditolak', () => {
    expect(
      CreateRideRequestSchema.parse({ ...valid, pickupAddress: '  Monas  ' }).pickupAddress,
    ).toBe('Monas');
    expect(CreateRideRequestSchema.safeParse({ ...valid, pickupAddress: '   ' }).success).toBe(
      false,
    );
    expect(
      CreateRideRequestSchema.safeParse({ ...valid, dropoffAddress: 'x'.repeat(201) }).success,
    ).toBe(false);
  });
});
