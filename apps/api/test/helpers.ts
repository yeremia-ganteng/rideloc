import type { LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createDb } from '../src/db/client';
import type { RoutingClient } from '../src/modules/routing/types';

export async function createTestApp(
  overrides: Record<string, string> = {},
  routing?: RoutingClient,
) {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    ESTIMATE_RATE_LIMIT_MAX: '100000',
    ...overrides,
  });
  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db, ...(routing ? { routing } : {}) });
  await app.ready();
  return {
    app,
    db,
    async close(): Promise<void> {
      await app.close();
      await db.destroy();
    },
  };
}

export async function resetDb(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<void> {
  await sql`TRUNCATE refresh_tokens, drivers, users RESTART IDENTITY CASCADE`.execute(db);
}

export function getRefreshCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === 'rt');
}
