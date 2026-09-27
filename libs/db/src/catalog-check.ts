import { z } from 'zod';

import {
  backupRole,
  credentialResolverRole,
  grantableRoles,
  migratorRole,
  runtimeRoles,
  type RuntimeRole,
} from './roles.ts';
import { tableAccessManifest } from './schema/index.ts';
import type { TableAccess } from './table-access.ts';

/**
 * The catalog check (KTD11): the database's security-relevant state compared with what the
 * code expects. It runs in CI, after every migration, at API boot and after a restore, and
 * reads only catalogs every role can read, so the app role can run it.
 */

export const catalogViolationCodes = [
  'unexpected_connection_role',
  'missing_role',
  'role_bypasses_row_security',
  'runtime_role_is_superuser',
  'runtime_role_has_membership',
  'missing_table',
  'unknown_table',
  'wrong_owner',
  'row_security_not_enabled',
  'row_security_not_forced',
  'view_not_security_invoker',
  'missing_tenant_column',
  'missing_tenant_foreign_key',
  'missing_tenant_policy',
  'policy_not_tenant_scoped',
  'missing_backup_policy',
  'unexpected_grant',
  'missing_grant',
  'unexpected_column_grant',
  'missing_column_grant',
  'insert_only_table_writable',
  'schema_create_granted',
  'foreign_key_action_not_allowed',
  'unique_key_without_tenant',
  'foreign_key_not_composite',
  'missing_insert_only_trigger',
  'trigger_disabled',
  'unexpected_definer_function',
  'definer_search_path_not_pinned',
  'unexpected_function_grant',
  'missing_function_grant',
  'timestamp_without_time_zone',
] as const;

export type CatalogViolationCode = (typeof catalogViolationCodes)[number];

export interface CatalogViolation {
  readonly code: CatalogViolationCode;
  /** The table, policy, role, function or constraint concerned. */
  readonly object: string;
  readonly detail?: string;
}

export type CatalogCheckResult =
  { readonly ok: true } | { readonly ok: false; readonly violations: readonly CatalogViolation[] };

/** node-postgres `Client`, `PoolClient` and `Pool` all fit. */
export interface CatalogQueryable {
  query(text: string): Promise<{ rows: unknown[] }>;
}

export interface CatalogExpectations {
  readonly tables: readonly TableAccess[];
  /**
   * The role a service must be connected as, for example `pl_app` at API boot. The check
   * then fails for any other session or current user, a superuser or a BYPASSRLS role.
   */
  readonly expectedRuntimeRole?: RuntimeRole;
}

export const shippedExpectations: CatalogExpectations = { tables: tableAccessManifest };

const checkedSchemas = ['public', 'pl_migration'];
const allowedDefinerFunction = 'public.resolve_credential(requested_kind text, requested_id uuid)';
/** EXECUTE grants besides the owner's; every other function in the checked schemas has none. */
const expectedFunctionGrants = new Map<string, readonly string[]>([[allowedDefinerFunction, ['pl_app', 'pl_portal']]]);
/**
 * The one read-all policy besides pl_backup's (KTD37): resolve_credential runs as the
 * resolver role on a table whose row-level security is forced, and must find a credential
 * before any tenant is known.
 */
const resolverReadAll = { table: 'credentials', role: credentialResolverRole };
const pinnedSearchPath = 'search_path=pg_catalog, pg_temp';
const tenantPredicate = (column: string) =>
  `(${column} = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)`;
const generatedIdentifierDefaults = new Set(['gen_random_uuid()', 'uuidv7()', 'uuidv4()']);
const restrictingActions = new Set(['a', 'r']);

