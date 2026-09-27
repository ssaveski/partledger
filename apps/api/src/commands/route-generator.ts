import { commandPath, queryPath } from '@partledger/contracts';

import type { CommandRegistration, OperationRegistry, QueryRegistration } from './handlers';
import { registryViolations, type RegistryViolation } from './registry-rules';

export class InvalidRegistryError extends Error {
  readonly violations: readonly RegistryViolation[];

  constructor(violations: readonly RegistryViolation[]) {
    super(
      `The command and query registry breaks its rules:\n${violations
        .map(
          (violation) =>
            `${violation.rule}: ${violation.operation}${violation.detail === undefined ? '' : ` (${violation.detail})`}`,
        )
        .join('\n')}`,
    );
    this.name = 'InvalidRegistryError';
    this.violations = violations;
  }
}

export interface RouteDescription {
  readonly method: 'POST' | 'GET';
  readonly path: string;
  readonly operation: string;
}

/**
 * The API's routes, generated from the registry (KTD35): `POST /api/v1/commands/<name>` and
 * `GET /api/v1/queries/<name>`. The gateway controller serves every route through this table,
 * so an operation that is not registered has no route.
 */
export interface OperationRoutes {
  readonly table: readonly RouteDescription[];
  command(name: string): CommandRegistration | undefined;
  query(name: string): QueryRegistration | undefined;
}

export const operationRoutes = Symbol('OperationRoutes');

export function generateRoutes(registry: OperationRegistry): OperationRoutes {
  const violations = registryViolations(registry);
  if (violations.length > 0) {
    throw new InvalidRegistryError(violations);
  }
  const commands = new Map(registry.commands.map((registration) => [registration.declaration.name, registration]));
  const queries = new Map(registry.queries.map((registration) => [registration.declaration.name, registration]));
  const table: RouteDescription[] = [
    ...[...commands.keys()].map((name) => ({ method: 'POST' as const, path: commandPath(name), operation: name })),
    ...[...queries.keys()].map((name) => ({ method: 'GET' as const, path: queryPath(name), operation: name })),
  ];
  return {
    table,
    command: (name) => commands.get(name),
    query: (name) => queries.get(name),
  };
}
