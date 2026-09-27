import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { insertPart, insertSupplier, insertTenant, startTestDatabase, type TestDatabase } from './harness.ts';

/** What the database itself refuses on parts, suppliers, contacts and approvals (U10), as `pl_app`. */
describe('master data integrity', () => {
  let database: TestDatabase;
  let superuser: pg.Client;
  let app: pg.Client;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    database = await startTestDatabase();
    superuser = await database.connect('superuser');
    app = await database.connect('pl_app');
    tenantA = await insertTenant(superuser, 'tenant-a');
    tenantB = await insertTenant(superuser, 'tenant-b');
  }, 300_000);

  afterAll(async () => {
    await Promise.all([superuser.end(), app.end()]);
    await database.stop();
  });

  /** Runs one statement as `pl_app` in a tenant transaction that rolls back; returns its SQLSTATE, or `ok`. */
  async function outcomeAs(
    tenantId: string,
    statement: string,
    values: unknown[] = [],
    writer: 'erp_import' | null = null,
  ): Promise<string> {
    await app.query('begin');
    try {
      await app.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      if (writer !== null) {
        await app.query(`select set_config('app.master_data_writer', $1, true)`, [writer]);
      }
      await app.query(statement, values);
      return 'ok';
    } catch (error) {
      return error instanceof pg.DatabaseError ? (error.code ?? 'unknown') : String(error);
    } finally {
      await app.query('rollback');
    }
  }

  it('lets the app change a part’s fields but never its source, tenant or id, and never delete it', async () => {
    const partId = await insertPart(superuser, { tenantId: tenantA, partNumber: 'PN-DB-1' });
    expect(await outcomeAs(tenantA, `update parts set category = 'seals', version = 2 where id = $1`, [partId])).toBe(
      'ok',
    );
    expect(await outcomeAs(tenantA, `update parts set source = 'platform' where id = $1`, [partId])).toBe('42501');
    expect(await outcomeAs(tenantA, `update parts set tenant_id = $2 where id = $1`, [partId, tenantB])).toBe('42501');
    expect(await outcomeAs(tenantA, `delete from parts where id = $1`, [partId])).toBe('42501');
  });

  it('refuses a change that does not move the version on by exactly one', async () => {
    const partId = await insertPart(superuser, { tenantId: tenantA, partNumber: 'PN-DB-2' });
    const supplierId = await insertSupplier(superuser, {
      tenantId: tenantA,
      code: 'DB-VER',
      approval: { status: 'approved', scope: ['seals'] },
    });
    expect(await outcomeAs(tenantA, `update parts set revision = 'B' where id = $1`, [partId])).toBe('40001');
    expect(await outcomeAs(tenantA, `update suppliers set name = 'X', version = 5 where id = $1`, [supplierId])).toBe(
      '40001',
    );
    expect(
      await outcomeAs(tenantA, `update approved_supplier_entries set status = 'suspended' where supplier_id = $1`, [
        supplierId,
      ]),
    ).toBe('40001');
  });

  it('refuses a contact or approval for another tenant’s supplier', async () => {
    const supplierOfB = await insertSupplier(superuser, { tenantId: tenantB, code: 'DB-OTHER' });
    expect(
      await outcomeAs(
        tenantA,
        `insert into supplier_contacts (tenant_id, supplier_id, name, email, role, added_at)
         values ($1, $2, 'Synthetic', 'a@b.test', 'sales', now())`,
        [tenantA, supplierOfB],
      ),
    ).toBe('23503');
    expect(
      await outcomeAs(
        tenantA,
        `insert into approved_supplier_entries (tenant_id, supplier_id, status, scope, updated_at)
         values ($1, $2, 'approved', '{seals}', now())`,
        [tenantA, supplierOfB],
      ),
    ).toBe('23503');
  });

  it('keeps no scope or expiry for a supplier off the list, and a scope for an approval', async () => {
    const supplierId = await insertSupplier(superuser, { tenantId: tenantA, code: 'DB-SCOPE' });
    const insert = `insert into approved_supplier_entries (tenant_id, supplier_id, status, scope, expires_on, updated_at)
                    values ($1, $2, $3, $4, $5, now())`;
    expect(await outcomeAs(tenantA, insert, [tenantA, supplierId, 'notApproved', ['seals'], null])).toBe('23514');
    expect(await outcomeAs(tenantA, insert, [tenantA, supplierId, 'approved', [], null])).toBe('23514');
    expect(await outcomeAs(tenantA, insert, [tenantA, supplierId, 'approved', ['welding'], null])).toBe('23514');
    expect(await outcomeAs(tenantA, insert, [tenantA, supplierId, 'notApproved', [], null])).toBe('ok');
  });

  it('allows one current contact per address and supplier, and a removed contact stays removed', async () => {
    const supplierId = await insertSupplier(superuser, { tenantId: tenantA, code: 'DB-CONTACT' });
    const insert = `insert into supplier_contacts (tenant_id, supplier_id, name, email, role, added_at, removed_at)
                    values ($1, $2, 'Synthetic', 'quotes@supplier.test', 'sales', now(), $3) returning id`;
    const removed = await superuser.query(insert, [tenantA, supplierId, new Date(Date.now() + 60_000).toISOString()]);
    await superuser.query(insert, [tenantA, supplierId, null]);
    expect(await outcomeAs(tenantA, insert, [tenantA, supplierId, null])).toBe('23505');
    const [{ id }] = z.tuple([z.object({ id: z.uuid() })]).parse(removed.rows);
    expect(await outcomeAs(tenantA, `update supplier_contacts set removed_at = null where id = $1`, [id])).toBe(
      '42501',
    );
  });

  describe('ERP ownership', () => {
    let erpPart: string;
    let erpSupplier: string;
    let platformPart: string;
    let platformSupplier: string;
    let erpListTenant: string;
    let erpListSupplier: string;

    beforeAll(async () => {
      erpPart = await insertPart(superuser, { tenantId: tenantA, partNumber: 'PN-OWN-ERP', source: 'erp' });
      platformPart = await insertPart(superuser, { tenantId: tenantA, partNumber: 'PN-OWN-PLT', source: 'platform' });
      erpSupplier = await insertSupplier(superuser, { tenantId: tenantA, code: 'OWN-ERP', source: 'erp' });
      platformSupplier = await insertSupplier(superuser, { tenantId: tenantA, code: 'OWN-PLT', source: 'platform' });
      erpListTenant = await insertTenant(superuser, 'tenant-erp-list');
      await superuser.query(`update tenants set supplier_list_source = 'erp' where id = $1`, [erpListTenant]);
      erpListSupplier = await insertSupplier(superuser, {
        tenantId: erpListTenant,
        code: 'OWN-LIST',
        approval: { status: 'approved', scope: ['seals'] },
      });
    });

    const insertErpPart = `insert into parts (tenant_id, part_number, revision, description, category, unit, source, created_at, updated_at)
                           values ($1, 'PN-OWN-NEW', 'A', 'Synthetic', 'seals', 'each', 'erp', now(), now())`;
    const insertErpSupplier = `insert into suppliers (tenant_id, code, name, country, status, source, created_at, updated_at)
                               values ($1, 'OWN-NEW', 'Synthetic', 'CA', 'active', 'erp', now(), now())`;

    const erpPartWrites = (): [string, unknown[]][] =>
      ['part_number = $2', 'revision = $2', 'description = $2', `unit = 'metre'`, 'active = false'].map(
        (assignment) => [
          `update parts set ${assignment}, version = 2 where id = $1`,
          assignment.includes('$2') ? [erpPart, 'CHANGED'] : [erpPart],
        ],
      );
    const erpSupplierWrites = (): [string, unknown[]][] =>
      ['code = $2', 'name = $2', `country = 'SE'`, `status = 'inactive'`].map((assignment) => [
        `update suppliers set ${assignment}, version = 2 where id = $1`,
        assignment.includes('$2') ? [erpSupplier, 'CHANGED'] : [erpSupplier],
      ]);

    it('refuses the app every change to an ERP-owned column of an ERP-sourced part or supplier', async () => {
      const outcomes = [];
      for (const [statement, values] of [...erpPartWrites(), ...erpSupplierWrites()]) {
        outcomes.push(await outcomeAs(tenantA, statement, values));
      }
      expect(outcomes).toEqual(Array.from({ length: 9 }, () => '42501'));
    });

    it('refuses the app an ERP-sourced part or supplier it inserts itself', async () => {
      expect(await outcomeAs(tenantA, insertErpPart, [tenantA])).toBe('42501');
      expect(await outcomeAs(tenantA, insertErpSupplier, [tenantA])).toBe('42501');
    });

    it('refuses any write to an approved-supplier list mirrored from the ERP', async () => {
      const other = await insertSupplier(superuser, { tenantId: erpListTenant, code: 'OWN-LIST-2' });
      expect(
        await outcomeAs(
          erpListTenant,
          `update approved_supplier_entries set status = 'suspended', version = 2 where supplier_id = $1`,
          [erpListSupplier],
        ),
      ).toBe('42501');
      expect(
        await outcomeAs(
          erpListTenant,
          `insert into approved_supplier_entries (tenant_id, supplier_id, status, scope, updated_at)
           values ($1, $2, 'approved', '{seals}', now())`,
          [erpListTenant, other],
        ),
      ).toBe('42501');
    });

    it('lets a transaction that names itself the ERP import make the same writes', async () => {
      const outcomes = [];
      for (const [statement, values] of [...erpPartWrites(), ...erpSupplierWrites()]) {
        outcomes.push(await outcomeAs(tenantA, statement, values, 'erp_import'));
      }
      outcomes.push(await outcomeAs(tenantA, insertErpPart, [tenantA], 'erp_import'));
      outcomes.push(await outcomeAs(tenantA, insertErpSupplier, [tenantA], 'erp_import'));
      outcomes.push(
        await outcomeAs(
          erpListTenant,
          `update approved_supplier_entries set status = 'suspended', version = 2 where supplier_id = $1`,
          [erpListSupplier],
          'erp_import',
        ),
      );
      expect(outcomes).toEqual(Array.from({ length: 12 }, () => 'ok'));
    });

    it('leaves platform-sourced rows and a platform-maintained list to the app', async () => {
      expect(
        await outcomeAs(
          tenantA,
          `update parts set description = 'Changed', active = false, version = 2 where id = $1`,
          [platformPart],
        ),
      ).toBe('ok');
      expect(
        await outcomeAs(
          tenantA,
          `update suppliers set name = 'Changed', status = 'inactive', version = 2 where id = $1`,
          [platformSupplier],
        ),
      ).toBe('ok');
      expect(
        await outcomeAs(
          tenantA,
          `insert into approved_supplier_entries (tenant_id, supplier_id, status, scope, updated_at)
           values ($1, $2, 'approved', '{seals}', now())`,
          [tenantA, platformSupplier],
        ),
      ).toBe('ok');
    });

    it('lets the app change what the platform keeps on an ERP-sourced row', async () => {
      expect(
        await outcomeAs(tenantA, `update parts set category = 'seals', version = 2 where id = $1`, [erpPart]),
      ).toBe('ok');
      expect(
        await outcomeAs(tenantA, `update suppliers set vat_id = 'SE556677889901', version = 2 where id = $1`, [
          erpSupplier,
        ]),
      ).toBe('ok');
    });
  });
});
