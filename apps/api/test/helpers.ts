import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { AuthResponse } from '@rideloc/shared';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createDb } from '../src/db/client';
import type { RoutingClient } from '../src/modules/routing/types';

export async function createTestApp(
  overrides: Record<string, string> = {},
  routing?: RoutingClient,
) {
  // Never fall back to the default (dev) Redis: tests FLUSHDB.
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set: did global-setup run?');

  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: redisUrl,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    ESTIMATE_RATE_LIMIT_MAX: '100000',
    ...overrides,
  });
  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const app = await buildApp({ env, db, redis, ...(routing ? { routing } : {}) });
  await app.ready();
  return {
    app,
    db,
    redis,
    async close(): Promise<void> {
      await app.close();
      await redis.quit();
      await db.destroy();
    },
  };
}

export async function resetDb(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<void> {
  await sql`TRUNCATE refresh_tokens, drivers, users RESTART IDENTITY CASCADE`.execute(db);
}

export async function resetRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}

export function getRefreshCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === 'rt');
}

export async function registerDriver(
  app: FastifyInstance,
  email = 'budi@example.com',
  plateNumber = 'B 1234 XYZ',
): Promise<{ id: string; token: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email,
      password: 'correct-horse-9',
      fullName: 'Budi Driver',
      role: 'DRIVER',
      vehicleType: 'MOTORCYCLE',
      plateNumber,
    },
  });
  const body = res.json<AuthResponse>();
  return { id: body.user.id, token: body.accessToken };
}

export async function registerRider(
  app: FastifyInstance,
  email = 'rina@example.com',
): Promise<{ id: string; token: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'correct-horse-9', fullName: 'Rina Penumpang', role: 'RIDER' },
  });
  const body = res.json<AuthResponse>();
  return { id: body.user.id, token: body.accessToken };
}

/** Driver ids found within radiusM meters of a point, nearest first. */
export async function geoNear(
  redis: Redis,
  lng: number,
  lat: number,
  radiusM: number,
): Promise<string[]> {
  const found = await redis.call(
    'GEOSEARCH',
    'drivers:geo',
    'FROMLONLAT',
    String(lng),
    String(lat),
    'BYRADIUS',
    String(radiusM),
    'm',
    'ASC',
  );
  return found as string[];
}