const connectionRow = z.object({
  sessionUser: z.string(),
  currentUser: z.string(),
  superuser: z.boolean(),
  bypassRowSecurity: z.boolean(),
});
const roleRow = z.object({ name: z.string(), superuser: z.boolean(), bypassRowSecurity: z.boolean() });
const membershipRow = z.object({ member: z.string(), granted: z.string() });
const relationRow = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.string(),
  owner: z.string(),
  rowSecurity: z.boolean(),
  forceRowSecurity: z.boolean(),
  options: z.array(z.string()).nullable(),
});
const columnRow = z.object({
  table: z.string(),
  name: z.string(),
  type: z.string(),
  notNull: z.boolean(),
  defaultExpression: z.string().nullable(),
});
const policyRow = z.object({
  table: z.string(),
  name: z.string(),
  command: z.string(),
  permissive: z.boolean(),
  roles: z.array(z.string()),
  usingExpression: z.string().nullable(),
  checkExpression: z.string().nullable(),
});
const grantRow = z.object({ table: z.string(), grantee: z.string(), privilege: z.string() });
const columnGrantRow = z.object({ table: z.string(), column: z.string(), grantee: z.string(), privilege: z.string() });
const schemaGrantRow = z.object({ schema: z.string(), grantee: z.string(), privilege: z.string() });
const foreignKeyRow = z.object({
  table: z.string(),
  name: z.string(),
  columns: z.array(z.string()),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  updateAction: z.string(),
  deleteAction: z.string(),
});
const uniqueIndexRow = z.object({
  table: z.string(),
  name: z.string(),
  primary: z.boolean(),
  columns: z.array(z.string()),
});
const triggerRow = z.object({ table: z.string(), name: z.string(), type: z.number(), enabled: z.string() });
const functionRow = z.object({
  schema: z.string(),
  name: z.string(),
  signature: z.string(),
  owner: z.string(),
  securityDefiner: z.boolean(),
  settings: z.array(z.string()),
  grantees: z.array(z.string()),
});

const schemaList = checkedSchemas.map((schema) => `'${schema}'`).join(', ');

