import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { checkCatalog, type CatalogCheckResult } from './catalog-check.ts';

export const migrationsFolder = join(import.meta.dirname, '..', 'migrations');

/**
 * Applies the drizzle-kit migrations, generated and hand-written, in journal order as
 * `pl_migrator`, then runs the catalog check. Before the first run an operator creates
 * `pl_migrator` (LOGIN, CREATEROLE, no BYPASSRLS) and the database it owns. Without a
 * connection string, node-postgres reads the standard `PGHOST`, `PGUSER`, … variables.
 */
export async function migrateDatabase(migratorConnectionString?: string): Promise<CatalogCheckResult> {
  const client = new pg.Client({ connectionString: migratorConnectionString, options: '-c TimeZone=UTC' });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    return await checkCatalog(client);
  } finally {
    await client.end();
  }
}
