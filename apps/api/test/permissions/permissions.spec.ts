/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { OperationRegistry } from '../../src/commands/handlers';
import { productionRegistry } from '../../src/commands/query-registry';
import { isAllowed } from '../../src/principals/authorize';
import { internalTestRegistry } from '../support/internal-test-module';
import { matrixPrincipals, principalFor } from './matrix';

const modulePermissionsSchema = z.record(z.string(), z.array(z.enum(matrixPrincipals)));

// One file per module (KTD38), discovered by name so parallel units never edit the same file.
const moduleFiles = import.meta.glob<unknown>(['./*.ts', '!./*.spec.ts', '!./matrix.ts'], {
  eager: true,
  import: 'default',
});

const expectations = new Map<string, readonly string[]>();
for (const [file, permissions] of Object.entries(moduleFiles)) {
  for (const [operation, allowed] of Object.entries(modulePermissionsSchema.parse(permissions))) {
    if (expectations.has(operation)) {
      throw new Error(`${operation} has expectations in two files; the second is ${file}`);
    }
    expectations.set(operation, allowed);
  }
}

const registries: readonly OperationRegistry[] = [productionRegistry, internalTestRegistry];
const declarations = registries.flatMap((registry) => [
  ...registry.commands.map((registration) => registration.declaration),
  ...registry.queries.map((registration) => registration.declaration),
]);

describe('permission expectations', () => {
  it('cover every command and query in the registries', () => {
    const uncovered = declarations.map((declaration) => declaration.name).filter((name) => !expectations.has(name));
    expect(uncovered).toEqual([]);
  });

  it('name only commands and queries that exist', () => {
    const names = new Set(declarations.map((declaration) => declaration.name));
    expect([...expectations.keys()].filter((name) => !names.has(name))).toEqual([]);
  });
});

const cases = declarations.flatMap((declaration) =>
  matrixPrincipals.map((principal) => ({
    operation: declaration.name,
    principal,
    access: declaration.access,
    expected: expectations.get(declaration.name)?.includes(principal) === true ? 'allowed' : 'denied',
  })),
);

describe.each(cases)('$operation called by $principal', ({ principal, access, expected }) => {
  it(`is ${expected}`, () => {
    expect(isAllowed(access, principalFor(principal)) ? 'allowed' : 'denied').toBe(expected);
  });
});
