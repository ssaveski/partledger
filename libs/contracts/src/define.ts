import { z } from 'zod';

import type { ErrorCode } from './errors';
import type { CommandImpact, TenantRole } from './principals';

/**
 * Commands and queries are declared once here (KTD35, R32): name, described input and output
 * schemas, the closed list of failures, and who may call them. The API implements them,
 * generates their routes under `/api/v1`, and checks every declaration against the rules in
 * its registry at boot; clients, tests and a later MCP tool list read the same declaration.
 */

export const apiBasePath = '/api/v1';

/** `<module>.<action>`, both camelCase, such as `rfqs.publish`. */
export const operationNamePattern = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

/**
 * Who may call an operation. `person` lists the tenant roles of which a person needs at least
 * one; the other principal types are allowed outright when present, and their scope (which
 * supplier, which grant) is checked by the handler.
 */
export interface AccessRule {
  readonly person?: readonly [TenantRole, ...TenantRole[]];
  readonly supplier_token?: true;
  readonly ai_agent?: true;
  readonly system?: true;
  readonly platform_operator?: true;
}

/** `administration` commands manage the tenant itself (members, roles, settings); everything else is `business`. */
export type CommandPurpose = 'business' | 'administration';

export interface CommandDeclaration<
  Name extends string = string,
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
  Errors extends ErrorCode = ErrorCode,
> {
  readonly kind: 'command';
  readonly name: Name;
  readonly description: string;
  readonly purpose: CommandPurpose;
  /** Described with `.describe()`, as is each of its fields. */
  readonly input: Input;
  /** Identifiers, versions, counts and enumerations only: it is what an idempotent replay returns (KTD14). */
  readonly output: Output;
  readonly errors: readonly Errors[];
  readonly access: AccessRule;
  /** Requires a recent step-up authentication (KTD20); every high-impact command sets it. */
  readonly stepUp: boolean;
  readonly impact: CommandImpact;
  /** Every command accepts an `Idempotency-Key` header (R33); `required` refuses a request without one. */
  readonly idempotencyKey: 'required' | 'optional';
  /** Commands on versioned aggregates take `expectedVersion` in their input (R33). */
  readonly expectedVersion: boolean;
}

export interface QueryDeclaration<
  Name extends string = string,
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodType = z.ZodType,
  Errors extends ErrorCode = ErrorCode,
> {
  readonly kind: 'query';
  readonly name: Name;
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly errors: readonly Errors[];
  readonly access: AccessRule;
}

export type OperationDeclaration = CommandDeclaration | QueryDeclaration;

export function defineCommand<
  const Name extends string,
  Input extends z.ZodObject,
  Output extends z.ZodObject,
  Errors extends ErrorCode = never,
>(
  declaration: Omit<CommandDeclaration<Name, Input, Output, Errors>, 'kind'>,
): CommandDeclaration<Name, Input, Output, Errors> {
  return { kind: 'command', ...declaration };
}

export function defineQuery<
  const Name extends string,
  Input extends z.ZodObject,
  Output extends z.ZodType,
  Errors extends ErrorCode = never,
>(
  declaration: Omit<QueryDeclaration<Name, Input, Output, Errors>, 'kind'>,
): QueryDeclaration<Name, Input, Output, Errors> {
  return { kind: 'query', ...declaration };
}

export type InputOf<Declaration extends OperationDeclaration> = z.output<Declaration['input']>;

export type OutputOf<Declaration extends OperationDeclaration> = z.output<Declaration['output']>;

export type ErrorCodeOf<Declaration extends OperationDeclaration> = Declaration['errors'][number];

/** Commands are POSTed with their input as the JSON body. */
export function commandPath(name: string): string {
  return `${apiBasePath}/commands/${name}`;
}

/** Queries are GETs without side effects; their input travels as JSON in the `input` query parameter. */
export function queryPath(name: string): string {
  return `${apiBasePath}/queries/${name}`;
}

export const idempotencyKeyHeader = 'idempotency-key';

/** A client-chosen key, such as a UUID, reused only when retrying the same request. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/)
  .describe('Retries with the same key and body act once and return the first result.');

export const expectedVersionSchema = z
  .number()
  .int()
  .min(0)
  .describe('The aggregate version the client last read; a stale version is refused as a conflict.');

/** Header carrying the server-issued correlation id of every API response (KTD15). */
export const correlationIdHeader = 'x-correlation-id';

/** Set on a response that replays the first result of an idempotency key. */
export const idempotentReplayHeader = 'idempotent-replayed';
