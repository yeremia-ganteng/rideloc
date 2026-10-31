import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { buildApp } from './app';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close(); // stop accepting requests, finish in-flight ones
      await db.destroy(); // close the pg pool
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
