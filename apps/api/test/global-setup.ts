import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url; // inherited by test workers

  // Run the real migrations through the same CLI used in dev/prod.
  execSync('pnpm exec node-pg-migrate up --migrations-dir migrations', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
