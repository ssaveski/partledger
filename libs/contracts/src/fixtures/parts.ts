import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler } from '../client/fixture-adapter';
import { partListQuery, type PartCategory } from '../parts/queries';
import { fixtureId } from './ids';
import { fixtureCovers, fixtureSuppliers } from './suppliers';

/**
 * Synthetic parts: invented numbers and descriptions only. The first five are the parts of the
 * key-screen RFQs; PN-20877 has moved to revision C since RFQ-1042 was published, which is the
 * drift its open line shows (R8).
 */

type PartListOutput = z.input<typeof partListQuery.output>;

export type FixturePart = PartListOutput['parts'][number];

interface PartSpec {
  readonly serial: number;
  readonly partNumber: string;
  readonly revision: string;
  readonly description: string;
  readonly category: PartCategory;
  readonly source: 'erp' | 'platform';
  readonly active?: boolean;
  readonly updatedAt: string;
}

const specs: readonly PartSpec[] = [
  {
    serial: 3601,
    partNumber: 'PN-10432',
    revision: 'C',
    description: 'Pump housing, cast aluminium',
    category: 'castings',
    source: 'erp',
    updatedAt: '2026-08-14T06:00:00Z',
  },
  {
    serial: 3602,
    partNumber: 'PN-10433',
    revision: 'A',
    description: 'Cover plate, machined',
    category: 'machinedParts',
    source: 'erp',
    updatedAt: '2026-06-02T06:00:00Z',
  },
  {
    serial: 3603,
    partNumber: 'PN-10440',
    revision: 'B',
    description: 'Impeller, cast bronze',
    category: 'castings',
    source: 'erp',
    updatedAt: '2026-07-21T06:00:00Z',
  },
  {
    serial: 3604,
    partNumber: 'PN-20877',
    revision: 'C',
    description: 'Drive shaft, stainless steel',
    category: 'machinedParts',
    source: 'erp',
    updatedAt: '2026-09-26T06:00:00Z',
  },
  {
    serial: 3605,
    partNumber: 'PN-20910',
    revision: 'A',
    description: 'Bearing sleeve, machined bronze',
    category: 'machinedParts',
    source: 'platform',
    updatedAt: '2026-09-02T13:40:00Z',
  },
  {
    serial: 3606,
    partNumber: 'PN-31005',
    revision: 'D',
    description: 'Fastener kit, 48 pieces',
    category: 'fasteners',
    source: 'erp',
    updatedAt: '2026-05-11T06:00:00Z',
  },
  {
    serial: 3607,
    partNumber: 'PN-31006',
    revision: 'A',
    description: 'Gasket set, nitrile',
    category: 'seals',
    source: 'erp',
    updatedAt: '2026-05-11T06:00:00Z',
  },
  {
    serial: 3608,
    partNumber: 'PN-31007',
    revision: 'B',
    description: 'O-ring set, fluorocarbon',
    category: 'seals',
    source: 'erp',
    active: false,
    updatedAt: '2026-09-12T06:00:00Z',
  },
  {
    serial: 3609,
    partNumber: 'PN-31010',
    revision: 'A',
    description: 'Hex bolt M10 x 40, stainless',
    category: 'fasteners',
    source: 'platform',
    updatedAt: '2026-08-30T10:15:00Z',
  },
  {
    serial: 3610,
    partNumber: 'PN-40002',
    revision: 'A',
    description: 'Mounting bracket, sheet steel',
    category: 'sheetMetal',
    source: 'platform',
    updatedAt: '2026-09-08T16:05:00Z',
  },
  {
    serial: 3611,
    partNumber: 'PN-40005',
    revision: 'C',
    description: 'Guard panel, perforated',
    category: 'sheetMetal',
    source: 'erp',
    active: false,
    updatedAt: '2026-09-12T06:00:00Z',
  },
  {
    serial: 3612,
    partNumber: 'PN-50011',
    revision: 'B',
    description: 'Sensor harness, 6-way',
    category: 'electronics',
    source: 'platform',
    updatedAt: '2026-09-15T09:30:00Z',
  },
];

export const fixtureParts: readonly FixturePart[] = specs.map((spec) => ({
  partId: fixtureId(spec.serial),
  partNumber: spec.partNumber,
  revision: spec.revision,
  description: spec.description,
  category: spec.category,
  unit: 'each',
  source: spec.source,
  active: spec.active ?? true,
  approvedSupplierCount: fixtureSuppliers.filter((supplier) => fixtureCovers(supplier, spec.category)).length,
  updatedAt: spec.updatedAt,
  version: 1,
}));

/** The category of a fixture part, which RFQ lines snapshot by part number. */
export function fixtureCategoryOf(partNumber: string): PartCategory {
  const part = fixtureParts.find((candidate) => candidate.partNumber === partNumber);
  if (part === undefined) {
    throw new Error(`No fixture part ${partNumber}`);
  }
  return part.category;
}

const partList: PartListOutput = { parts: [...fixtureParts] };

export const partFixtureHandlers: readonly FixtureHandler[] = [
  fixtureQuery(partListQuery, (_input, view) => ({
    kind: 'output',
    output: view === 'empty' ? { parts: [] } : partList,
  })),
];

export const partFixtureOutputs = { list: partList };
