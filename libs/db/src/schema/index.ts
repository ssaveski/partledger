import type { TableAccess } from '../table-access.ts';
import { auditEntriesAccess } from './audit-entries.ts';
import { commitmentsAccess } from './commitments.ts';
import { credentialsAccess } from './credentials.ts';
import { idempotencyKeysAccess } from './idempotency-keys.ts';
import { staffSessionsAccess } from './staff-sessions.ts';
import { tenantsAccess } from './tenants.ts';

export { auditActorTypes, auditEntries } from './audit-entries.ts';
export { commitments } from './commitments.ts';
export { credentialKinds, credentials, type CredentialKind } from './credentials.ts';
export { idempotencyKeys } from './idempotency-keys.ts';
export { staffSessionEndReasons, staffSessions, type StaffSessionEndReason } from './staff-sessions.ts';
export { tenantRegions, tenants } from './tenants.ts';

/** Every table in the `public` schema with its expected access; the catalog check compares them exactly. */
export const tableAccessManifest: readonly TableAccess[] = [
  tenantsAccess,
  credentialsAccess,
  idempotencyKeysAccess,
  auditEntriesAccess,
  commitmentsAccess,
  staffSessionsAccess,
];
