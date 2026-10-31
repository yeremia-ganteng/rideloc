import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { geoNear, createTestApp, registerDriver, resetDb, resetRedis } from '../test/helpers';
import { PRESENCE, REDIS_KEYS } from './lib/redis-keys';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const monas = { lat: -6.1751, lng: 106.8272, accuracy: 10 };
const sudirman = { lat: -6.2088, lng: 106.8456, accuracy: 10 };

describe('presence (integration: Redis + PostGIS asli)', () => {
  let t: TestApp;
  let driverId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
    await resetRedis(t.redis);
    driverId = (await registerDriver(t.app)).id;
  });

  const lastLocationWkt = async (id: string): Promise<string | null> => {
    const res = await sql<{ wkt: string | null }>`
      SELECT ST_AsText(last_location::geometry) AS wkt FROM drivers WHERE user_id = ${id}`.execute(
      t.db,
    );
    return res.rows[0]?.wkt ?? null;
  };

  it('goOnline: DB true dan key online punya TTL', async () => {
    await t.app.presence.goOnline(driverId);
    const row = await t.db.selectFrom('drivers').select('is_online').executeTakeFirstOrThrow();
    expect(row.is_online).toBe(true);
    const ttl = await t.redis.ttl(REDIS_KEYS.online(driverId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRESENCE.ONLINE_TTL_S);
  });

  it('goOnline untuk user tanpa profil driver ditolak 404', async () => {
    await expect(
      t.app.presence.goOnline('00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lokasi sebelum online ditolak NOT_ONLINE dan GEO tetap kosong', async () => {
    const res = await t.app.presence.updateLocation(driverId, monas);
    expect(res).toEqual({ ok: false, reason: 'NOT_ONLINE' });
    expect(await t.redis.zcard(REDIS_KEYS.geo)).toBe(0);
  });

  it('lokasi diterima: masuk GEO dengan urutan lng,lat yang benar + heartbeat TTL <= 15 dtk', async () => {
    await t.app.presence.goOnline(driverId);
    expect(await t.app.presence.updateLocation(driverId, monas)).toEqual({
      ok: true,
      availability: 'AVAILABLE',
    });

    // Dekat Monas ketemu, 5 km dari situ tidak. Ini menangkap bug lat/lng tertukar.
    expect(await geoNear(t.redis, monas.lng, monas.lat, 100)).toEqual([driverId]);
    expect(await geoNear(t.redis, sudirman.lng, sudirman.lat, 1000)).toEqual([]);

    const ttl = await t.redis.ttl(REDIS_KEYS.heartbeat(driverId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(PRESENCE.HEARTBEAT_TTL_S);
  });

  it('akurasi tepat 50 m diterima, 50,1 m dibuang dan GEO tidak berubah', async () => {
    await t.app.presence.goOnline(driverId);
    expect((await t.app.presence.updateLocation(driverId, { ...monas, accuracy: 50 })).ok).toBe(
      true,
    );
    const res = await t.app.presence.updateLocation(driverId, { ...sudirman, accuracy: 50.1 });
    expect(res).toEqual({ ok: false, reason: 'LOW_ACCURACY' });
    expect(await geoNear(t.redis, monas.lng, monas.lat, 100)).toEqual([driverId]);
    expect(await geoNear(t.redis, sudirman.lng, sudirman.lat, 100)).toEqual([]);
  });

  it('PostGIS dithrottle: lokasi pertama disimpan, berikutnya dalam 30 dtk tidak', async () => {
    await t.app.presence.goOnline(driverId);
    await t.app.presence.updateLocation(driverId, monas);
    expect(await lastLocationWkt(driverId)).toBe('POINT(106.8272 -6.1751)');

    await t.app.presence.updateLocation(driverId, sudirman); // dalam jendela throttle
    expect(await lastLocationWkt(driverId)).toBe('POINT(106.8272 -6.1751)');

    await t.redis.del(REDIS_KEYS.persistThrottle(driverId)); // simulasi 30 dtk berlalu
    await t.app.presence.updateLocation(driverId, sudirman);
    expect(await lastLocationWkt(driverId)).toBe('POINT(106.8456 -6.2088)');
  });

  it('driver BUSY: dikeluarkan dari GEO tetapi heartbeat tetap hidup', async () => {
    await t.app.presence.goOnline(driverId);
    await t.app.presence.updateLocation(driverId, monas);
    expect(await t.redis.zscore(REDIS_KEYS.geo, driverId)).not.toBeNull();

    await t.redis.set(REDIS_KEYS.busy(driverId), '1');
    const res = await t.app.presence.updateLocation(driverId, monas);
    expect(res).toEqual({ ok: true, availability: 'BUSY' });
    expect(await t.redis.zscore(REDIS_KEYS.geo, driverId)).toBeNull();
    expect(await t.redis.exists(REDIS_KEYS.heartbeat(driverId))).toBe(1);
  });

  it('goOffline: DB false, semua key dan anggota GEO hilang, dan lokasi susulan ditolak', async () => {
    await t.app.presence.goOnline(driverId);
    await t.app.presence.updateLocation(driverId, monas);

    await t.app.presence.goOffline(driverId);
    const row = await t.db.selectFrom('drivers').select('is_online').executeTakeFirstOrThrow();
    expect(row.is_online).toBe(false);
    expect(await t.redis.zscore(REDIS_KEYS.geo, driverId)).toBeNull();
    expect(await t.redis.exists(REDIS_KEYS.online(driverId), REDIS_KEYS.heartbeat(driverId))).toBe(
      0,
    );

    const late = await t.app.presence.updateLocation(driverId, monas);
    expect(late).toEqual({ ok: false, reason: 'NOT_ONLINE' });
    expect(await t.redis.zscore(REDIS_KEYS.geo, driverId)).toBeNull(); // tidak "hidup lagi"
  });

  it('sweepGhosts: membuang driver tanpa heartbeat, driver sehat tetap', async () => {
    const other = (await registerDriver(t.app, 'sari@example.com', 'B 9999 AAA')).id;
    for (const id of [driverId, other]) {
      await t.app.presence.goOnline(id);
      await t.app.presence.updateLocation(id, monas);
    }
    await t.redis.del(REDIS_KEYS.heartbeat(driverId)); // simulasi TTL 15 dtk habis

    const result = await t.app.presence.sweepGhosts();
    expect(result.removedFromGeo).toBe(1);
    expect(await t.redis.zscore(REDIS_KEYS.geo, driverId)).toBeNull();
    expect(await t.redis.zscore(REDIS_KEYS.geo, other)).not.toBeNull();
  });

  it('sweepGhosts: driver yang sunyi > 120 dtk ditandai offline di DB', async () => {
    await t.app.presence.goOnline(driverId);
    await sql`UPDATE drivers SET last_seen_at = now() - interval '3 minutes'`.execute(t.db);

    const result = await t.app.presence.sweepGhosts();
    expect(result.markedOffline).toBe(1);
    const row = await t.db.selectFrom('drivers').select('is_online').executeTakeFirstOrThrow();
    expect(row.is_online).toBe(false);
  });

  it('sweepGhosts pada GEO kosong tidak error', async () => {
    expect(await t.app.presence.sweepGhosts()).toEqual({ removedFromGeo: 0, markedOffline: 0 });
  });
});
