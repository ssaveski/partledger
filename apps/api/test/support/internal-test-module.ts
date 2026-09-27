import { Injectable } from '@nestjs/common';
import {
  defineCommand,
  defineQuery,
  errorCode,
  expectedVersionSchema,
  lifecycleRead,
  type InputOf,
} from '@partledger/contracts';
import { defineTransitions, refuse, success, versionConflict } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  registerCommand,
  registerQuery,
  type CommandContext,
  type CommandHandler,
  type HandlerResult,
  type OperationContext,
  type OperationRegistry,
  type QueryHandler,
} from '../../src/commands/handlers';
import { actorIdOf } from '../../src/principals/principal';
import { applyTransition } from '../../src/transitions/apply-transition';
import { auditId } from '../../src/audit/audit-payload';

/**
 * A test-only module that exercises the command and query layer before any business module
 * exists. It is never part of the production registry: tests pass it to `createApp`, and its
 * table is created by the tests after the app has booted, outside the shipped schema.
 */

export const internalTestNotesTable = `
  create table internal_test_notes (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants (id),
    title text not null,
    version integer not null default 1,
    status text not null default 'draft',
    created_by uuid,
    actor_type text not null
  );
  call pl_migration.enable_tenant_row_security('public.internal_test_notes');
  grant select, insert, update on internal_test_notes to pl_app;
`;

const noteId = z.uuid().describe('The note.');
const noteVersion = z.number().int().min(1).describe('The note version after the change.');

