import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './types';

export function createDb(connectionString: string): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
