import { z } from 'zod';

/** Who acts (KTD15, R26). The principal always comes from the credential, never the request body. */
export const principalTypes = ['person', 'ai_agent', 'supplier_token', 'system', 'platform_operator'] as const;

export const principalTypeSchema = z.enum(principalTypes);

export type PrincipalType = z.infer<typeof principalTypeSchema>;

/** Tenant-scoped roles (R3). They are additive; no business command is allowed to `tenant_admin` alone. */
export const tenantRoles = ['tenant_admin', 'buyer', 'quality_engineer', 'approver', 'auditor'] as const;

export const tenantRoleSchema = z.enum(tenantRoles);

export type TenantRole = z.infer<typeof tenantRoleSchema>;

/** The listeners requests arrive on (KTD30), plus background jobs, which have no listener. */
export const entryAdapters = ['staff', 'portal', 'drop', 'operator', 'jobs'] as const;

export type EntryAdapter = (typeof entryAdapters)[number];

/**
 * KTD20's high-impact commands. Each requires step-up authentication; a command declares
 * which of these it is, or `standard`. `second_factor_reset` is the audited tenant-admin
 * command that removes a user's step-up factor (KTD20, U29).
 */
export const highImpactCategories = [
  'approval',
  'void',
  'role_change',
  'auditor_grant',
  'break_glass_approval',
  'ai_key_change',
  'drop_credential_issuance',
  'second_factor_reset',
] as const;

export type HighImpactCategory = (typeof highImpactCategories)[number];

export type CommandImpact = 'standard' | HighImpactCategory;
