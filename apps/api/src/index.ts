import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { startPeriodicJob } from './lib/periodic-job';
import { PRESENCE, REDIS_KEYS } from './lib/redis-keys';
import { startGhostSweeper } from './modules/drivers/ghost-sweeper';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  // Fail fast on a Redis outage instead of queueing commands for minutes.
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const app = await buildApp({ env, db, redis });
  redis.on('error', (err: Error) => app.log.error({ err }, 'redis error'));

  // Only one instance runs each job per round. The lock expires a bit before the next round.
  const lockFor = (key: string, intervalMs: number) => async (): Promise<boolean> =>
    (await redis.set(key, '1', 'PX', Math.floor(intervalMs * 0.8), 'NX')) === 'OK';

  const sweeper = startGhostSweeper({
    presence: app.presence,
    logger: app.log,
    intervalMs: PRESENCE.SWEEP_INTERVAL_MS,
    tryAcquireLock: lockFor(REDIS_KEYS.sweeperLock, PRESENCE.SWEEP_INTERVAL_MS),
  });

  const matchingJob = startPeriodicJob({
    name: 'matching',
    run: async () => {
      await app.matching.tick();
    },
    tryAcquireLock: lockFor(REDIS_KEYS.matchingLock, env.MATCH_TICK_MS),
    logger: app.log,
    intervalMs: env.MATCH_TICK_MS,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      sweeper.stop();
      matchingJob.stop();
      await app.close(); // disconnects sockets, stops accepting requests, finishes in-flight ones
      await redis.quit();
      await db.destroy();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
