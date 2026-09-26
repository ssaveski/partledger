import { describeViolations } from '../src/catalog-check.ts';
import { migrateDatabase } from '../src/migrate.ts';

// Connects as pl_migrator through the standard libpq variables (PGHOST, PGUSER, …), so the
// migrator's password never appears on a command line.
const result = await migrateDatabase();

if (result.ok) {
  console.log('Migrations applied; the catalog check passes.');
} else {
  console.error(`Migrations applied, but the catalog check fails:\n${describeViolations(result.violations)}`);
  process.exitCode = 1;
}
