import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  isValidLei,
  partListSchema,
  supplierDetailSchema,
  supplierListSchema,
  type TenantRole,
} from '@partledger/contracts';
import { insertPart, insertSupplier } from '@partledger/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { productionRegistry } from '../src/commands/query-registry';
import { newIdempotencyKey, startApiHarness, type ApiHarness } from './support/api-harness';

/**
 * Parts, suppliers, contacts, identity checks and the approved-supplier list (U10), through
 * the staff listener as `pl_app`, with a stand-in VIES and GLEIF on loopback.
 */

const created = z.object({ partId: z.uuid(), version: z.number() }).strict();
const createdSupplier = z.object({ supplierId: z.uuid(), version: z.number() }).strict();
const auditRows = z.array(
  z.object({
    actor_type: z.string(),
    actor_id: z.string().nullable(),
    payload: z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }),
  }),
);
const checkRows = z.array(z.object({ register: z.string(), identifier: z.string(), result: z.string() }));
const partChanges = z.array(
  z.object({ part: z.uuid(), version: z.number(), fields: z.record(z.string(), z.unknown()) }).strict(),
);

/** ISO 17442 check digits for 18 characters, so tests can make valid synthetic LEIs. */
function syntheticLei(base: string): string {
  let remainder = 0;
  for (const character of `${base}00`) {
    const digits = /[0-9]/.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return `${base}${String(98 - remainder).padStart(2, '0')}`;
}

const confirmedLei = syntheticLei('5299000SYNTHETIC01');
const renamedLei = syntheticLei('5299000SYNTHETIC02');
const unknownLei = syntheticLei('5299000SYNTHETIC03');
const hangingVatId = 'SE556677889901';

/** A stand-in for both registers: VIES never answers the hanging VAT id; GLEIF knows two LEIs. */
function registerAnswer(request: IncomingMessage, response: ServerResponse): void {
  const path = request.url ?? '';
  if (path === `/vies/ms/SE/vat/${hangingVatId.slice(2)}`) {
    return;
  }
  const records: Readonly<Record<string, string>> = {
    [confirmedLei]: 'SYNTHETIC LEI HOLDINGS AB',
    [renamedLei]: 'Entirely Different Registrant GmbH',
  };
  const lei = /^\/gleif\/lei-records\/([A-Z0-9]{20})$/.exec(path)?.[1];
  const name = lei === undefined ? undefined : records[lei];
  if (name === undefined) {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, { 'content-type': 'application/vnd.api+json' })
    .end(JSON.stringify({ data: { attributes: { entity: { legalName: { name } } } } }));
}

describe('parts, suppliers and the approved-supplier list', () => {
  let harness: ApiHarness;
  let registers: Server;

  beforeAll(async () => {
    registers = createServer(registerAnswer);
    await new Promise<void>((resolve) => registers.listen(0, '127.0.0.1', resolve));
    const { port } = z.object({ port: z.number() }).parse(registers.address());
    harness = await startApiHarness({
      process: { registry: productionRegistry, workers: true },
      environment: {
        VIES_API_URL: `http://127.0.0.1:${port}/vies`,
        GLEIF_API_URL: `http://127.0.0.1:${port}/gleif`,
        IDENTITY_CHECK_TIMEOUT_MILLISECONDS: '300',
      },
    });
    // Tenant B's approved-supplier list is a mirror of its ERP (R9).
    await harness.superuser.query(`update tenants set supplier_list_source = 'erp' where id = $1`, [harness.tenantB]);
  }, 300_000);

  afterAll(async () => {
    await harness.close();
    registers.closeAllConnections();
    await new Promise((resolve) => registers.close(resolve));
  });

  async function tokenFor(tenantId: string, roles: readonly TenantRole[]) {
    return (await harness.issue('staff_session', tenantId, { roles })).token;
  }

  function command(name: string, body: unknown, token: string) {
    return harness.command('staff', name, body, { token, idempotencyKey: newIdempotencyKey() });
  }

  async function lastAuditEntry(tenantId: string, event: string) {
    const result = await harness.superuser.query(
      `select actor_type, actor_id, payload from audit_entries
        where tenant_id = $1 and payload ->> 'event' = $2 order by seq desc limit 1`,
      [tenantId, event],
    );
    return auditRows.parse(result.rows)[0];
  }

  async function eventually<T>(read: () => Promise<T | undefined>, timeoutMilliseconds = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMilliseconds;
    for (;;) {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting');
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async function identityChecksOf(supplierId: string) {
    return checkRows.parse(
      (
        await harness.superuser.query(
          `select register, identifier, result from supplier_identity_checks where supplier_id = $1 order by register`,
          [supplierId],
        )
      ).rows,
    );
  }

  describe('parts', () => {
    it('a buyer adds a platform part, which the parts list shows at version 1', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const response = await command(
        'parts.create',
        {
          partNumber: 'PN-U10-001',
          revision: 'A',
          description: 'Synthetic bracket',
          category: 'sheetMetal',
          unit: 'each',
        },
        buyer,
      );
      expect(response.status).toBe(200);
      const { partId } = created.parse(response.body);

      const list = partListSchema.parse((await harness.query('staff', 'parts.list', {}, buyer)).body);
      expect(list.parts.find((part) => part.partId === partId)).toMatchObject({
        partNumber: 'PN-U10-001',
        source: 'platform',
        active: true,
        version: 1,
      });
      const entry = await lastAuditEntry(harness.tenantA, 'parts.create');
      expect(JSON.stringify(entry?.payload)).not.toContain('Synthetic bracket');
    });

    it('editing a source-owned field of an ERP-sourced part is refused and changes nothing', async () => {
      const partId = await insertPart(harness.superuser, {
        tenantId: harness.tenantA,
        partNumber: 'PN-ERP-100',
        description: 'Synthetic housing',
        source: 'erp',
      });
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const audited = await harness.count(`select 1 from audit_entries where payload ->> 'event' = 'parts.update'`);

      const response = await command(
        'parts.update',
        { partId, expectedVersion: 1, changes: { description: 'Renamed here' } },
        buyer,
      );

      expect(response.status).toBe(422);
      expect(response.body).toEqual({
        error: 'Unprocessable',
        message: 'pl.error.unprocessable.sourceOwned',
        params: { field: 'description' },
      });
      const stored = await harness.superuser.query(`select description, version from parts where id = $1`, [partId]);
      expect(stored.rows).toEqual([{ description: 'Synthetic housing', version: 1 }]);
      expect(await harness.count(`select 1 from audit_entries where payload ->> 'event' = 'parts.update'`)).toBe(
        audited,
      );
    });

    it('the category of an ERP-sourced part is the platform’s, so it changes and the change is audited', async () => {
      const partId = await insertPart(harness.superuser, {
        tenantId: harness.tenantA,
        partNumber: 'PN-ERP-101',
        source: 'erp',
      });
      const engineer = await harness.issue('staff_session', harness.tenantA, { roles: ['quality_engineer'] });

      const response = await command(
        'parts.update',
        // The unchanged revision the ERP owns passes; only the category changes.
        { partId, expectedVersion: 1, changes: { category: 'seals', revision: 'A' } },
        engineer.token,
      );

      expect(response.status).toBe(200);
      expect(created.parse(response.body)).toEqual({ partId, version: 2 });
      const entry = await lastAuditEntry(harness.tenantA, 'parts.update');
      expect(entry).toMatchObject({ actor_type: 'person', actor_id: engineer.subjectId });
      const [change] = partChanges.parse(entry?.payload.data['changes']);
      expect(change).toMatchObject({ part: partId, version: 2 });
      expect(change?.fields['category']).toBe('seals');
    });

    it('an ERP-sourced part cannot be deactivated here; a platform part can', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const erpPart = await insertPart(harness.superuser, {
        tenantId: harness.tenantA,
        partNumber: 'PN-ERP-102',
        source: 'erp',
      });
      const platformPart = await insertPart(harness.superuser, {
        tenantId: harness.tenantA,
        partNumber: 'PN-PLT-102',
        source: 'platform',
      });

      const refused = await command('parts.setActive', { partId: erpPart, expectedVersion: 1, active: false }, buyer);
      const accepted = await command(
        'parts.setActive',
        { partId: platformPart, expectedVersion: 1, active: false },
        buyer,
      );

      expect(refused.status).toBe(422);
      expect(accepted.status).toBe(200);
      const stored = await harness.superuser.query(
        `select id, active from parts where id = any($1) order by part_number`,
        [[erpPart, platformPart]],
      );
      expect(stored.rows).toEqual([
        { id: erpPart, active: true },
        { id: platformPart, active: false },
      ]);
    });

    it('a change that names a stale version is refused as a conflict', async () => {
      const partId = await insertPart(harness.superuser, {
        tenantId: harness.tenantA,
        partNumber: 'PN-PLT-103',
        source: 'platform',
      });
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      expect(
        (await command('parts.update', { partId, expectedVersion: 1, changes: { revision: 'B' } }, buyer)).status,
      ).toBe(200);

      const stale = await command('parts.update', { partId, expectedVersion: 1, changes: { revision: 'C' } }, buyer);

      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({
        message: 'pl.error.conflict.versionMismatch',
        params: { expectedVersion: 1, actualVersion: 2 },
      });
    });

    it('a second part with the same number is refused', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const part = { partNumber: 'PN-DUP-1', revision: 'A', description: 'Synthetic', category: 'seals', unit: 'each' };
      expect((await command('parts.create', part, buyer)).status).toBe(200);
      expect((await command('parts.create', part, buyer)).body).toMatchObject({
        message: 'pl.error.conflict.alreadyExists',
      });
    });

    it('an approver reads the parts list but cannot change a part', async () => {
      const approver = await tokenFor(harness.tenantA, ['approver']);
      expect((await harness.query('staff', 'parts.list', {}, approver)).status).toBe(200);
      const response = await command(
        'parts.create',
        { partNumber: 'PN-APR-1', revision: 'A', description: 'Synthetic', category: 'seals', unit: 'each' },
        approver,
      );
      expect(response.status).toBe(403);
    });

    it('the parts list counts the active suppliers whose current approval covers each category', async () => {
      const tenantId = harness.tenantB;
      const partId = await insertPart(harness.superuser, { tenantId, partNumber: 'PN-CNT-1', category: 'fasteners' });
      await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-APPROVED',
        approval: { status: 'approved', scope: ['fasteners'], expiresOn: '2999-12-31' },
      });
      await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-COND',
        approval: { status: 'conditional', scope: ['fasteners', 'seals'] },
      });
      await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-EXPIRED',
        approval: { status: 'approved', scope: ['fasteners'], expiresOn: '2020-01-31' },
      });
      await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-SUSPENDED',
        approval: { status: 'suspended', scope: ['fasteners'] },
      });
      await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-OTHER',
        approval: { status: 'approved', scope: ['castings'] },
      });
      const inactive = await insertSupplier(harness.superuser, {
        tenantId,
        code: 'CNT-INACTIVE',
        approval: { status: 'approved', scope: ['fasteners'] },
      });
      await harness.superuser.query(`update suppliers set status = 'inactive', version = 2 where id = $1`, [inactive]);

      const list = partListSchema.parse(
        (await harness.query('staff', 'parts.list', {}, await tokenFor(tenantId, ['buyer']))).body,
      );

      expect(list.parts.find((part) => part.partId === partId)?.approvedSupplierCount).toBe(2);
    });
  });

  describe('the approved-supplier list', () => {
    const approval = { status: 'approved', scope: ['castings', 'machinedParts'], expiresOn: '2999-06-30' } as const;

    it('with source erp, a quality engineer’s change is refused and nothing is written', async () => {
      const supplierId = await insertSupplier(harness.superuser, { tenantId: harness.tenantB, code: 'ERP-ASL-1' });
      const engineer = await tokenFor(harness.tenantB, ['quality_engineer']);

      const response = await command(
        'suppliers.setApproval',
        { supplierId, expectedVersion: 0, ...approval },
        engineer,
      );

      expect(response.status).toBe(422);
      expect(response.body).toEqual({
        error: 'Unprocessable',
        message: 'pl.error.unprocessable.approvedListErpOwned',
        params: {},
      });
      expect(await harness.count(`select 1 from approved_supplier_entries where supplier_id = $1`, [supplierId])).toBe(
        0,
      );
      expect(await lastAuditEntry(harness.tenantB, 'suppliers.setApproval')).toBeUndefined();
    });

    it('with source platform, a quality engineer’s change succeeds, shows on the list and is audited as that person', async () => {
      const supplierId = await insertSupplier(harness.superuser, { tenantId: harness.tenantA, code: 'PLT-ASL-1' });
      const engineer = await harness.issue('staff_session', harness.tenantA, { roles: ['quality_engineer'] });

      const response = await command(
        'suppliers.setApproval',
        { supplierId, expectedVersion: 0, ...approval },
        engineer.token,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ supplierId, version: 1 });
      const list = supplierListSchema.parse((await harness.query('staff', 'suppliers.list', {}, engineer.token)).body);
      expect(list.approvedListSource).toBe('platform');
      expect(list.suppliers.find((supplier) => supplier.supplierId === supplierId)?.approval).toEqual({
        status: 'approved',
        scope: ['castings', 'machinedParts'],
        expiresOn: '2999-06-30',
        expiry: 'current',
      });
      const entry = await lastAuditEntry(harness.tenantA, 'suppliers.setApproval');
      expect(entry).toMatchObject({ actor_type: 'person', actor_id: engineer.subjectId });
      expect(entry?.payload.data['changes']).toEqual([
        expect.objectContaining({
          supplier: supplierId,
          version: 1,
          previousStatus: 'notApproved',
          status: 'approved',
          scope: ['castings', 'machinedParts'],
        }),
      ]);

      // The next change names version 1; naming 0 again is refused.
      const stale = await command(
        'suppliers.setApproval',
        { supplierId, expectedVersion: 0, ...approval },
        engineer.token,
      );
      expect(stale.status).toBe(409);
      const suspended = await command(
        'suppliers.setApproval',
        { supplierId, expectedVersion: 1, status: 'suspended', scope: ['castings'], expiresOn: null },
        engineer.token,
      );
      expect(suspended.body).toEqual({ supplierId, version: 2 });
    });

    it('a buyer cannot change the approved-supplier list, even one maintained in the platform', async () => {
      const supplierId = await insertSupplier(harness.superuser, { tenantId: harness.tenantA, code: 'PLT-ASL-2' });
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const response = await command('suppliers.setApproval', { supplierId, expectedVersion: 0, ...approval }, buyer);
      expect(response.status).toBe(403);
    });

    it('an approval that ends within 60 days reads as expiring soon, and one that ended as expired', async () => {
      const today = new Date(harness.clock.now().getTime());
      const inTenDays = new Date(today.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
      const soon = await insertSupplier(harness.superuser, {
        tenantId: harness.tenantA,
        code: 'EXP-SOON',
        approval: { status: 'approved', scope: ['seals'], expiresOn: inTenDays },
      });
      const ended = await insertSupplier(harness.superuser, {
        tenantId: harness.tenantA,
        code: 'EXP-ENDED',
        approval: { status: 'approved', scope: ['seals'], expiresOn: '2021-03-31' },
      });
      const list = supplierListSchema.parse(
        (await harness.query('staff', 'suppliers.list', {}, await tokenFor(harness.tenantA, ['auditor']))).body,
      );
      const expiryOf = (id: string) => list.suppliers.find((supplier) => supplier.supplierId === id)?.approval.expiry;
      expect([expiryOf(soon), expiryOf(ended)]).toEqual(['expiringSoon', 'expired']);
    });
  });

  describe('suppliers and contacts', () => {
    it('a buyer adds a supplier and contacts; a removed contact leaves the detail read and stays removed', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const { supplierId } = createdSupplier.parse(
        (
          await command(
            'suppliers.create',
            { code: 'NEW-0001', name: 'Synthetic Castings', country: 'CA', vatId: null, lei: null },
            buyer,
          )
        ).body,
      );
      const contact = { supplierId, name: 'Synthetic Contact', email: 'Quotes@Synthetic-Castings.test', role: 'sales' };
      const added = await command('suppliers.addContact', contact, buyer);
      expect(added.status).toBe(200);
      const { contactId } = z.object({ contactId: z.uuid() }).parse(added.body);
      expect((await command('suppliers.addContact', { ...contact, name: 'Someone Else' }, buyer)).status).toBe(409);
      await command(
        'suppliers.addContact',
        { ...contact, email: 'quality@synthetic-castings.test', role: 'quality' },
        buyer,
      );

      const before = supplierDetailSchema.parse(
        (await harness.query('staff', 'suppliers.detail', { supplierId }, buyer)).body,
      );
      expect(before.supplier.contacts.map((entry) => [entry.email, entry.role])).toEqual([
        ['quotes@synthetic-castings.test', 'sales'],
        ['quality@synthetic-castings.test', 'quality'],
      ]);
      expect(before.supplier).toMatchObject({ source: 'platform', status: 'active', version: 1, approvalVersion: 0 });
      expect(before.supplier.identityChecks).toEqual([]);

      expect((await command('suppliers.removeContact', { contactId }, buyer)).status).toBe(200);
      expect((await command('suppliers.removeContact', { contactId }, buyer)).status).toBe(404);
      const after = supplierDetailSchema.parse(
        (await harness.query('staff', 'suppliers.detail', { supplierId }, buyer)).body,
      );
      expect(after.supplier.contacts.map((entry) => entry.email)).toEqual(['quality@synthetic-castings.test']);
      await expect(
        harness.superuser.query(`update supplier_contacts set removed_at = null where id = $1`, [contactId]),
      ).rejects.toThrow(/set once/);
      const entry = await lastAuditEntry(harness.tenantA, 'suppliers.addContact');
      expect(JSON.stringify(entry?.payload)).not.toContain('synthetic-castings.test');
    });

    it('the name of an ERP-sourced supplier is the ERP’s; its VAT id is kept here', async () => {
      const supplierId = await insertSupplier(harness.superuser, { tenantId: harness.tenantA, code: 'ERP-SUP-1' });
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const renamed = await command(
        'suppliers.update',
        { supplierId, expectedVersion: 1, changes: { name: 'Renamed Here' } },
        buyer,
      );
      expect(renamed.body).toMatchObject({ message: 'pl.error.unprocessable.sourceOwned', params: { field: 'name' } });
      const identified = await command(
        'suppliers.update',
        { supplierId, expectedVersion: 1, changes: { vatId: 'DE123456789' } },
        buyer,
      );
      expect(identified.body).toEqual({ supplierId, version: 2 });
      const status = await command(
        'suppliers.setStatus',
        { supplierId, expectedVersion: 2, status: 'inactive' },
        buyer,
      );
      expect(status.body).toMatchObject({ params: { field: 'status' } });
    });

    it('another tenant’s supplier is not found', async () => {
      const supplierId = await insertSupplier(harness.superuser, { tenantId: harness.tenantA, code: 'ISO-0001' });
      const otherTenant = await tokenFor(harness.tenantB, ['buyer', 'quality_engineer']);
      expect((await harness.query('staff', 'suppliers.detail', { supplierId }, otherTenant)).status).toBe(404);
      expect(
        (
          await command(
            'suppliers.addContact',
            { supplierId, name: 'X', email: 'x@y.test', role: 'other' },
            otherTenant,
          )
        ).status,
      ).toBe(404);
      const list = supplierListSchema.parse((await harness.query('staff', 'suppliers.list', {}, otherTenant)).body);
      expect(list.suppliers.some((supplier) => supplier.supplierId === supplierId)).toBe(false);
    });
  });

  describe('identity checks', () => {
    it('a VIES timeout records "not checked", and the supplier stays usable', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer', 'quality_engineer']);
      const response = await command(
        'suppliers.create',
        { code: 'VIES-HANG', name: 'Synthetic Nordic AB', country: 'SE', vatId: hangingVatId, lei: null },
        buyer,
      );
      const { supplierId } = createdSupplier.parse(response.body);

      const checks = await eventually(async () => {
        const rows = await identityChecksOf(supplierId);
        return rows.length > 0 ? rows : undefined;
      });

      expect(checks).toEqual([{ register: 'vies', identifier: hangingVatId, result: 'notChecked' }]);
      const list = supplierListSchema.parse((await harness.query('staff', 'suppliers.list', {}, buyer)).body);
      const shown = list.suppliers.find((supplier) => supplier.supplierId === supplierId)?.identityCheck;
      expect(shown).toMatchObject({ status: 'notChecked', register: 'vies' });
      // Asked and not answered: the time of the attempt is recorded.
      expect(shown?.checkedAt).not.toBeNull();
      const approved = await command(
        'suppliers.setApproval',
        { supplierId, expectedVersion: 0, status: 'approved', scope: ['electronics'], expiresOn: null },
        buyer,
      );
      expect(approved.status).toBe(200);
      const entry = await lastAuditEntry(harness.tenantA, 'suppliers.identityChecked');
      expect(entry).toMatchObject({
        actor_type: 'system',
        payload: { data: { supplier: supplierId, register: 'vies', result: 'notChecked' } },
      });
    });

    it('the LEI register confirms a matching name, flags another name, and does not know an unknown LEI', async () => {
      expect([confirmedLei, renamedLei, unknownLei].every(isValidLei)).toBe(true);
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const outcomes: string[] = [];
      for (const [code, lei] of [
        ['LEI-OK', confirmedLei],
        ['LEI-OTHER', renamedLei],
        ['LEI-UNKNOWN', unknownLei],
      ] as const) {
        const { supplierId } = createdSupplier.parse(
          (
            await command(
              'suppliers.create',
              { code, name: 'Synthetic LEI Holdings', country: 'SE', vatId: null, lei },
              buyer,
            )
          ).body,
        );
        const [check] = await eventually(async () => {
          const rows = await identityChecksOf(supplierId);
          return rows.length > 0 ? rows : undefined;
        });
        outcomes.push(check?.result ?? 'missing');
      }
      expect(outcomes).toEqual(['verified', 'mismatch', 'notFound']);
    });

    it('a supplier with neither an EU VAT id nor an LEI has no register to ask', async () => {
      const buyer = await tokenFor(harness.tenantA, ['buyer']);
      const { supplierId } = createdSupplier.parse(
        (
          await command(
            'suppliers.create',
            { code: 'NO-REGISTER', name: 'Synthetic Local Ltd', country: 'CA', vatId: null, lei: null },
            buyer,
          )
        ).body,
      );
      const checked = await harness.command('staff', 'suppliers.checkIdentity', { supplierId }, { token: buyer });
      expect(checked.body).toEqual({ supplierId, registers: [] });
      const detail = supplierDetailSchema.parse(
        (await harness.query('staff', 'suppliers.detail', { supplierId }, buyer)).body,
      );
      expect(detail.supplier.identityChecks).toEqual([]);
      const list = supplierListSchema.parse((await harness.query('staff', 'suppliers.list', {}, buyer)).body);
      expect(list.suppliers.find((supplier) => supplier.supplierId === supplierId)).toMatchObject({
        identityCheck: { status: 'notApplicable', register: null, checkedAt: null },
        evidence: null,
      });
    });
  });
});
