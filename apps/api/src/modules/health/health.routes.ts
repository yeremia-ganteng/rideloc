import type { FastifyPluginAsync } from 'fastify';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types';
import { buildHealth } from '../../health';

export const healthRoutes: FastifyPluginAsync<{ db: Kysely<Database>; redis: Redis }> = async (
  app,
  { db, redis },
) => {
  app.get('/health', async (_req, reply) => {
    let ok = true;
    try {
      await sql`select 1`.execute(db);
    } catch (err) {
      ok = false;
      app.log.error({ err }, 'health: database check failed');
    }
    try {
      await redis.ping();
    } catch (err) {
      ok = false;
      app.log.error({ err }, 'health: redis check failed');
    }
    return reply.status(ok ? 200 : 503).send(buildHealth(process.uptime(), ok));
  });
};
