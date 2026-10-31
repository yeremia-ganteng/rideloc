import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedTestContainer | undefined;

export async function setup(): Promise<void> {
  postgres = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  const url = postgres.getConnectionUri();
  process.env.DATABASE_URL = url; // inherited by test workers

  redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

  // Run the real migrations through the same CLI used in dev/prod.
  execSync('pnpm exec node-pg-migrate up --migrations-dir migrations', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await postgres?.stop();
  await redis?.stop();
}
