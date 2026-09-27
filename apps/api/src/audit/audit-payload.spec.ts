import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { JsonObject } from '@partledger/chain';
import { describe, expect, it } from 'vitest';

import {
  assertAuditSafe,
  auditHash,
  auditId,
  auditTime,
  auditToken,
  checkedAuditObject,
  commitmentSchema,
  UnsafeAuditPayloadError,
  unsafeAuditValues,
  type AuditPayload,
} from './audit-payload';

const commitment = commitmentSchema.parse({ commitment: 'ab'.repeat(32) });

/** Accepts exactly what the audit writer and the command recorder accept at compile time. */
function typed<const Payload extends JsonObject>(payload: AuditPayload<Payload>): AuditPayload<Payload> {
  return payload;
}

describe('audit payload values', () => {
  const rawKeys = [
    'contact_email',
    'supplier_name',
    'addresses',
    'phoneNumber',
    'firstname',
    'title',
    'description',
    'text',
    'body',
    'summary',
    'username',
    'EMAIL',
  ];

  it.each(rawKeys)('refuse a raw string under %s at run time, whatever the key', (key) => {
    const payload = { [key]: 'Synthetic Person' };
    expect(() => {
      assertAuditSafe(payload);
    }).toThrow(UnsafeAuditPayloadError);
  });

  it.each(['alice smith', 'Alice', 'ALICE', 'free text, with punctuation.', '', 'x'.repeat(101), 'a\nb'])(
    'refuse the free string %j at run time',
    (value) => {
      expect(unsafeAuditValues({ kind: value })).toEqual(['/kind']);
    },
  );

  it('refuse free text hidden in arrays, nested objects, keys and fake commitments, naming each by its JSON pointer', () => {
    expect(
      unsafeAuditValues({
        changes: [{ kind: 'void', justification: 'Synthetic free text' }],
        nested: { email: { commitment: 'not-a-commitment' } },
        'Free text key': 1,
      }),
    ).toEqual(['/changes/0/justification', '/nested/email', '/Free text key']);
  });

  it('allow identifiers, hashes, times, tokens, numbers, booleans, null and commitments', () => {
    const payload = typed({
      noteId: auditId(randomUUID()),
      evidenceHash: auditHash('0f'.repeat(32)),
      sealedAt: auditTime(new Date('2026-09-27T12:00:00.000Z')),
      status: auditToken('awaiting_approval'),
      event: auditToken('rfqs.publish'),
      kind: 'transition',
      version: 3,
      unitPrice: 12.5,
      current: true,
      replacedBy: null,
      title: commitment,
      changes: [{ kind: 'noteCreated', contactName: commitment }],
    });
    expect(unsafeAuditValues(payload)).toEqual([]);
    expect(checkedAuditObject(payload)).toEqual(payload);
  });

  it('refuse to brand a value that is not in its form', () => {
    expect(() => auditId('Synthetic Person')).toThrow();
    expect(() => auditId(randomUUID().toUpperCase())).toThrow();
    expect(() => auditHash('abc')).toThrow();
    expect(() => auditToken('Synthetic Person')).toThrow();
    expect(() => checkedAuditObject({ title: 'Synthetic Person' })).toThrow(UnsafeAuditPayloadError);
  });

  it('refuse plain strings and free-text literals at compile time', () => {
    const freeText: string = 'Synthetic Person';
    // @ts-expect-error A plain string is refused under any key.
    typed({ title: freeText });
    // @ts-expect-error Nested plain strings are refused too.
    typed({ changes: [{ kind: 'void', justification: freeText }] });
    // @ts-expect-error A literal with a space is free text, not a token.
    typed({ kind: 'Synthetic Person' });
    // @ts-expect-error A capitalised literal is not a token.
    typed({ kind: 'Approved' });
    expect(typed({ kind: 'approved', title: commitment, version: 1 })).toEqual({
      kind: 'approved',
      title: commitment,
      version: 1,
    });
  });
});

/**
 * Whether source code inserts into the audit chain: raw SQL on `audit_entries` with or
 * without its schema and quotes, or a Drizzle insert into the `auditEntries` table.
 */
function insertsIntoAuditChain(source: string): boolean {
  const rawSql = /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?audit_entries"?(?![A-Za-z0-9_$])/i;
  const drizzle = /\binsert\s*\(\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*auditEntries(?![\w$])/;
  return rawSql.test(source) || drizzle.test(source);
}

describe('the audit writer', () => {
  it.each([
    'insert into audit_entries (tenant_id) values ($1)',
    'INSERT INTO public.audit_entries values ($1)',
    'insert into "public"."audit_entries" values ($1)',
    'insert into "audit_entries" values ($1)',
    'insert\n  into   public . audit_entries values ($1)',
    'await database.insert(auditEntries).values(row)',
    'await database.insert(schema.auditEntries).values(row)',
    'transaction.insert( schema . auditEntries )',
  ])('recognises an insert into the chain in %j', (source) => {
    expect(insertsIntoAuditChain(source)).toBe(true);
  });

  it.each([
    'insert into audit_entries_v2 values ($1)',
    'insert into public.audit_entries_archive values ($1)',
    'select * from audit_entries',
    'database.insert(auditEntriesArchive)',
  ])('does not mistake %j for an insert into the chain', (source) => {
    expect(insertsIntoAuditChain(source)).toBe(false);
  });

  it('is the only code that inserts into the audit chain', () => {
    const repository = join(import.meta.dirname, '..', '..', '..', '..');
    const insertingFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist') {
            visit(path);
          }
        } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(spec|e2e-spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
          if (insertsIntoAuditChain(readFileSync(path, 'utf8'))) {
            insertingFiles.push(relative(repository, path));
          }
        }
      }
    };
    for (const root of ['apps', 'libs', 'scripts', 'tools']) {
      visit(join(repository, root));
    }
    expect(insertingFiles).toEqual(['apps/api/src/audit/audit-writer.ts']);
  });
});
