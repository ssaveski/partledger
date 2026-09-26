import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Time is `timestamptz` only (KTD12); drizzle binds a `Date` as an ISO string, so the
 * stored instant never depends on the process time zone.
 */
export function timestamptz<TName extends string>(name: TName) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/**
 * A primary key the database generates. It is the one unique key on a tenant-owned table
 * that may omit `tenant_id` (KTD11): a random uuid reveals nothing about another tenant.
 */
export function generatedIdentifier() {
  return uuid('id').primaryKey().defaultRandom();
}

/** The owning tenant of a row; row-level security compares it with `app.tenant_id`. */
export function tenantIdentifier() {
  return uuid('tenant_id').notNull();
}

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
