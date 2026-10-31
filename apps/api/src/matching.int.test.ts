import { DRIVER_ACTIVE_STATUSES, type CreateRideResponse, type LatLng } from '@rideloc/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, registerDriver, registerRider, resetDb, resetRedis } from '../test/helpers';
import {
  insertOffer,
  insertRide,
  offsetNorth,
  requestRide,
  respondOffer,
  sleep,
  trackOffers,
  trackRideUpdates,
} from '../test/matching-helpers';
import { connectClient, listen, type ClientSocket } from '../test/socket-helpers';
import { REDIS_KEYS } from './lib/redis-keys';
import type { RouteResult, RoutingClient } from './modules/routing/types';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const PICKUP: LatLng = { lat: -6.1751, lng: 106.8272 };
const DROPOFF: LatLng = { lat: -6.2088, lng: 106.8456 };
const rideBody = { pickup: PICKUP, dropoff: DROPOFF, vehicleType: 'MOTORCYCLE' };
const NO_SUCH_RIDE = '00000000-0000-4000-8000-000000000000';

// Deterministic route: 5 km / 15 min => Rp17.500 for a motorcycle (see Phase 2).
const routing: RoutingClient = {
  route: async (): Promise<RouteResult> => ({ distanceM: 5000, durationS: 900, polyline: 'abc' }),
};

