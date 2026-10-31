import { Redis } from 'ioredis';
import { buildApp } from './app';
import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { PRESENCE, REDIS_KEYS } from './lib/redis-keys';
import { startGhostSweeper } from './modules/drivers/ghost-sweeper';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  // Fail fast on a Redis outage instead of queueing commands for minutes.
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const app = await buildApp({ env, db, redis });
  redis.on('error', (err: Error) => app.log.error({ err }, 'redis error'));

  const sweeper = startGhostSweeper({
    presence: app.presence,
    logger: app.log,
    intervalMs: PRESENCE.SWEEP_INTERVAL_MS,
    // Only one instance sweeps per round. The lock expires a bit before the next round.
    tryAcquireLock: async () =>
      (await redis.set(
        REDIS_KEYS.sweeperLock,
        '1',
        'PX',
        Math.floor(PRESENCE.SWEEP_INTERVAL_MS * 0.8),
        'NX',
      )) === 'OK',
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      sweeper.stop();
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
