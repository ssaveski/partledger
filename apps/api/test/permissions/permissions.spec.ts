/// <reference types="vite/client" />

import { highImpactCategories } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { OperationRegistry } from '../../src/commands/handlers';
import { productionRegistry } from '../../src/commands/query-registry';
import { isAllowed } from '../../src/principals/authorize';
import { internalTestRegistry } from '../support/internal-test-module';
import { matrixPrincipals, principalFor, type ModulePermissions } from './matrix';

const allow = z.array(z.enum(matrixPrincipals));
const modulePermissionsSchema = z.record(
  z.string(),
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('command'),
        allow,
        purpose: z.enum(['business', 'administration']),
        impact: z.enum(['standard', ...highImpactCategories]),
        stepUp: z.boolean(),
      })
      .strict(),
    z.object({ kind: z.literal('query'), allow }).strict(),
  ]),
);

// One file per module (KTD38), discovered by name so parallel units never edit the same file.
const moduleFiles = import.meta.glob<unknown>(['./*.ts', '!./*.spec.ts', '!./matrix.ts'], {
  eager: true,
  import: 'default',
});

const expectations = new Map<string, ModulePermissions[string]>();
for (const [file, permissions] of Object.entries(moduleFiles)) {
  for (const [operation, expectation] of Object.entries(modulePermissionsSchema.parse(permissions))) {
    if (expectations.has(operation)) {
      throw new Error(`${operation} has expectations in two files; the second is ${file}`);
    }
    expectations.set(operation, expectation);
  }
}

const registries: readonly OperationRegistry[] = [productionRegistry, internalTestRegistry];
const commands = registries.flatMap((registry) => registry.commands.map((registration) => registration.declaration));
const declarations = [
  ...commands,
  ...registries.flatMap((registry) => registry.queries.map((registration) => registration.declaration)),
];

describe('permission expectations', () => {
  it('cover every command and query in the registries, with the right kind', () => {
    const uncovered = declarations
      .filter((declaration) => expectations.get(declaration.name)?.kind !== declaration.kind)
      .map((declaration) => declaration.name);
    expect(uncovered).toEqual([]);
  });

  it('name only commands and queries that exist', () => {
    const names = new Set(declarations.map((declaration) => declaration.name));
    expect([...expectations.keys()].filter((name) => !names.has(name))).toEqual([]);
  });
});

describe.each(commands)('the declaration of $name', (declaration) => {
  it('matches the purpose, impact and step-up flag pinned in its reviewed expectation', () => {
    const expectation = expectations.get(declaration.name);
    expect(expectation?.kind).toBe('command');
    if (expectation?.kind === 'command') {
      expect({ purpose: declaration.purpose, impact: declaration.impact, stepUp: declaration.stepUp }).toEqual({
        purpose: expectation.purpose,
        impact: expectation.impact,
        stepUp: expectation.stepUp,
      });
    }
  });
});

const cases = declarations.flatMap((declaration) =>
  matrixPrincipals.map((principal) => ({
    operation: declaration.name,
    principal,
    access: declaration.access,
    expected: expectations.get(declaration.name)?.allow.includes(principal) === true ? 'allowed' : 'denied',
  })),
);

describe.each(cases)('$operation called by $principal', ({ principal, access, expected }) => {
  it(`is ${expected}`, () => {
    expect(isAllowed(access, principalFor(principal)) ? 'allowed' : 'denied').toBe(expected);
  });
});
