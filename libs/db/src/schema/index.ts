import type { TableAccess } from '../table-access.ts';
import { auditEntriesAccess } from './audit-entries.ts';
import { commitmentsAccess } from './commitments.ts';
import { credentialsAccess } from './credentials.ts';
import { directoryEntriesAccess } from './directory-entries.ts';
import { idempotencyKeysAccess } from './idempotency-keys.ts';
import { staffSessionsAccess } from './staff-sessions.ts';
import { jobItemOutcomesAccess } from './job-item-outcomes.ts';
import { alertRecipientsAccess, notificationsAccess } from './notifications.ts';
import { membershipsAccess, roleAssignmentsAccess } from './memberships.ts';
import { operationalAlertsAccess } from './operational-alerts.ts';
import { tenantsAccess } from './tenants.ts';
import { aiSuggestionsAccess } from './ai-suggestions.ts';
import { tenantAiKeysAccess } from './tenant-ai-keys.ts';

export { auditActorTypes, auditEntries } from './audit-entries.ts';
export { commitments } from './commitments.ts';
export { credentialKinds, credentials, type CredentialKind } from './credentials.ts';
export { directoryEntries } from './directory-entries.ts';
export { idempotencyKeys } from './idempotency-keys.ts';
export { staffSessionEndReasons, staffSessions, type StaffSessionEndReason } from './staff-sessions.ts';
export { jobItemOutcomes, jobItemStatuses } from './job-item-outcomes.ts';
export {
  alertRecipients,
  notificationChannels,
  notificationRecipientKinds,
  notifications,
  notificationStatuses,
  operatorRecipientId,
} from './notifications.ts';
export { memberRoles, memberships, roleAssignments } from './memberships.ts';
export { operationalAlerts } from './operational-alerts.ts';
export { aiProviders, marketPacks, supplierListSources, tenantRegions, tenants } from './tenants.ts';
export {
  aiConfigurationSources,
  aiProcessingRegions,
  aiSuggestions,
  suggestionStatuses,
  suggestionTargetTypes,
} from './ai-suggestions.ts';
export { tenantAiKeyProviders, tenantAiKeys } from './tenant-ai-keys.ts';

/** Every table in the `public` schema with its expected access; the catalog check compares them exactly. */
export const tableAccessManifest: readonly TableAccess[] = [
  tenantsAccess,
  credentialsAccess,
  idempotencyKeysAccess,
  auditEntriesAccess,
  commitmentsAccess,
  staffSessionsAccess,
  jobItemOutcomesAccess,
  operationalAlertsAccess,
  notificationsAccess,
  alertRecipientsAccess,
  membershipsAccess,
  roleAssignmentsAccess,
  directoryEntriesAccess,
  tenantAiKeysAccess,
  aiSuggestionsAccess,
];
