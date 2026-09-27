import { describe, expect, it } from 'vitest';

import type { StoredPart } from './part-store';
import { erpOwnedFieldsChanged } from './parts.handlers';

const part: StoredPart = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  partNumber: 'PN-10432',
  revision: 'C',
  description: 'Synthetic housing',
  category: 'castings',
  unit: 'each',
  source: 'erp',
  active: true,
  version: 3,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-02T00:00:00Z'),
};

describe('the ERP-owned fields of a part change', () => {
  it('names each ERP-owned field whose value would change', () => {
    expect(erpOwnedFieldsChanged(part, { revision: 'D', description: 'Renamed', unit: 'kilogram' })).toEqual([
      'revision',
      'description',
      'unit',
    ]);
  });

  it('lets an unchanged ERP-owned value and the category through', () => {
    expect(erpOwnedFieldsChanged(part, { revision: 'C', category: 'seals' })).toEqual([]);
  });

  it('names nothing on a part maintained in the platform', () => {
    expect(erpOwnedFieldsChanged({ ...part, source: 'platform' }, { partNumber: 'PN-2', revision: 'D' })).toEqual([]);
  });
});
