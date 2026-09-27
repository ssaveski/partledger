import { commandPath, queryPath, type CommandDeclaration } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ApproveNoteHandler,
  approveNote,
  CreateNoteHandler,
  createNote,
  internalTestRegistry,
  setRetention,
  SetRetentionHandler,
} from '../../test/support/internal-test-module';
import { registerCommand, type OperationRegistry } from './handlers';
import { productionRegistry } from './query-registry';
import { registryViolations } from './registry-rules';
import { generateRoutes, InvalidRegistryError } from './route-generator';

function withCommand(declaration: CommandDeclaration): OperationRegistry {
  return { commands: [registerCommand(declaration, CreateNoteHandler)], queries: [] };
}

function rulesBrokenBy(declaration: CommandDeclaration): string[] {
  return registryViolations(withCommand(declaration)).map((violation) => violation.rule);
}

describe('the command and query registry', () => {
  it('the production registry breaks no rule', () => {
    expect(registryViolations(productionRegistry)).toEqual([]);
  });

  it('the internal test module breaks no rule', () => {
    expect(registryViolations(internalTestRegistry)).toEqual([]);
  });

  it('generates a POST route per command and a GET route per query under /api/v1', () => {
    const routes = generateRoutes(internalTestRegistry);
    expect(routes.table).toContainEqual({
      method: 'POST',
      path: '/api/v1/commands/internalTest.createNote',
      operation: 'internalTest.createNote',
    });
    expect(routes.table).toContainEqual({
      method: 'GET',
      path: queryPath('internalTest.getNote'),
      operation: 'internalTest.getNote',
    });
    expect(commandPath('internalTest.createNote')).toBe('/api/v1/commands/internalTest.createNote');
    expect(routes.command('internalTest.getNote')).toBeUndefined();
    expect(routes.query('internalTest.createNote')).toBeUndefined();
  });

  it('refuses to generate routes for a registry that breaks a rule', () => {
    expect(() => generateRoutes(withCommand({ ...createNote, stepUp: false, impact: 'void' }))).toThrow(
      InvalidRegistryError,
    );
  });

  it('refuses two operations with the same name', () => {
    const registry: OperationRegistry = {
      commands: [registerCommand(createNote, CreateNoteHandler), registerCommand(createNote, CreateNoteHandler)],
      queries: [],
    };
    expect(registryViolations(registry)).toEqual([{ rule: 'name_duplicated', operation: 'internalTest.createNote' }]);
  });
});

describe('the tenant administrator rule', () => {
  it('refuses a business command allowed to tenant_admin alone', () => {
    expect(rulesBrokenBy({ ...createNote, access: { person: ['tenant_admin'] } })).toEqual(['tenant_admin_alone']);
  });

  it('refuses a business command that lists tenant_admin beside other roles', () => {
    expect(rulesBrokenBy({ ...createNote, access: { person: ['buyer', 'tenant_admin'] } })).toEqual([
      'tenant_admin_alone',
    ]);
  });

  it('allows an administration command to tenant_admin', () => {
    expect(registryViolations({ commands: [registerCommand(setRetention, SetRetentionHandler)], queries: [] })).toEqual(
      [],
    );
  });
});

describe('the step-up rule', () => {
  it('passes a high-impact command marked step-up', () => {
    expect(registryViolations({ commands: [registerCommand(approveNote, ApproveNoteHandler)], queries: [] })).toEqual(
      [],
    );
  });

  it('fails a high-impact command declared without the step-up flag', () => {
    expect(registryViolations(withCommand({ ...approveNote, stepUp: false }))).toEqual([
      { rule: 'high_impact_without_step_up', operation: 'internalTest.approveNote', detail: 'approval' },
    ]);
  });

  it('fails every KTD20 category declared without the step-up flag', () => {
    for (const impact of [
      'approval',
      'void',
      'role_change',
      'auditor_grant',
      'break_glass_approval',
      'ai_key_change',
      'drop_credential_issuance',
      'second_factor_reset',
    ] as const) {
      expect(rulesBrokenBy({ ...createNote, impact, stepUp: false })).toEqual(['high_impact_without_step_up']);
    }
  });
});

describe('declaration rules', () => {
  it('refuses a command output that carries free text, which an idempotent replay would store', () => {
    const output = z
      .object({ noteId: z.uuid().describe('The note.'), title: z.string().describe('The title.') })
      .describe('Leaky output.');
    expect(registryViolations(withCommand({ ...createNote, output }))).toEqual([
      { rule: 'output_not_id_only', operation: 'internalTest.createNote', detail: 'title' },
    ]);
  });

  it('refuses an input field that would carry the tenant or the principal', () => {
    const input = z
      .object({ title: z.string().describe('The title.'), tenantId: z.uuid().describe('The tenant.') })
      .describe('Input that trusts the body.');
    expect(registryViolations(withCommand({ ...createNote, input }))).toEqual([
      { rule: 'input_names_principal', operation: 'internalTest.createNote', detail: 'tenantId' },
    ]);
  });

  it('refuses schemas and fields without a description', () => {
    const input = z.object({ title: z.string() });
    expect(registryViolations(withCommand({ ...createNote, input })).map((violation) => violation.detail)).toEqual([
      'input',
      'input.title',
    ]);
  });

  it('refuses an expected-version flag that does not match the input', () => {
    expect(rulesBrokenBy({ ...createNote, expectedVersion: true })).toEqual(['expected_version_mismatch']);
  });

  it('refuses a malformed name and an operation nobody may call', () => {
    expect(rulesBrokenBy({ ...createNote, name: 'CreateNote' })).toEqual(['name_malformed']);
    expect(rulesBrokenBy({ ...createNote, access: {} })).toEqual(['no_principal_allowed']);
  });
});
