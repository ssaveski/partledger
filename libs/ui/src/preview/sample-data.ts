// Synthetic preview data; every name and number here is invented.
export const samplePart = {
  number: 'PL-BRK-10042',
  revision: 'C',
  unitPrice: '1,284.50 CAD',
  quantity: '250',
};

export const sampleSuppliers = [
  { value: 'northwind', label: 'Northwind Castings' },
  { value: 'aurora', label: 'Aurora Precision Machining' },
  { value: 'kestrel', label: 'Kestrel Coatings' },
];

export type SamplePartStatus = 'approved' | 'pending' | 'expired' | 'draft';

export interface SamplePartRow {
  readonly id: string;
  readonly number: string;
  readonly revision: string;
  readonly description: string;
  readonly material: string;
  readonly status: SamplePartStatus;
  readonly quantity: number;
  readonly unitPrice: number;
}

const sampleDescriptions = [
  'Bracket, machined aluminium',
  'Bushing, flanged bronze',
  'Spacer, stainless steel',
  'Hinge pin, heat treated',
  'Mounting plate, anodised',
  'Gusset, formed sheet',
  'Clevis, forged',
  'Shim, laminated',
];

const sampleMaterials = ['Al 6061-T6', 'C93200 bronze', 'SS 316L', '4340 steel', 'Ti-6Al-4V', 'Al 2024-T3'];

const sampleStatuses: readonly SamplePartStatus[] = ['approved', 'pending', 'expired', 'draft'];

/** A deterministic list of invented parts for grid previews. */
export function sampleParts(count: number): SamplePartRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `part-${index + 1}`,
    number: `PL-${String(10001 + index * 7).padStart(5, '0')}`,
    revision: String.fromCharCode(65 + (index % 5)),
    description: sampleDescriptions[index % sampleDescriptions.length] ?? '',
    material: sampleMaterials[(index * 5) % sampleMaterials.length] ?? '',
    status: sampleStatuses[(index * 3 + Math.floor(index / 4)) % sampleStatuses.length] ?? 'draft',
    quantity: 25 * (1 + ((index * 11) % 40)),
    unitPrice: Math.round((12.5 + ((index * 37) % 900) * 1.37) * 100) / 100,
  }));
}
