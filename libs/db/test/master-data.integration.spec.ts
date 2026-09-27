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
  async function outcomeAs(tenantId: string, statement: string, values: unknown[] = []): Promise<string> {
    await app.query('begin');
    try {
      await app.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
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
});