function useHarness(overrides: Record<string, string> = {}) {
  let ctx: TestApp | undefined;
  let url = '';
  const sockets: ClientSocket[] = [];

  const t = (): TestApp => {
    if (!ctx) throw new Error('test app is not ready');
    return ctx;
  };

  beforeAll(async () => {
    ctx = await createTestApp(overrides, routing);
    url = await listen(ctx.app);
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await resetDb(t().db);
    await resetRedis(t().redis);
  });
  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.close();
  });

  async function connect(token: string): Promise<ClientSocket> {
    const socket = await connectClient(url, token);
    sockets.push(socket);
    return socket;
  }

  /** A driver that is online, has a fresh location, and listens for offers on a socket. */
  async function onlineDriver(email: string, plate: string, at: LatLng) {
    const d = await registerDriver(t().app, email, plate);
    await t().app.presence.goOnline(d.id);
    const ack = await t().app.presence.updateLocation(d.id, { ...at, accuracy: 10 });
    expect(ack.ok).toBe(true);
    const socket = await connect(d.token);
    return { ...d, socket, offers: trackOffers(socket) };
  }

  async function rider(email = 'rina@example.com') {
    const r = await registerRider(t().app, email);
    const socket = await connect(r.token);
    return { ...r, socket, updates: trackRideUpdates(socket) };
  }

  const rideRow = (id: string) =>
    t()
      .db.selectFrom('rides')
      .select(['status', 'driver_id', 'fare_idr'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  return { t, connect, onlineDriver, rider, rideRow };
}

describe('matching (integration: Redis + PostGIS asli)', () => {
  const { t, onlineDriver, rider, rideRow } = useHarness();

  it('POST /rides mengunci tarif di server: field tarif/status dari klien diabaikan', async () => {
    const r = await rider();
    const res = await requestRide(t().app, r.token, {
      ...rideBody,
      fareIdr: 1,
      status: 'COMPLETED',
    });
    expect(res.statusCode).toBe(201);
    const { ride } = res.json<CreateRideResponse>();
    expect(ride).toMatchObject({
      status: 'SEARCHING',
      fareIdr: 17_500,
      distanceM: 5000,
      vehicleType: 'MOTORCYCLE',
    });
    expect(await rideRow(ride.id)).toMatchObject({ status: 'SEARCHING', fare_idr: 17_500 });
  });

  it('menawarkan ke driver TERDEKAT dulu, dan tawaran anonim (tanpa identitas penumpang)', async () => {
    const near = await onlineDriver('near@example.com', 'B 1 AAA', offsetNorth(PICKUP, 1000));
    const far = await onlineDriver('far@example.com', 'B 2 AAA', offsetNorth(PICKUP, 2500));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    const offer = await near.offers.next();
    expect(offer).toMatchObject({ rideId: ride.id, fareIdr: 17_500, distanceM: 5000 });
    expect(offer.pickupDistanceM).toBeGreaterThan(900);
    expect(offer.pickupDistanceM).toBeLessThan(1100);
    // Allowlist of keys: a new field (e.g. rider name) must be a conscious decision.
    expect(Object.keys(offer).sort()).toEqual([
      'distanceM',
      'dropoff',
      'expiresAt',
      'fareIdr',
      'pickup',
      'pickupDistanceM',
      'rideId',
    ]);

    await sleep(300);
    expect(far.offers.received).toHaveLength(0); // one offer at a time
  });

  it('driver menerima: DRIVER_ASSIGNED, flag busy, keluar dari GEO, penumpang diberi tahu', async () => {
    const d = await onlineDriver('budi@example.com', 'B 1 AAA', offsetNorth(PICKUP, 1000));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    const offer = await d.offers.next();
    expect(await respondOffer(d.socket, { rideId: offer.rideId, accept: true })).toEqual({
      ok: true,
      accepted: true,
    });

    expect(await rideRow(ride.id)).toMatchObject({ status: 'DRIVER_ASSIGNED', driver_id: d.id });
    expect(await t().redis.get(REDIS_KEYS.busy(d.id))).toBe(ride.id);
    expect(await t().redis.zscore(REDIS_KEYS.geo, d.id)).toBeNull();
    expect(await t().redis.exists(REDIS_KEYS.offerLock(d.id))).toBe(0);
    expect(await r.updates.next()).toEqual({ rideId: ride.id, status: 'DRIVER_ASSIGNED' });
  });

  it('driver menolak: tawaran pindah ke driver berikutnya dan outcome tercatat', async () => {
    const d1 = await onlineDriver('d1@example.com', 'B 11 AAA', offsetNorth(PICKUP, 1000));
    const d2 = await onlineDriver('d2@example.com', 'B 12 AAA', offsetNorth(PICKUP, 2000));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    const first = await d1.offers.next();
    expect(await respondOffer(d1.socket, { rideId: first.rideId, accept: false })).toEqual({
      ok: true,
      accepted: false,
    });
    expect((await d2.offers.next()).rideId).toBe(ride.id);

    const offers = await t()
      .db.selectFrom('ride_offers')
      .select(['driver_id', 'outcome'])
      .where('ride_id', '=', ride.id)
      .orderBy('offered_at')
      .execute();
    expect(offers).toEqual([
      { driver_id: d1.id, outcome: 'REJECTED' },
      { driver_id: d2.id, outcome: null },
    ]);
  });

  it('maksimal 5 percobaan lalu NO_DRIVER_FOUND, driver ke-6 tidak pernah ditawari', async () => {
    const drivers = [];
    for (let i = 0; i < 6; i++) {
      drivers.push(
        await onlineDriver(
          `d${i}@example.com`,
          `B ${i + 10} AAA`,
          offsetNorth(PICKUP, 400 * (i + 1)),
        ),
      );
    }
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    for (const d of drivers.slice(0, 5)) {
      const offer = await d.offers.next();
      expect(offer.rideId).toBe(ride.id);
      expect(await respondOffer(d.socket, { rideId: ride.id, accept: false })).toEqual({
        ok: true,
        accepted: false,
      });
    }

    expect(await r.updates.next()).toEqual({ rideId: ride.id, status: 'NO_DRIVER_FOUND' });
    expect((await rideRow(ride.id)).status).toBe('NO_DRIVER_FOUND');
    expect(drivers[5]?.offers.received).toHaveLength(0);
    const count = await t()
      .db.selectFrom('ride_offers')
      .select('id')
      .where('ride_id', '=', ride.id)
      .execute();
    expect(count).toHaveLength(5);
  });

  it('radius melebar: driver 4 km (di luar 3 km) tetap ditawari, driver 9 km (di luar 8 km) tidak', async () => {
    const mid = await onlineDriver('mid@example.com', 'B 21 AAA', offsetNorth(PICKUP, 4000));
    const far = await onlineDriver('far@example.com', 'B 22 AAA', offsetNorth(PICKUP, 9000));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    expect((await mid.offers.next()).rideId).toBe(ride.id);
    await sleep(300);
    expect(far.offers.received).toHaveLength(0);
  });

  it('jenis kendaraan harus cocok: ride CAR tidak ditawarkan ke driver motor', async () => {
    const d = await onlineDriver('moto@example.com', 'B 31 AAA', offsetNorth(PICKUP, 500));
    const r = await rider();
    await requestRide(t().app, r.token, { ...rideBody, vehicleType: 'CAR' });
    await t().app.matching.tick();
    await sleep(300);
    expect(d.offers.received).toHaveLength(0);
  });

  it('RACE: dua penumpang bersamaan, satu driver => hanya SATU tawaran aktif', async () => {
    const d = await onlineDriver('budi@example.com', 'B 41 AAA', offsetNorth(PICKUP, 500));
    const a = await rider('a@example.com');
    const b = await rider('b@example.com');

    const [resA, resB] = await Promise.all([
      requestRide(t().app, a.token, rideBody),
      requestRide(t().app, b.token, rideBody),
    ]);
    expect([resA.statusCode, resB.statusCode]).toEqual([201, 201]);

    await d.offers.next(); // exactly one offer arrives
    await t().app.matching.tick(); // give the second ride every chance to also grab the driver
    await sleep(300);
    expect(d.offers.received).toHaveLength(0);

    const pending = await t()
      .db.selectFrom('ride_offers')
      .select('ride_id')
      .where('outcome', 'is', null)
      .execute();
    expect(pending).toHaveLength(1);
  });

  it('RACE: 6 penerimaan bersamaan oleh satu driver => tepat satu berhasil', async () => {
    const d = await registerDriver(t().app);
    await t().app.presence.goOnline(d.id);

    const rideIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await registerRider(t().app, `r${i}@example.com`);
      const rideId = await insertRide(t().db, { riderId: r.id, status: 'SEARCHING' });
      await insertOffer(t().db, { rideId, driverId: d.id, ttlS: 30 }); // bypasses the offer lock on purpose
      rideIds.push(rideId);
    }

    const results = await Promise.all(
      rideIds.map((id) => t().app.matching.respond(d.id, id, true)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.flatMap((r) => (r.ok ? [] : [r.reason]))).toEqual(Array(5).fill('DRIVER_BUSY'));

    const active = await t()
      .db.selectFrom('rides')
      .select('id')
      .where('driver_id', '=', d.id)
      .where('status', 'in', [...DRIVER_ACTIVE_STATUSES])
      .execute();
    expect(active).toHaveLength(1);
    expect(await t().redis.get(REDIS_KEYS.busy(d.id))).toBe(active[0]?.id);
  });

  it('LAPIS 3: Redis kehilangan flag busy => indeks unik tetap mencegah ride kedua, flag dipulihkan', async () => {
    const d = await registerDriver(t().app);
    await t().app.presence.goOnline(d.id);
    const r1 = await registerRider(t().app, 'r1@example.com');
    const r2 = await registerRider(t().app, 'r2@example.com');
    const rideA = await insertRide(t().db, { riderId: r1.id, status: 'SEARCHING' });
    const rideB = await insertRide(t().db, { riderId: r2.id, status: 'SEARCHING' });
    await insertOffer(t().db, { rideId: rideA, driverId: d.id, ttlS: 30 });
    await insertOffer(t().db, { rideId: rideB, driverId: d.id, ttlS: 30 });

    expect(await t().app.matching.respond(d.id, rideA, true)).toEqual({ ok: true, accepted: true });

    await t().redis.del(REDIS_KEYS.busy(d.id)); // simulate a Redis restart / flush
    expect(await t().app.matching.respond(d.id, rideB, true)).toEqual({
      ok: false,
      reason: 'DRIVER_BUSY',
    });

    expect((await rideRow(rideB)).status).toBe('SEARCHING'); // rolled back
    const pendingB = await t()
      .db.selectFrom('ride_offers')
      .select('outcome')
      .where('ride_id', '=', rideB)
      .executeTakeFirstOrThrow();
    expect(pendingB.outcome).toBeNull();
    expect(await t().redis.get(REDIS_KEYS.busy(d.id))).toBe(rideA); // healed to the real active ride
  });

  it('tawaran kedaluwarsa dan ride yang sudah dibatalkan ditolak, tanpa flag busy yang tersisa', async () => {
    const d = await registerDriver(t().app);
    await t().app.presence.goOnline(d.id);
    const r1 = await registerRider(t().app, 'r1@example.com');
    const r2 = await registerRider(t().app, 'r2@example.com');

    const expiredRide = await insertRide(t().db, { riderId: r1.id, status: 'SEARCHING' });
    await insertOffer(t().db, { rideId: expiredRide, driverId: d.id, ttlS: -5 });
    expect(await t().app.matching.respond(d.id, expiredRide, true)).toEqual({
      ok: false,
      reason: 'OFFER_EXPIRED',
    });
    expect(await t().redis.exists(REDIS_KEYS.busy(d.id))).toBe(0);
    expect((await rideRow(expiredRide)).status).toBe('SEARCHING');

    const cancelledRide = await insertRide(t().db, { riderId: r2.id, status: 'SEARCHING' });
    await insertOffer(t().db, { rideId: cancelledRide, driverId: d.id, ttlS: 30 });
    await t()
      .db.updateTable('rides')
      .set({ status: 'CANCELLED' })
      .where('id', '=', cancelledRide)
      .execute();
    expect(await t().app.matching.respond(d.id, cancelledRide, true)).toEqual({
      ok: false,
      reason: 'RIDE_UNAVAILABLE',
    });
    expect(await t().redis.exists(REDIS_KEYS.busy(d.id))).toBe(0);
    expect((await rideRow(cancelledRide)).status).toBe('CANCELLED');
  });

  it('driver lain tidak bisa menjawab tawaran milik driver lain (OFFER_NOT_FOUND)', async () => {
    const d1 = await onlineDriver('d1@example.com', 'B 51 AAA', offsetNorth(PICKUP, 500));
    const d2 = await onlineDriver('d2@example.com', 'B 52 AAA', offsetNorth(PICKUP, 3500));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();
    await d1.offers.next();

    expect(await respondOffer(d2.socket, { rideId: ride.id, accept: true })).toEqual({
      ok: false,
      reason: 'OFFER_NOT_FOUND',
    });
    expect(await t().redis.exists(REDIS_KEYS.busy(d2.id))).toBe(0);
    expect((await rideRow(ride.id)).status).toBe('SEARCHING');

    expect(await respondOffer(d1.socket, { rideId: ride.id, accept: true })).toEqual({
      ok: true,
      accepted: true,
    });
  });

  it('driver yang sudah offline tidak bisa menerima tawaran yang masih berjalan', async () => {
    const d = await onlineDriver('budi@example.com', 'B 61 AAA', offsetNorth(PICKUP, 500));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();
    await d.offers.next();

    const off = await t().app.inject({
      method: 'POST',
      url: '/driver/offline',
      headers: { authorization: `Bearer ${d.token}` },
    });
    expect(off.statusCode).toBe(204);
    expect(await respondOffer(d.socket, { rideId: ride.id, accept: true })).toEqual({
      ok: false,
      reason: 'DRIVER_OFFLINE',
    });
  });

  it('offer:respond: payload sampah => INVALID, penumpang => FORBIDDEN', async () => {
    const d = await onlineDriver('budi@example.com', 'B 71 AAA', offsetNorth(PICKUP, 500));
    expect(await respondOffer(d.socket, { rideId: 'x', accept: 'yes' })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
    expect(await respondOffer(d.socket, null)).toEqual({ ok: false, reason: 'INVALID' });

    const r = await rider();
    expect(await respondOffer(r.socket, { rideId: NO_SUCH_RIDE, accept: true })).toEqual({
      ok: false,
      reason: 'FORBIDDEN',
    });
  });

  it('penumpang tidak boleh punya dua ride aktif (409); driver 403; tanpa token 401', async () => {
    const r = await rider();
    expect((await requestRide(t().app, r.token, rideBody)).statusCode).toBe(201);
    const second = await requestRide(t().app, r.token, rideBody);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('RIDER_HAS_ACTIVE_RIDE');

    const d = await registerDriver(t().app);
    expect((await requestRide(t().app, d.token, rideBody)).statusCode).toBe(403);
    const anon = await t().app.inject({ method: 'POST', url: '/rides', payload: rideBody });
    expect(anon.statusCode).toBe(401);
  });

  it('driver tidak bisa offline saat punya ride aktif, tetapi bisa setelah ride selesai', async () => {
    const d = await registerDriver(t().app);
    await t().app.presence.goOnline(d.id);
    const r = await registerRider(t().app);
    const rideId = await insertRide(t().db, {
      riderId: r.id,
      status: 'DRIVER_ASSIGNED',
      driverId: d.id,
    });
    const goOffline = () =>
      t().app.inject({
        method: 'POST',
        url: '/driver/offline',
        headers: { authorization: `Bearer ${d.token}` },
      });

    const blocked = await goOffline();
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('DRIVER_HAS_ACTIVE_RIDE');

    await t()
      .db.updateTable('rides')
      .set({ status: 'COMPLETED' })
      .where('id', '=', rideId)
      .execute();
    expect((await goOffline()).statusCode).toBe(204);
  });

  it('indeks parsial: status aktif memblokir ride kedua untuk driver yang sama, status final tidak', async () => {
    const d = await registerDriver(t().app);
    const r1 = await registerRider(t().app, 'r1@example.com');
    const r2 = await registerRider(t().app, 'r2@example.com');
    const remove = (id: string) => t().db.deleteFrom('rides').where('id', '=', id).execute();

    for (const status of DRIVER_ACTIVE_STATUSES) {
      const first = await insertRide(t().db, { riderId: r1.id, status, driverId: d.id });
      await expect(
        insertRide(t().db, { riderId: r2.id, status: 'DRIVER_ASSIGNED', driverId: d.id }),
      ).rejects.toMatchObject({ code: '23505' });
      await remove(first);
    }

    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      const first = await insertRide(t().db, { riderId: r1.id, status, driverId: d.id });
      const second = await insertRide(t().db, {
        riderId: r2.id,
        status: 'DRIVER_ASSIGNED',
        driverId: d.id,
      });
      await remove(first);
      await remove(second);
    }

    // CHECK constraint: an assigned ride without a driver is impossible.
    await expect(
      insertRide(t().db, { riderId: r1.id, status: 'DRIVER_ASSIGNED', driverId: null }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('matching dengan waktu dipercepat (integration)', () => {
  // Offers live 1 s, and the search gives up immediately when nobody is in range.
  const { t, onlineDriver, rider, rideRow } = useHarness({
    MATCH_OFFER_TTL_S: '1',
    MATCH_SEARCH_TIMEOUT_S: '0',
  });

  it('timeout: tawaran ditandai TIMEOUT, pindah ke driver berikutnya, jawaban terlambat ditolak', async () => {
    const d1 = await onlineDriver('d1@example.com', 'B 81 AAA', offsetNorth(PICKUP, 1000));
    const d2 = await onlineDriver('d2@example.com', 'B 82 AAA', offsetNorth(PICKUP, 2000));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();
    await d1.offers.next();

    await sleep(1300);
    const round = await t().app.matching.tick();
    expect(round.expired).toBe(1);
    expect((await d2.offers.next()).rideId).toBe(ride.id);

    const offers = await t()
      .db.selectFrom('ride_offers')
      .select(['driver_id', 'outcome'])
      .where('ride_id', '=', ride.id)
      .orderBy('offered_at')
      .execute();
    expect(offers).toEqual([
      { driver_id: d1.id, outcome: 'TIMEOUT' },
      { driver_id: d2.id, outcome: null },
    ]);

    expect(await respondOffer(d1.socket, { rideId: ride.id, accept: true })).toEqual({
      ok: false,
      reason: 'OFFER_EXPIRED',
    });
    expect(await t().redis.exists(REDIS_KEYS.busy(d1.id))).toBe(0);
  });

  it('tanpa driver dalam 8 km: NO_DRIVER_FOUND saat batas pencarian habis, driver 9 km tidak ditawari', async () => {
    const far = await onlineDriver('far@example.com', 'B 91 AAA', offsetNorth(PICKUP, 9000));
    const r = await rider();
    const { ride } = (await requestRide(t().app, r.token, rideBody)).json<CreateRideResponse>();

    expect(await r.updates.next()).toEqual({ rideId: ride.id, status: 'NO_DRIVER_FOUND' });
    expect((await rideRow(ride.id)).status).toBe('NO_DRIVER_FOUND');
    expect(far.offers.received).toHaveLength(0);
  });
});