export const createNote = defineCommand({
  name: 'internalTest.createNote',
  description: 'Creates a synthetic note.',
  purpose: 'business',
  input: z
    .object({
      title: z.string().min(1).max(200).describe('The note title.'),
      delayMilliseconds: z
        .number()
        .int()
        .min(0)
        .max(2000)
        .default(0)
        .describe('Holds the transaction open after the write, to overlap concurrent requests.'),
    })
    .describe('A new note.'),
  output: z.object({ noteId, version: noteVersion }).describe('The created note.'),
  errors: [],
  access: { person: ['buyer', 'quality_engineer'], supplier_token: true, system: ['drop_credential'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'required',
  expectedVersion: false,
});

export const createNoteThenRefuse = defineCommand({
  name: 'internalTest.createNoteThenRefuse',
  description: 'Writes a note, then refuses; nothing it wrote may remain.',
  purpose: 'business',
  input: z
    .object({ title: z.string().min(1).max(200).describe('The note title.') })
    .describe('A note that never lands.'),
  output: z.object({ noteId }).describe('Never returned.'),
  errors: [errorCode('Conflict', 'transitionNotAllowed')],
  access: { person: ['buyer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const renameNote = defineCommand({
  name: 'internalTest.renameNote',
  description: 'Renames a note at the version the client last read.',
  purpose: 'business',
  input: z
    .object({
      noteId,
      title: z.string().min(1).max(200).describe('The new title.'),
      expectedVersion: expectedVersionSchema,
    })
    .describe('The rename.'),
  output: z.object({ noteId, version: noteVersion }).describe('The renamed note.'),
  errors: [errorCode('NotFound', 'resource'), errorCode('Conflict', 'versionMismatch')],
  access: { person: ['buyer', 'quality_engineer'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: true,
});

export const approveNote = defineCommand({
  name: 'internalTest.approveNote',
  description: 'Approves a note; stands in for a KTD20 high-impact command.',
  purpose: 'business',
  input: z.object({ noteId, expectedVersion: expectedVersionSchema }).describe('The approval.'),
  output: z.object({ noteId, version: noteVersion }).describe('The approved note.'),
  errors: [
    errorCode('NotFound', 'resource'),
    errorCode('Conflict', 'versionMismatch'),
    errorCode('Conflict', 'transitionNotAllowed'),
  ],
  access: { person: ['approver'] },
  stepUp: true,
  impact: 'approval',
  idempotencyKey: 'required',
  expectedVersion: true,
});

/** Only background jobs may call it; a drop credential, also a system principal, may not. */
export const recordJobRun = defineCommand({
  name: 'internalTest.recordJobRun',
  description: 'Records a note as a background job would.',
  purpose: 'business',
  input: z.object({ title: z.string().min(1).max(200).describe('The note title.') }).describe('The job run.'),
  output: z.object({ noteId }).describe('The recorded note.'),
  errors: [],
  access: { system: ['job'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const setRetention = defineCommand({
  name: 'internalTest.setRetention',
  description: 'A tenant administration setting.',
  purpose: 'administration',
  input: z.object({ days: z.number().int().min(1).max(3650).describe('Days to keep notes.') }).describe('The setting.'),
  output: z.object({ days: z.number().int().describe('The stored setting.') }).describe('The setting as stored.'),
  errors: [],
  access: { person: ['tenant_admin'] },
  stepUp: false,
  impact: 'standard',
  idempotencyKey: 'optional',
  expectedVersion: false,
});

export const noteTransitions = ['rename', 'approve'] as const;

/** The note's lifecycle, applied through `applyTransition` (KTD13). */
export const noteLifecycle = defineTransitions({
  aggregate: 'note',
  statuses: ['draft', 'approved'],
  transitions: { approve: { from: ['draft'], to: 'approved' } },
});

export const getNote = defineQuery({
  name: 'internalTest.getNote',
  description: 'Reads a note with what the caller may do next.',
  input: z.object({ noteId }).describe('The note to read.'),
  output: lifecycleRead(
    z.object({
      id: noteId,
      title: z.string().describe('The note title.'),
      version: noteVersion,
      status: z.enum(['draft', 'approved']).describe('The note status.'),
    }),
    noteTransitions,
  ).describe('The note.'),
  errors: [errorCode('NotFound', 'resource')],
  access: { person: ['buyer', 'quality_engineer', 'approver', 'auditor'], platform_operator: true },
});

const insertedNote = z.array(z.object({ id: z.uuid(), version: z.number().int() }));
const storedNote = z.array(
  z.object({ id: z.uuid(), title: z.string(), version: z.number().int(), status: z.enum(['draft', 'approved']) }),
);

async function insertNote(context: OperationContext, title: string): Promise<{ id: string; version: number }> {
  const result = await context.database.execute(
    sql`insert into internal_test_notes (tenant_id, title, created_by, actor_type)
        values (${context.principal.tenantId}, ${title}, ${actorIdOf(context.principal)}, ${context.principal.type})
        returning id, version`,
  );
  const [row] = insertedNote.parse(result.rows);
  if (row === undefined) {
    throw new Error('The note was not inserted');
  }
  return row;
}

async function findNote(context: OperationContext, id: string) {
  const result = await context.database.execute(
    sql`select id, title, version, status from internal_test_notes where id = ${id} for update`,
  );
  return storedNote.parse(result.rows)[0];
}

@Injectable()
export class CreateNoteHandler implements CommandHandler<typeof createNote> {
  async execute(input: InputOf<typeof createNote>, context: CommandContext): Promise<HandlerResult<typeof createNote>> {
    const note = await insertNote(context, input.title);
    // The title is free text, so the audit entry carries only its commitment.
    context.audit.record({
      kind: 'noteCreated',
      noteId: auditId(note.id),
      title: await context.audit.commit(input.title),
    });
    if (input.delayMilliseconds > 0) {
      await context.database.execute(sql`select pg_sleep(${input.delayMilliseconds / 1000})`);
    }
    return success({ noteId: note.id, version: note.version });
  }
}

@Injectable()
export class CreateNoteThenRefuseHandler implements CommandHandler<typeof createNoteThenRefuse> {
  async execute(
    input: InputOf<typeof createNoteThenRefuse>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof createNoteThenRefuse>> {
    await insertNote(context, input.title);
    return refuse('Conflict', 'transitionNotAllowed');
  }
}

@Injectable()
export class RenameNoteHandler implements CommandHandler<typeof renameNote> {
  async execute(
    input: InputOf<typeof renameNote>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof renameNote>> {
    const note = await findNote(context, input.noteId);
    if (note === undefined) {
      return refuse('NotFound', 'resource', { resource: 'note' });
    }
    const conflict = versionConflict(input.expectedVersion, note.version);
    if (conflict !== null) {
      return { ok: false, error: conflict };
    }
    await context.database.execute(
      sql`update internal_test_notes set title = ${input.title}, version = version + 1 where id = ${note.id}`,
    );
    return success({ noteId: note.id, version: note.version + 1 });
  }
}

@Injectable()
export class ApproveNoteHandler implements CommandHandler<typeof approveNote> {
  async execute(
    input: InputOf<typeof approveNote>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof approveNote>> {
    const note = await findNote(context, input.noteId);
    if (note === undefined) {
      return refuse('NotFound', 'resource', { resource: 'note' });
    }
    const conflict = versionConflict(input.expectedVersion, note.version);
    if (conflict !== null) {
      return { ok: false, error: conflict };
    }
    const applied = await applyTransition(context, noteLifecycle, {
      table: 'internal_test_notes',
      id: note.id,
      transition: 'approve',
      from: note.status,
      versioned: true,
    });
    if (!applied.ok) {
      return applied;
    }
    return success({ noteId: note.id, version: applied.value.version ?? note.version + 1 });
  }
}

@Injectable()
export class RecordJobRunHandler implements CommandHandler<typeof recordJobRun> {
  async execute(
    input: InputOf<typeof recordJobRun>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof recordJobRun>> {
    const note = await insertNote(context, input.title);
    return success({ noteId: note.id });
  }
}

@Injectable()
export class SetRetentionHandler implements CommandHandler<typeof setRetention> {
  execute(input: InputOf<typeof setRetention>): Promise<HandlerResult<typeof setRetention>> {
    return Promise.resolve(success({ days: input.days }));
  }
}

@Injectable()
export class GetNoteHandler implements QueryHandler<typeof getNote> {
  async execute(input: InputOf<typeof getNote>, context: OperationContext): Promise<HandlerResult<typeof getNote>> {
    const result = await context.database.execute(
      sql`select id, title, version, status from internal_test_notes where id = ${input.noteId}`,
    );
    const note = storedNote.parse(result.rows)[0];
    if (note === undefined) {
      return refuse('NotFound', 'resource', { resource: 'note' });
    }
    const roles = context.principal.type === 'person' ? context.principal.roles : [];
    const mayApprove = roles.includes('approver') && note.status === 'draft';
    const mayRename = roles.some((role) => role === 'buyer' || role === 'quality_engineer') && note.status === 'draft';
    return success({
      ...note,
      allowedTransitions: noteTransitions.filter((transition) => (transition === 'approve' ? mayApprove : mayRename)),
      blockingReasons: noteTransitions
        .filter((transition) => (transition === 'approve' ? !mayApprove : !mayRename))
        .map((transition) => ({
          transition,
          message:
            note.status === 'draft' ? 'pl.error.forbidden.notPermitted' : 'pl.error.conflict.transitionNotAllowed',
          params: {},
        })),
    });
  }
}

/** A query that tries to write; the read-only query transaction must refuse it. */
export const touchNoteInQuery = defineQuery({
  name: 'internalTest.touchNoteInQuery',
  description: 'Misbehaves by writing inside a query.',
  input: z.object({ noteId }).describe('The note to touch.'),
  output: z.object({ noteId }).describe('Never returned.'),
  errors: [],
  access: { person: ['buyer'] },
});

@Injectable()
export class TouchNoteInQueryHandler implements QueryHandler<typeof touchNoteInQuery> {
  async execute(
    input: InputOf<typeof touchNoteInQuery>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof touchNoteInQuery>> {
    await context.database.execute(
      sql`update internal_test_notes set title = 'Touched by a query' where id = ${input.noteId}`,
    );
    return success({ noteId: input.noteId });
  }
}

export const internalTestRegistry: OperationRegistry = {
  commands: [
    registerCommand(createNote, CreateNoteHandler),
    registerCommand(createNoteThenRefuse, CreateNoteThenRefuseHandler),
    registerCommand(renameNote, RenameNoteHandler),
    registerCommand(approveNote, ApproveNoteHandler),
    registerCommand(setRetention, SetRetentionHandler),
    registerCommand(recordJobRun, RecordJobRunHandler),
  ],
  queries: [registerQuery(getNote, GetNoteHandler), registerQuery(touchNoteInQuery, TouchNoteInQueryHandler)],
};
