import type { AuthResponse, EstimateResponse } from '@rideloc/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../test/helpers';
import { haversineMeters } from './lib/geo';
import { RoutingError, type RouteResult, type RoutingClient } from './modules/routing/types';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const OK_ROUTE: RouteResult = { distanceM: 5000, durationS: 900, polyline: 'abc' };
const monas = { lat: -6.1751, lng: 106.8272 };
const sudirman = { lat: -6.2088, lng: 106.8456 };
const body = { pickup: monas, dropoff: sudirman, vehicleType: 'MOTORCYCLE' };

describe('POST /rides/estimate (integration)', () => {
  let t: TestApp;
  let routeCalls = 0;
  let behavior: () => Promise<RouteResult> = async () => OK_ROUTE;
  const routing: RoutingClient = {
    route: () => {
      routeCalls += 1;
      return behavior();
    },
  };

  beforeAll(async () => {
    t = await createTestApp({}, routing);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    routeCalls = 0;
    behavior = async () => OK_ROUTE;
  });

  async function registerToken(payload: object): Promise<string> {
    const res = await t.app.inject({ method: 'POST', url: '/auth/register', payload });
    return res.json<AuthResponse>().accessToken;
  }
  const riderToken = () =>
    registerToken({
      email: 'rina@example.com',
      password: 'correct-horse-9',
      fullName: 'Rina Penumpang',
      role: 'RIDER',
    });
  const estimate = (token: string | undefined, payload: object = body) =>
    t.app.inject({
      method: 'POST',
      url: '/rides/estimate',
      payload,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });

  it('200: tarif motor dari rute OSRM', async () => {
    const res = await estimate(await riderToken());
    expect(res.statusCode).toBe(200);
    expect(res.json<EstimateResponse>().estimate).toEqual({
      vehicleType: 'MOTORCYCLE',
      distanceM: 5000,
      durationS: 900,
      fareIdr: 17_500,
      polyline: 'abc',
      source: 'osrm',
    });
  });

  it('200: tarif mobil berbeda dari motor', async () => {
    const res = await estimate(await riderToken(), { ...body, vehicleType: 'CAR' });
    expect(res.json<EstimateResponse>().estimate.fareIdr).toBe(31_000);
  });

  it('fallback saat routing gagal: source=fallback, tarif tetap valid', async () => {
    behavior = async () => {
      throw new RoutingError('osrm down');
    };
    const res = await estimate(await riderToken());
    expect(res.statusCode).toBe(200);
    const e = res.json<EstimateResponse>().estimate;
    expect(e.source).toBe('fallback');
    expect(e.polyline).toBeNull();
    expect(e.distanceM).toBe(Math.round(haversineMeters(monas, sudirman) * 1.3));
    expect(e.fareIdr % 500).toBe(0);
    expect(e.fareIdr).toBeGreaterThanOrEqual(8_000);
  });

  it('mengabaikan tarif kiriman klien (mass assignment)', async () => {
    const res = await estimate(await riderToken(), { ...body, fareIdr: 1 });
    expect(res.json<EstimateResponse>().estimate.fareIdr).toBe(17_500);
  });

  it('401 tanpa token', async () => {
    expect((await estimate(undefined)).statusCode).toBe(401);
  });

  it('403 untuk DRIVER (hanya RIDER yang boleh meminta estimasi)', async () => {
    const token = await registerToken({
      email: 'budi@example.com',
      password: 'correct-horse-9',
      fullName: 'Budi Driver',
      role: 'DRIVER',
      vehicleType: 'MOTORCYCLE',
      plateNumber: 'B 1234 XYZ',
    });
    const res = await estimate(token);
    expect(res.statusCode).toBe(403);
    expect(routeCalls).toBe(0);
  });

  it('400 untuk koordinat di luar rentang, dengan path yang jelas', async () => {
    const res = await estimate(await riderToken(), { ...body, pickup: { lat: 123, lng: 106.8 } });
    expect(res.statusCode).toBe(400);
    const err = res.json<{ error: { details: { path: string }[] } }>().error;
    expect(err.details.some((d) => d.path === 'pickup.lat')).toBe(true);
  });

  it('400 untuk jenis kendaraan tak dikenal', async () => {
    const res = await estimate(await riderToken(), { ...body, vehicleType: 'BUS' });
    expect(res.statusCode).toBe(400);
  });

  it('422 untuk perjalanan terlalu jauh, dan routing TIDAK dipanggil', async () => {
    const res = await estimate(await riderToken(), {
      ...body,
      dropoff: { lat: -7.2575, lng: 112.7521 }, // Surabaya, ±660 km
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('TRIP_TOO_LONG');
    expect(routeCalls).toBe(0);
  });
});
