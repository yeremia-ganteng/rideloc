import type { AuthResponse } from '@rideloc/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, getRefreshCookie, resetDb } from '../test/helpers';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const rider = {
  email: 'rina@example.com',
  password: 'correct-horse-9',
  fullName: 'Rina Penumpang',
  role: 'RIDER',
} as const;

describe('auth (integration, PostGIS asli)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDb(t.db);
  });

  const register = (payload: object = rider) =>
    t.app.inject({ method: 'POST', url: '/auth/register', payload });
  const refresh = (rt: string) =>
    t.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { rt } });

  describe('GET /health', () => {
    it('200 saat database hidup', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('ok');
    });
  });

  describe('POST /auth/register', () => {
    it('membuat rider, mengembalikan access token, dan set cookie refresh yang aman', async () => {
      const res = await register();
      expect(res.statusCode).toBe(201);
      const body = res.json<AuthResponse>();
      expect(body.user).toMatchObject({ email: 'rina@example.com', role: 'RIDER' });
      expect(body.accessToken.split('.')).toHaveLength(3);
      expect(JSON.stringify(body)).not.toContain('password');

      const cookie = getRefreshCookie(res);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.path).toBe('/auth');
      expect(cookie?.value.length).toBeGreaterThanOrEqual(43);
    });

    it('menyimpan password sebagai hash argon2id', async () => {
      await register();
      const row = await t.db.selectFrom('users').select('password_hash').executeTakeFirstOrThrow();
      expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(row.password_hash).not.toContain(rider.password);
    });

    it('menyimpan hash refresh token, bukan token mentah', async () => {
      const res = await register();
      const raw = getRefreshCookie(res)?.value ?? '';
      const rows = await t.db.selectFrom('refresh_tokens').select('token_hash').execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.token_hash).not.toBe(raw);
    });

    it('driver otomatis punya baris di tabel drivers (atomik)', async () => {
      const res = await register({
        ...rider,
        email: 'budi@example.com',
        role: 'DRIVER',
        vehicleType: 'MOTORCYCLE',
        plateNumber: 'b 1234 xyz',
      });
      expect(res.statusCode).toBe(201);
      const drivers = await t.db.selectFrom('drivers').selectAll().execute();
      expect(drivers).toHaveLength(1);
      expect(drivers[0]).toMatchObject({ plate_number: 'B 1234 XYZ', is_online: false });
    });

    it('409 untuk email duplikat, tidak peka huruf besar/kecil', async () => {
      await register();
      const res = await register({ ...rider, email: 'RINA@EXAMPLE.COM' });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('EMAIL_TAKEN');
    });

    it('400 untuk role ADMIN (tidak bisa self-register sebagai admin)', async () => {
      const res = await register({ ...rider, role: 'ADMIN' });
      expect(res.statusCode).toBe(400);
      expect(await t.db.selectFrom('users').selectAll().execute()).toHaveLength(0);
    });

    it('400 dengan detail untuk password lemah', async () => {
      const res = await register({ ...rider, password: 'short' });
      expect(res.statusCode).toBe(400);
      const err = res.json<{ error: { code: string; details: { path: string }[] } }>().error;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.details.some((d) => d.path === 'password')).toBe(true);
    });
  });

  describe('POST /auth/login', () => {
    it('berhasil, dan email tidak peka huruf besar/kecil', async () => {
      await register();
      const res = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'Rina@Example.com', password: rider.password },
      });
      expect(res.statusCode).toBe(200);
      expect(getRefreshCookie(res)).toBeDefined();
    });

    it('401 dengan pesan identik untuk password salah dan email tak dikenal', async () => {
      await register();
      const wrongPassword = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: rider.email, password: 'wrong-password' },
      });
      const unknownEmail = await t.app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'ghost@example.com', password: 'whatever-123' },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownEmail.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownEmail.json());
    });
  });

  describe('GET /me', () => {
    it('200 dengan access token valid', async () => {
      const { accessToken } = (await register()).json<AuthResponse>();
      const res = await t.app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ user: { email: string } }>().user.email).toBe(rider.email);
    });

    it('401 tanpa token, token sampah, atau token dengan tanda tangan salah', async () => {
      const none = await t.app.inject({ method: 'GET', url: '/me' });
      const junk = await t.app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: 'Bearer not.a.jwt' },
      });
      const { accessToken } = (await register()).json<AuthResponse>();
      const tampered = await t.app.inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${accessToken.slice(0, -4)}AAAA` },
      });
      expect([none.statusCode, junk.statusCode, tampered.statusCode]).toEqual([401, 401, 401]);
    });
  });

  describe('refresh token rotation', () => {
    it('merotasi token: token baru berbeda dan bisa dipakai lagi', async () => {
      const rt1 = getRefreshCookie(await register())?.value ?? '';
      const res = await refresh(rt1);
      expect(res.statusCode).toBe(200);
      const rt2 = getRefreshCookie(res)?.value ?? '';
      expect(rt2).not.toBe(rt1);
      expect((await refresh(rt2)).statusCode).toBe(200);
    });

    it('REUSE: memakai ulang token lama ditolak dan mencabut seluruh family', async () => {
      const rt1 = getRefreshCookie(await register())?.value ?? '';
      const rt2 = getRefreshCookie(await refresh(rt1))?.value ?? '';

      expect((await refresh(rt1)).statusCode).toBe(401); // replay of the rotated-out token
      expect((await refresh(rt2)).statusCode).toBe(401); // the legitimate token is revoked too
    });

    it('401 tanpa cookie atau dengan token acak', async () => {
      const none = await t.app.inject({ method: 'POST', url: '/auth/refresh' });
      expect(none.statusCode).toBe(401);
      expect((await refresh('a'.repeat(43))).statusCode).toBe(401);
    });

    it('token kedaluwarsa ditolak', async () => {
      const rt = getRefreshCookie(await register())?.value ?? '';
      await t.db
        .updateTable('refresh_tokens')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .execute();
      expect((await refresh(rt)).statusCode).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('204, mencabut sesi, dan idempotent', async () => {
      const rt = getRefreshCookie(await register())?.value ?? '';
      const out = await t.app.inject({ method: 'POST', url: '/auth/logout', cookies: { rt } });
      expect(out.statusCode).toBe(204);
      expect((await refresh(rt)).statusCode).toBe(401);

      const again = await t.app.inject({ method: 'POST', url: '/auth/logout' });
      expect(again.statusCode).toBe(204);
    });
  });

  describe('rate limit', () => {
    it('429 setelah melewati batas percobaan login', async () => {
      const limited = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) {
          const res = await limited.app.inject({
            method: 'POST',
            url: '/auth/login',
            payload: { email: 'x@example.com', password: 'whatever-123' },
          });
          codes.push(res.statusCode);
        }
        expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
        expect(codes.slice(3)).toEqual([429, 429]);
      } finally {
        await limited.close();
      }
    });
  });
});
