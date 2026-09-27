import type { TableAccess } from '../table-access.ts';
import { credentialsAccess } from './credentials.ts';
import { idempotencyKeysAccess } from './idempotency-keys.ts';
import { tenantsAccess } from './tenants.ts';

export { credentialKinds, credentials, type CredentialKind } from './credentials.ts';
export { idempotencyKeys } from './idempotency-keys.ts';
export { tenantRegions, tenants } from './tenants.ts';

/** Every table in the `public` schema with its expected access; the catalog check compares them exactly. */
export const tableAccessManifest: readonly TableAccess[] = [tenantsAccess, credentialsAccess, idempotencyKeysAccess];
