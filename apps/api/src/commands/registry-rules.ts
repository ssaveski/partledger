import {
  operationNamePattern,
  type CommandDeclaration,
  type OperationDeclaration,
  type QueryDeclaration,
} from '@partledger/contracts';
import { z } from 'zod';

import { isAllowed } from '../principals/authorize';
import type { OperationRegistry } from './handlers';

/**
 * Rules every declaration in the registry must follow. They run when the API builds its
 * routes, so a registry that breaks one refuses to boot, and in the registry's unit tests.
 */

export type RegistryRule =
  | 'name_malformed'
  | 'name_duplicated'
  | 'schema_not_described'
  | 'input_names_principal'
  | 'expected_version_mismatch'
  | 'output_not_id_only'
  | 'no_principal_allowed'
  | 'error_duplicated'
  | 'tenant_admin_alone'
  | 'high_impact_without_step_up';

export interface RegistryViolation {
  readonly rule: RegistryRule;
  readonly operation: string;
  readonly detail?: string;
}

/** The principal and tenant come from the credential; an input field carrying them would invite trusting the body (KTD15). */
const principalFieldNames = new Set(['tenantId', 'principal', 'principalType', 'actor', 'actorType', 'actorId']);

const tenantAdminAlone = {
  type: 'person',
  tenantId: '00000000-0000-4000-8000-000000000000',
  userId: '00000000-0000-4000-8000-000000000000',
  roles: ['tenant_admin'],
  stepUp: null,
  actedUnder: { grant: 'staff_session', credentialId: '00000000-0000-4000-8000-000000000000' },
  adapter: 'staff',
  correlationId: '00000000-0000-4000-8000-000000000000',
} as const;

export function registryViolations(registry: OperationRegistry): RegistryViolation[] {
  const violations: RegistryViolation[] = [];
  const report = (rule: RegistryRule, operation: string, detail?: string) => {
    violations.push(detail === undefined ? { rule, operation } : { rule, operation, detail });
  };
  const declarations: OperationDeclaration[] = [
    ...registry.commands.map((registration) => registration.declaration),
    ...registry.queries.map((registration) => registration.declaration),
  ];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.name)) {
      report('name_duplicated', declaration.name);
    }
    seen.add(declaration.name);
    for (const [rule, detail] of declarationViolations(declaration)) {
      report(rule, declaration.name, detail);
    }
  }
  return violations;
}

type Finding = readonly [RegistryRule, string?];

export function declarationViolations(declaration: OperationDeclaration): Finding[] {
  const findings: Finding[] = [];
  if (!operationNamePattern.test(declaration.name)) {
    findings.push(['name_malformed']);
  }
  findings.push(
    ...describedViolations('input', declaration.input),
    ...describedViolations('output', declaration.output),
  );
  for (const field of Object.keys(declaration.input.shape)) {
    if (principalFieldNames.has(field)) {
      findings.push(['input_names_principal', field]);
    }
  }
  if (Object.keys(declaration.access).length === 0) {
    findings.push(['no_principal_allowed']);
  }
  const errorKeys = declaration.errors.map((code) => `${code.tag}.${code.reason}`);
  for (const [position, key] of errorKeys.entries()) {
    if (errorKeys.indexOf(key) !== position) {
      findings.push(['error_duplicated', key]);
    }
  }
  if (declaration.kind === 'command') {
    findings.push(...commandViolations(declaration));
  }
  return findings;
}

function commandViolations(declaration: CommandDeclaration): Finding[] {
  const findings: Finding[] = [];
  if (declaration.expectedVersion !== Object.hasOwn(declaration.input.shape, 'expectedVersion')) {
    findings.push(['expected_version_mismatch']);
  }
  for (const path of nonIdentifierLeaves(declaration.output, [])) {
    findings.push(['output_not_id_only', path]);
  }
  // R3: roles are additive, and tenant administration never implies business authority.
  if (declaration.purpose === 'business' && isAllowed(declaration.access, tenantAdminAlone)) {
    findings.push(['tenant_admin_alone']);
  }
  // KTD20: every high-impact command demands a recent step-up.
  if (declaration.impact !== 'standard' && !declaration.stepUp) {
    findings.push(['high_impact_without_step_up', declaration.impact]);
  }
  return findings;
}

function describedViolations(label: string, schema: QueryDeclaration['output']): Finding[] {
  const findings: Finding[] = [];
  if (schema.description === undefined) {
    findings.push(['schema_not_described', label]);
  }
  if (schema instanceof z.ZodObject) {
    for (const [field, fieldSchema] of Object.entries(schema.shape)) {
      if (z.globalRegistry.get(fieldSchema)?.description === undefined) {
        findings.push(['schema_not_described', `${label}.${field}`]);
      }
    }
  }
  return findings;
}

/**
 * A command's output is what an idempotent replay returns and what the idempotency table
 * stores, so it holds identifiers, versions, counts, flags, enumerations and timestamps only,
 * never free text that could carry personal data (KTD14).
 */
function nonIdentifierLeaves(schema: z.core.$ZodType, path: readonly string[]): string[] {
  const here = path.length === 0 ? '(output)' : path.join('.');
  if (schema instanceof z.ZodObject) {
    const shape: Readonly<Record<string, unknown>> = schema.shape;
    return Object.entries(shape).flatMap(([field, fieldSchema]) =>
      fieldSchema instanceof z.ZodType
        ? nonIdentifierLeaves(fieldSchema, [...path, field])
        : [[...path, field].join('.')],
    );
  }
  if (schema instanceof z.ZodArray) {
    const element: unknown = schema.element;
    return element instanceof z.ZodType ? nonIdentifierLeaves(element, [...path, '[]']) : [here];
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return nonIdentifierLeaves(schema.unwrap(), path);
  }
  const identifierLike =
    schema instanceof z.ZodUUID ||
    schema instanceof z.ZodISODateTime ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodNull;
  return identifierLike ? [] : [here];
}
