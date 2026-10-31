import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  geoNear,
  registerDriver,
  registerRider,
  resetDb,
  resetRedis,
} from '../test/helpers';
import {
  connectClient,
  listen,
  sendLocation,
  waitForEvent,
  type ClientSocket,
} from '../test/socket-helpers';
import { REDIS_KEYS } from './lib/redis-keys';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const monas = { lat: -6.1751, lng: 106.8272, heading: 90, accuracy: 10 };

describe('Socket.IO driver:location (integration)', () => {
  let t: TestApp;
  let url: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    url = await listen(t.app);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDb(t.db);
    await resetRedis(t.redis);
  });

  afterEach(() => {
    while (sockets.length > 0) sockets.pop()?.close();
  });

  const connect = async (token?: string): Promise<ClientSocket> => {
    const s = await connectClient(url, token);
    sockets.push(s);
    return s;
  };

  const goOnline = (token: string) =>
    t.app.inject({
      method: 'POST',
      url: '/driver/online',
      headers: { authorization: `Bearer ${token}` },
    });

  it('menolak koneksi tanpa token, token sampah, dan token dengan tanda tangan salah', async () => {
    await expect(connectClient(url)).rejects.toThrow('UNAUTHORIZED');
    await expect(connectClient(url, 'not.a.jwt')).rejects.toThrow('UNAUTHORIZED');
    const { token } = await registerDriver(t.app);
    await expect(connectClient(url, `${token.slice(0, -4)}AAAA`)).rejects.toThrow('UNAUTHORIZED');
  });

  it('driver online mengirim lokasi: ack ok dan posisi ada di Redis GEO', async () => {
    const { id, token } = await registerDriver(t.app);
    expect((await goOnline(token)).statusCode).toBe(204);
    const socket = await connect(token);
    expect(await sendLocation(socket, monas)).toEqual({ ok: true, availability: 'AVAILABLE' });
    expect(await geoNear(t.redis, monas.lng, monas.lat, 100)).toEqual([id]);
  });

  it('driver yang belum online ditolak NOT_ONLINE', async () => {
    const { token } = await registerDriver(t.app);
    const socket = await connect(token);
    expect(await sendLocation(socket, monas)).toEqual({ ok: false, reason: 'NOT_ONLINE' });
    expect(await t.redis.zcard(REDIS_KEYS.geo)).toBe(0);
  });

  it('RIDER tidak boleh mengirim lokasi driver (FORBIDDEN) dan GEO tetap kosong', async () => {
    const { token } = await registerRider(t.app);
    const socket = await connect(token);
    expect(await sendLocation(socket, monas)).toEqual({ ok: false, reason: 'FORBIDDEN' });
    expect(await t.redis.zcard(REDIS_KEYS.geo)).toBe(0);
  });

  it('payload tidak valid ditolak INVALID, dan driverId palsu dari klien diabaikan', async () => {
    const { id, token } = await registerDriver(t.app);
    await goOnline(token);
    const socket = await connect(token);
    expect(await sendLocation(socket, { lat: 'x', lng: 1, accuracy: 5 })).toEqual({
      ok: false,
      reason: 'INVALID',
    });
    expect(await sendLocation(socket, null)).toEqual({ ok: false, reason: 'INVALID' });
    // Klaim identitas orang lain di payload tidak punya efek: ID selalu dari token.
    await sendLocation(socket, { ...monas, driverId: '11111111-1111-4111-8111-111111111111' });
    expect(await t.redis.zrange(REDIS_KEYS.geo, 0, '-1')).toEqual([id]);
  });

  it('akurasi > 50 m dibuang (LOW_ACCURACY)', async () => {
    const { token } = await registerDriver(t.app);
    await goOnline(token);
    const socket = await connect(token);
    expect(await sendLocation(socket, { ...monas, accuracy: 75 })).toEqual({
      ok: false,
      reason: 'LOW_ACCURACY',
    });
    expect(await t.redis.zcard(REDIS_KEYS.geo)).toBe(0);
  });

  it('rate limit per koneksi: kiriman beruntun melewati batas dijawab RATE_LIMITED', async () => {
    const { token } = await registerDriver(t.app);
    await goOnline(token);
    const socket = await connect(token);
    const reasons: string[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await sendLocation(socket, monas);
      reasons.push(res.ok ? 'ok' : res.reason);
    }
    expect(reasons.slice(0, 10).every((r) => r === 'ok')).toBe(true);
    expect(reasons.slice(10).every((r) => r === 'RATE_LIMITED')).toBe(true);
  });

  it('US-16: koneksi putus TIDAK langsung menghapus driver dari GEO (menunggu TTL heartbeat)', async () => {
    const { id, token } = await registerDriver(t.app);
    await goOnline(token);
    const socket = await connect(token);
    await sendLocation(socket, monas);
    socket.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(await t.redis.zscore(REDIS_KEYS.geo, id)).not.toBeNull();
    expect(await t.redis.exists(REDIS_KEYS.heartbeat(id))).toBe(1);
  });
});

describe('Socket.IO token kedaluwarsa (integration)', () => {
  it('server mengirim session:expired lalu memutus koneksi saat access token habis', async () => {
    const shortTtlApp = await createTestApp({ ACCESS_TOKEN_TTL: '2s' });

    await resetDb(shortTtlApp.db);
    await resetRedis(shortTtlApp.redis);

    const url = await listen(shortTtlApp.app);

    try {
      const { token } = await registerDriver(shortTtlApp.app); // ← hapus 'id'
      const socket = await connectClient(url, token);

      try {
        const expired = waitForEvent(socket, 'session:expired');
        const closed = waitForEvent(socket, 'disconnect');

        await expired;
        await closed;

        expect(socket.connected).toBe(false);
      } finally {
        socket.close();
      }
    } finally {
      await shortTtlApp.close();
    }
  });
});
