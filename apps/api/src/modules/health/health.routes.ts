import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types';
import { buildHealth } from '../../health';

export const healthRoutes: FastifyPluginAsync<{ db: Kysely<Database> }> = async (app, { db }) => {
  app.get('/health', async (_req, reply) => {
    let dbUp = true;
    try {
      await sql`select 1`.execute(db);
    } catch (err) {
      dbUp = false;
      app.log.error({ err }, 'health: database check failed');
    }
    return reply.status(dbUp ? 200 : 503).send(buildHealth(process.uptime(), dbUp));
  });
};
