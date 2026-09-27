import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertCommittedPayload,
  commitmentSchema,
  isPersonalFieldName,
  RawPersonalDataError,
  rawPersonalFields,
} from './audit-payload';

const commitment = commitmentSchema.parse({ commitment: 'ab'.repeat(32) });

describe('audit payloads', () => {
  it('treat names, contact details and free text as personal fields, alone or as a camelCase suffix', () => {
    for (const name of [
      'name',
      'names',
      'contactName',
      'approverEmail',
      'phone',
      'justification',
      'voidReason',
      'notes',
    ]) {
      expect(isPersonalFieldName(name), name).toBe(true);
    }
    for (const name of ['noteId', 'nameless', 'status', 'version', 'emailVerified', 'reasonCode', 'kind']) {
      expect(isPersonalFieldName(name), name).toBe(false);
    }
  });

  it('accept commitments and null in personal fields, anywhere in the payload', () => {
    expect(
      rawPersonalFields({ contactName: commitment, reason: null, changes: [{ approverName: commitment }] }),
    ).toEqual([]);
  });

  it('name every raw personal value by its JSON pointer', () => {
    expect(
      rawPersonalFields({
        contactName: 'Synthetic Person',
        changes: [{ kind: 'void', justification: 'Synthetic free text' }],
        nested: { email: { commitment: 'not-a-commitment' } },
      }),
    ).toEqual(['/contactName', '/changes/0/justification', '/nested/email']);
  });

  it('refuse a payload carrying a raw personal value', () => {
    expect(() => {
      assertCommittedPayload({ name: 'Synthetic Person' });
    }).toThrow(RawPersonalDataError);
    expect(() => {
      assertCommittedPayload({ name: commitment });
    }).not.toThrow();
  });
});

describe('the audit writer', () => {
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
        } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|e2e-spec)\.tsx?$/.test(entry.name)) {
          if (/insert\s+into\s+"?audit_entries"?/i.test(readFileSync(path, 'utf8'))) {
            insertingFiles.push(relative(repository, path));
          }
        }
      }
    };
    for (const root of ['apps', 'libs']) {
      visit(join(repository, root));
    }
    expect(insertingFiles).toEqual(['apps/api/src/audit/audit-writer.ts']);
  });
});
