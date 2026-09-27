export {
  catalogViolationCodes,
  checkCatalog,
  describeViolations,
  shippedExpectations,
  type CatalogCheckResult,
  type CatalogExpectations,
  type CatalogQueryable,
  type CatalogViolation,
  type CatalogViolationCode,
} from './catalog-check.ts';
export {
  credentialIdSchema,
  credentialKindSchema,
  credentialSecretSchema,
  generateCredentialSecret,
  hashCredentialSecret,
  issueCredential,
  verifyCredential,
  type CredentialRefusal,
  type CredentialVerification,
  type IssueCredentialInput,
  type IssuedCredential,
  type ParameterisedQueryable,
  type PresentedCredential,
  type ResolvedCredential,
  type SqlExecutor,
} from './credentials/credential-store.ts';
export { migrateDatabase, migrationsFolder } from './migrate.ts';
export {
  backupRole,
  credentialResolverRole,
  grantableRoles,
  migratorRole,
  runtimeRoles,
  type GrantableRole,
  type RuntimeRole,
} from './roles.ts';
export * as schema from './schema/index.ts';
export type { CredentialKind, StaffSessionEndReason } from './schema/index.ts';
export { tableAccessManifest } from './schema/index.ts';
export { defineTableAccess, type TableAccess, type TablePrivilege } from './table-access.ts';