const queries = {
  connection: `
    select session_user::text as "sessionUser", current_user::text as "currentUser",
           role.rolsuper as "superuser", role.rolbypassrls as "bypassRowSecurity"
      from pg_catalog.pg_roles role
     where role.rolname in (session_user, current_user)
     order by role.rolsuper desc, role.rolbypassrls desc
     limit 1`,
  roles: `select rolname as "name", rolsuper as "superuser", rolbypassrls as "bypassRowSecurity" from pg_catalog.pg_roles`,
  memberships: `
    select member_role.rolname as "member", granted_role.rolname as "granted"
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member_role on member_role.oid = membership.member
      join pg_catalog.pg_roles granted_role on granted_role.oid = membership.roleid`,
  relations: `
    select namespace.nspname as "schema", relation.relname as "name", relation.relkind::text as "kind",
           pg_catalog.pg_get_userbyid(relation.relowner) as "owner",
           relation.relrowsecurity as "rowSecurity", relation.relforcerowsecurity as "forceRowSecurity",
           relation.reloptions::text[] as "options"
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname in (${schemaList}) and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
  columns: `
    select relation.relname as "table", attribute.attname as "name",
           pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as "type",
           attribute.attnotnull as "notNull",
           pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid) as "defaultExpression"
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      left join pg_catalog.pg_attrdef attribute_default
        on attribute_default.adrelid = attribute.attrelid and attribute_default.adnum = attribute.attnum
     where relation.relnamespace = 'public'::regnamespace and relation.relkind in ('r', 'p', 'v', 'm', 'f')
       and attribute.attnum > 0 and not attribute.attisdropped`,
  policies: `
    select relation.relname as "table", policy.polname as "name", policy.polcmd::text as "command",
           policy.polpermissive as "permissive",
           array(select case when role_id = 0 then 'public' else pg_catalog.pg_get_userbyid(role_id) end
                   from unnest(policy.polroles) as role_id order by 1)::text[] as "roles",
           pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) as "usingExpression",
           pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) as "checkExpression"
      from pg_catalog.pg_policy policy
      join pg_catalog.pg_class relation on relation.oid = policy.polrelid
     where relation.relnamespace = 'public'::regnamespace`,
  grants: `
    select relation.relname as "table",
           case when acl.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(acl.grantee) end as "grantee",
           acl.privilege_type as "privilege"
      from pg_catalog.pg_class relation
     cross join lateral pg_catalog.aclexplode(relation.relacl) acl
     where relation.relnamespace = 'public'::regnamespace and acl.grantee <> relation.relowner`,
  columnGrants: `
    select relation.relname as "table", attribute.attname as "column",
           case when acl.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(acl.grantee) end as "grantee",
           acl.privilege_type as "privilege"
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
     cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
     where relation.relnamespace = 'public'::regnamespace and acl.grantee <> relation.relowner`,
  schemaGrants: `
    select namespace.nspname as "schema",
           case when acl.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(acl.grantee) end as "grantee",
           acl.privilege_type as "privilege"
      from pg_catalog.pg_namespace namespace
     cross join lateral pg_catalog.aclexplode(namespace.nspacl) acl
     where namespace.nspname in (${schemaList})`,
  foreignKeys: `
    select relation.relname as "table", constraint_row.conname as "name",
           array(select attribute.attname from unnest(constraint_row.conkey) with ordinality as key(number, position)
                   join pg_catalog.pg_attribute attribute
                     on attribute.attrelid = constraint_row.conrelid and attribute.attnum = key.number
                  order by key.position)::text[] as "columns",
           referenced.relname as "referencedTable",
           array(select attribute.attname from unnest(constraint_row.confkey) with ordinality as key(number, position)
                   join pg_catalog.pg_attribute attribute
                     on attribute.attrelid = constraint_row.confrelid and attribute.attnum = key.number
                  order by key.position)::text[] as "referencedColumns",
           constraint_row.confupdtype::text as "updateAction", constraint_row.confdeltype::text as "deleteAction"
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_class referenced on referenced.oid = constraint_row.confrelid
     where constraint_row.contype = 'f'
       and (relation.relnamespace = 'public'::regnamespace or referenced.relnamespace = 'public'::regnamespace)`,
  uniqueIndexes: `
    select relation.relname as "table", index_relation.relname as "name", index_row.indisprimary as "primary",
           array(select coalesce(attribute.attname, '(expression)')
                   from unnest((index_row.indkey::int2[])[0:index_row.indnkeyatts - 1]) with ordinality as key(number, position)
                   left join pg_catalog.pg_attribute attribute
                     on attribute.attrelid = index_row.indrelid and attribute.attnum = key.number
                  order by key.position)::text[] as "columns"
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
     where index_row.indisunique and relation.relnamespace = 'public'::regnamespace`,
  triggers: `
    select relation.relname as "table", trigger_row.tgname as "name", trigger_row.tgtype::int as "type",
           trigger_row.tgenabled::text as "enabled"
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
     where relation.relnamespace = 'public'::regnamespace and not trigger_row.tgisinternal`,
  functions: `
    select namespace.nspname as "schema", routine.proname as "name",
           namespace.nspname || '.' || routine.proname || '(' || pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')' as "signature",
           pg_catalog.pg_get_userbyid(routine.proowner) as "owner", routine.prosecdef as "securityDefiner",
           coalesce(routine.proconfig, '{}')::text[] as "settings",
           array(select case when acl.grantee = 0 then 'public' else pg_catalog.pg_get_userbyid(acl.grantee) end
                   from pg_catalog.aclexplode(coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))) acl
                  where acl.privilege_type = 'EXECUTE' and acl.grantee <> routine.proowner
                  order by 1)::text[] as "grantees"
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname not in ('pg_catalog', 'information_schema')
       and namespace.nspname not like 'pg\\_toast%' and namespace.nspname not like 'pg\\_temp%'`,
} as const;

async function load<Row>(client: CatalogQueryable, text: string, row: z.ZodType<Row>): Promise<Row[]> {
  const result = await client.query(text);
  return z.array(row).parse(result.rows);
}

const triggerType = { row: 1, before: 2, insert: 4, delete: 8, update: 16, truncate: 32 } as const;

export async function checkCatalog(
  client: CatalogQueryable,
  expectations: CatalogExpectations = shippedExpectations,
): Promise<CatalogCheckResult> {
  // One query at a time: a single client must not run concurrent queries.
  const connection = await load(client, queries.connection, connectionRow);
  const roles = await load(client, queries.roles, roleRow);
  const memberships = await load(client, queries.memberships, membershipRow);
  const relations = await load(client, queries.relations, relationRow);
  const columns = await load(client, queries.columns, columnRow);
  const policies = await load(client, queries.policies, policyRow);
  const grants = await load(client, queries.grants, grantRow);
  const columnGrants = await load(client, queries.columnGrants, columnGrantRow);
  const schemaGrants = await load(client, queries.schemaGrants, schemaGrantRow);
  const foreignKeys = await load(client, queries.foreignKeys, foreignKeyRow);
  const uniqueIndexes = await load(client, queries.uniqueIndexes, uniqueIndexRow);
  const triggers = await load(client, queries.triggers, triggerRow);
  const functions = await load(client, queries.functions, functionRow);

  const violations: CatalogViolation[] = [];
  const report = (code: CatalogViolationCode, object: string, detail?: string) => {
    violations.push(detail === undefined ? { code, object } : { code, object, detail });
  };

  const expectedTables = new Map(expectations.tables.map((access) => [access.table, access]));
  const publicTables = relations.filter((relation) => relation.schema === 'public' && isTable(relation.kind));
  const tenantKeyOf = (table: string) => expectedTables.get(table)?.tenantKey;
  const isTenantOwned = (table: string) => tenantKeyOf(table) === 'tenant_id';

  if (expectations.expectedRuntimeRole !== undefined) {
    const expected = expectations.expectedRuntimeRole;
    const session = connection[0];
    if (
      session === undefined ||
      session.sessionUser !== expected ||
      session.currentUser !== expected ||
      session.superuser ||
      session.bypassRowSecurity
    ) {
      report(
        'unexpected_connection_role',
        session?.sessionUser ?? 'unknown',
        `expected ${expected}, connected as ${session?.sessionUser ?? 'unknown'}/${session?.currentUser ?? 'unknown'}`,
      );
    }
  }

  // Roles.
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  for (const name of [migratorRole, credentialResolverRole, ...runtimeRoles]) {
    const role = roleByName.get(name);
    if (role === undefined) {
      report('missing_role', name);
    } else if (role.superuser) {
      report('runtime_role_is_superuser', name);
    }
  }
  for (const role of roles) {
    if (role.bypassRowSecurity && !role.superuser) {
      report('role_bypasses_row_security', role.name);
    }
  }
  const runtimeRoleNames = new Set<string>(runtimeRoles);
  for (const membership of memberships) {
    if (runtimeRoleNames.has(membership.member)) {
      report('runtime_role_has_membership', membership.member, membership.granted);
    }
  }

  // Tables, ownership and row-level security.
  const tableNames = new Set(publicTables.map((relation) => relation.name));
  for (const table of expectedTables.keys()) {
    if (!tableNames.has(table)) {
      report('missing_table', table);
    }
  }
  for (const relation of relations) {
    const qualifiedName = `${relation.schema}.${relation.name}`;
    if (relation.owner !== migratorRole) {
      report('wrong_owner', qualifiedName, relation.owner);
    }
    if (relation.kind === 'v' && !(relation.options ?? []).includes('security_invoker=true')) {
      report('view_not_security_invoker', qualifiedName);
    }
    if (!isTable(relation.kind)) {
      continue;
    }
    if (relation.schema === 'public' && !expectedTables.has(relation.name)) {
      report('unknown_table', qualifiedName);
    }
    if (!relation.rowSecurity) {
      report('row_security_not_enabled', qualifiedName);
    }
    if (!relation.forceRowSecurity) {
      report('row_security_not_forced', qualifiedName);
    }
  }

  for (const column of columns) {
    if (/^(timestamp|time)(\(\d+\))? without time zone$/.test(column.type)) {
      report('timestamp_without_time_zone', `${column.table}.${column.name}`, column.type);
    }
  }

  for (const access of expectations.tables) {
    if (!tableNames.has(access.table)) {
      continue;
    }
    const tableColumns = columns.filter((column) => column.table === access.table);
    if (access.tenantKey === 'tenant_id') {
      const tenantColumn = tableColumns.find((column) => column.name === 'tenant_id');
      if (tenantColumn === undefined || tenantColumn.type !== 'uuid' || !tenantColumn.notNull) {
        report('missing_tenant_column', access.table);
      }
      const referencesTenants = foreignKeys.some(
        (key) =>
          key.table === access.table &&
          key.referencedTable === 'tenants' &&
          sameList(key.columns, ['tenant_id']) &&
          sameList(key.referencedColumns, ['id']),
      );
      if (!referencesTenants) {
        report('missing_tenant_foreign_key', access.table);
      }
    }

    checkPolicies(access, policies, report);
    checkGrants(access, grants, columnGrants, report);

    if (isGuarded(access)) {
      checkInsertOnlyTriggers(access.table, triggers, report);
    }

    for (const index of uniqueIndexes.filter((candidate) => candidate.table === access.table)) {
      if (access.tenantKey !== 'tenant_id' || index.columns.includes('tenant_id')) {
        continue;
      }
      if (!isGeneratedIdentifierKey(index, tableColumns)) {
        report('unique_key_without_tenant', `${access.table}.${index.name}`, index.columns.join(', '));
      }
    }
  }

  for (const trigger of triggers) {
    if (trigger.enabled === 'D') {
      report('trigger_disabled', `${trigger.table}.${trigger.name}`);
    }
  }

  // Foreign keys: composite between tenant-owned tables, never cascading into insert-only tables.
  const insertOnlyTables = new Set(expectations.tables.filter(isGuarded).map((access) => access.table));
  for (const key of foreignKeys) {
    const object = `${key.table}.${key.name}`;
    if (!restrictingActions.has(key.updateAction)) {
      report('foreign_key_action_not_allowed', object, `on update ${key.updateAction}`);
    }
    if (insertOnlyTables.has(key.table) && !restrictingActions.has(key.deleteAction)) {
      report('foreign_key_action_not_allowed', object, `on delete ${key.deleteAction}`);
    }
    if (isTenantOwned(key.table) && isTenantOwned(key.referencedTable)) {
      const tenantPosition = key.columns.indexOf('tenant_id');
      if (tenantPosition === -1 || key.referencedColumns[tenantPosition] !== 'tenant_id') {
        report('foreign_key_not_composite', object, `${key.columns.join(', ')} -> ${key.referencedTable}`);
      }
    }
  }

  // Schemas: only the owner creates objects.
  for (const grant of schemaGrants) {
    if (grant.privilege === 'CREATE' && grant.grantee !== migratorRole && grant.grantee !== 'pg_database_owner') {
      report('schema_create_granted', grant.schema, grant.grantee);
    }
  }

  // Functions: one definer function, with a pinned search_path; nothing executable by PUBLIC.
  for (const routine of functions) {
    const inCheckedSchema = checkedSchemas.includes(routine.schema);
    if (routine.securityDefiner) {
      if (routine.signature !== allowedDefinerFunction) {
        report('unexpected_definer_function', routine.signature);
      } else if (!routine.settings.includes(pinnedSearchPath)) {
        report('definer_search_path_not_pinned', routine.signature);
      }
    }
    if (inCheckedSchema) {
      const expectedOwner = routine.signature === allowedDefinerFunction ? credentialResolverRole : migratorRole;
      if (routine.owner !== expectedOwner) {
        report('wrong_owner', routine.signature, routine.owner);
      }
      const expectedGrantees = new Set(expectedFunctionGrants.get(routine.signature) ?? []);
      const actualGrantees = new Set(routine.grantees);
      compareSets(
        expectedGrantees,
        actualGrantees,
        routine.signature,
        'missing_function_grant',
        'unexpected_function_grant',
        report,
      );
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

type Report = (code: CatalogViolationCode, object: string, detail?: string) => void;

function isTable(kind: string): boolean {
  return kind === 'r' || kind === 'p';
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, position) => value === right[position]);
}

function isGeneratedIdentifierKey(
  index: z.infer<typeof uniqueIndexRow>,
  tableColumns: readonly z.infer<typeof columnRow>[],
): boolean {
  if (!index.primary || index.columns.length !== 1) {
    return false;
  }
  const column = tableColumns.find((candidate) => candidate.name === index.columns[0]);
  return (
    column !== undefined &&
    column.type === 'uuid' &&
    column.defaultExpression !== null &&
    generatedIdentifierDefaults.has(column.defaultExpression)
  );
}

function checkPolicies(access: TableAccess, policies: readonly z.infer<typeof policyRow>[], report: Report): void {
  const predicate = tenantPredicate(access.tenantKey);
  const readAllRoles = new Set<string>([backupRole]);
  if (access.table === resolverReadAll.table) {
    readAllRoles.add(resolverReadAll.role);
  }
  const tablePolicies = policies.filter((policy) => policy.table === access.table);
  let hasTenantPolicy = false;
  const readAllCovered = new Set<string>();

  for (const policy of tablePolicies) {
    const object = `${access.table}.${policy.name}`;
    if (!policy.permissive) {
      // Restrictive policies can only narrow what the tenant policy allows.
      continue;
    }
    const onlyRole = policy.roles.length === 1 ? policy.roles[0] : undefined;
    if (
      onlyRole !== undefined &&
      readAllRoles.has(onlyRole) &&
      policy.command === 'r' &&
      policy.usingExpression === 'true' &&
      policy.checkExpression === null
    ) {
      readAllCovered.add(onlyRole);
      continue;
    }
    const effectiveCheck = policy.checkExpression ?? policy.usingExpression;
    const scoped = (expression: string | null) => expression === null || isTenantScoped(expression, predicate);
    const needsUsing = policy.command !== 'a';
    const needsCheck = policy.command === 'a' || policy.command === 'w' || policy.command === '*';
    if (
      (needsUsing && (policy.usingExpression === null || !scoped(policy.usingExpression))) ||
      (needsCheck && (effectiveCheck === null || !scoped(effectiveCheck)))
    ) {
      report('policy_not_tenant_scoped', object, policy.usingExpression ?? policy.checkExpression ?? '');
      continue;
    }
    hasTenantPolicy = true;
  }

  if (!hasTenantPolicy) {
    report('missing_tenant_policy', access.table);
  }
  if (!readAllCovered.has(backupRole)) {
    report('missing_backup_policy', access.table);
  }
}

/** The predicate itself, or the predicate as the first conjunct, with no OR, CASE or COALESCE. */
function isTenantScoped(expression: string, predicate: string): boolean {
  if (/\b(OR|CASE|COALESCE)\b/i.test(expression)) {
    return false;
  }
  return expression === predicate || expression.startsWith(`(${predicate} AND `);
}

function checkGrants(
  access: TableAccess,
  grants: readonly z.infer<typeof grantRow>[],
  columnGrants: readonly z.infer<typeof columnGrantRow>[],
  report: Report,
): void {
  const expected = new Set<string>([`${backupRole}:SELECT`]);
  for (const role of grantableRoles) {
    for (const privilege of access.grants[role] ?? []) {
      expected.add(`${role}:${privilege}`);
    }
  }
  const actual = new Set(
    grants.filter((grant) => grant.table === access.table).map((grant) => `${grant.grantee}:${grant.privilege}`),
  );
  compareSets(expected, actual, access.table, 'missing_grant', 'unexpected_grant', report);

  const expectedColumns = new Set<string>();
  for (const role of grantableRoles) {
    for (const [column, privileges] of Object.entries(access.columnGrants?.[role] ?? {})) {
      for (const privilege of privileges) {
        expectedColumns.add(`${role}:${column}:${privilege}`);
      }
    }
  }
  const actualColumns = new Set(
    columnGrants
      .filter((grant) => grant.table === access.table)
      .map((grant) => `${grant.grantee}:${grant.column}:${grant.privilege}`),
  );
  compareSets(expectedColumns, actualColumns, access.table, 'missing_column_grant', 'unexpected_column_grant', report);

  if (isGuarded(access)) {
    // An erase-only table may grant column-level UPDATE; its guard trigger allows only an erasure.
    const writable = access.insertOnly === true ? [...actual, ...actualColumns] : [...actual];
    for (const entry of writable) {
      if (/:(UPDATE|DELETE)$/.test(entry)) {
        report('insert_only_table_writable', access.table, entry);
      }
    }
  }
}

/** Audit tables: insert-only, or erase-only like the commitment store. */
function isGuarded(access: TableAccess): boolean {
  return access.insertOnly === true || access.eraseOnly === true;
}

function compareSets(
  expected: ReadonlySet<string>,
  actual: ReadonlySet<string>,
  table: string,
  missingCode: CatalogViolationCode,
  unexpectedCode: CatalogViolationCode,
  report: Report,
): void {
  for (const entry of expected) {
    if (!actual.has(entry)) {
      report(missingCode, table, entry);
    }
  }
  for (const entry of actual) {
    if (!expected.has(entry)) {
      report(unexpectedCode, table, entry);
    }
  }
}

function checkInsertOnlyTriggers(table: string, triggers: readonly z.infer<typeof triggerRow>[], report: Report): void {
  const guards = triggers.filter(
    (trigger) => trigger.table === table && (trigger.type & triggerType.before) !== 0 && trigger.enabled !== 'D',
  );
  for (const [event, bit] of [
    ['update', triggerType.update],
    ['delete', triggerType.delete],
    ['truncate', triggerType.truncate],
  ] as const) {
    if (!guards.some((trigger) => (trigger.type & bit) !== 0)) {
      report('missing_insert_only_trigger', table, event);
    }
  }
}

export function describeViolations(violations: readonly CatalogViolation[]): string {
  return violations
    .map((violation) =>
      violation.detail === undefined
        ? `${violation.code}: ${violation.object}`
        : `${violation.code}: ${violation.object} (${violation.detail})`,
    )
    .join('\n');
}
