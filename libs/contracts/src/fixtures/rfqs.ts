import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler, type FixtureResponse } from '../client/fixture-adapter';
import { errorCode } from '../errors';
import {
  approvalPacketQuery,
  type evidenceDocumentSchema,
  quoteComparisonQuery,
  rfqDetailQuery,
  type ComparisonCellState,
  type SupplierEvidenceStatus,
} from '../rfqs/queries';

/**
 * Synthetic RFQs for the key screens: invented parts, suppliers, people and certificates only.
 * Each RFQ id stands for one scenario a reviewer can open; the screens never know which is which.
 */

type DetailOutput = z.input<typeof rfqDetailQuery.output>;
type ComparisonOutput = z.input<typeof quoteComparisonQuery.output>;
type ApprovalOutput = z.input<typeof approvalPacketQuery.output>;
type EvidenceDocument = z.input<typeof evidenceDocumentSchema>;

export function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

export const fixtureRfqIds = {
  open: fixtureId(1042),
  closed: fixtureId(1038),
  blockedApproval: fixtureId(1031),
  readyApproval: fixtureId(1027),
  draftWithoutSuppliers: fixtureId(1050),
  forbidden: fixtureId(9403),
  unavailable: fixtureId(9503),
  slow: fixtureId(9102),
} as const;

export type FixtureScenario = keyof typeof fixtureRfqIds;

const tenantCurrency = 'CAD';

const suppliers = {
  northwind: { supplierId: fixtureId(2001), name: 'Northwind Castings' },
  birchfield: { supplierId: fixtureId(2002), name: 'Birchfield Precision' },
  kestrel: { supplierId: fixtureId(2003), name: 'Kestrel Machining' },
  arbor: { supplierId: fixtureId(2004), name: 'Arbor Fasteners' },
} as const;

type SupplierKey = keyof typeof suppliers;

const supplierOrder: readonly SupplierKey[] = ['northwind', 'birchfield', 'kestrel', 'arbor'];

const evidenceBySupplier: Readonly<Record<SupplierKey, SupplierEvidenceStatus>> = {
  northwind: 'valid',
  birchfield: 'expiring',
  kestrel: 'invalid',
  arbor: 'deviation',
};

interface PartSpec {
  readonly serial: number;
  readonly lineNumber: number;
  readonly partNumber: string;
  readonly revision: string;
  readonly description: string;
  readonly quantity: number;
  readonly requiredBy: string;
}

const parts: readonly PartSpec[] = [
  {
    serial: 3001,
    lineNumber: 1,
    partNumber: 'PN-10432',
    revision: 'C',
    description: 'Pump housing, cast aluminium',
    quantity: 200,
    requiredBy: '2026-12-04',
  },
  {
    serial: 3002,
    lineNumber: 2,
    partNumber: 'PN-10433',
    revision: 'A',
    description: 'Cover plate, machined',
    quantity: 500,
    requiredBy: '2026-12-04',
  },
  {
    serial: 3003,
    lineNumber: 3,
    partNumber: 'PN-20877',
    revision: 'B',
    description: 'Drive shaft, stainless steel',
    quantity: 120,
    requiredBy: '2027-01-15',
  },
  {
    serial: 3004,
    lineNumber: 4,
    partNumber: 'PN-31005',
    revision: 'D',
    description: 'Fastener kit, 48 pieces',
    quantity: 2000,
    requiredBy: '2026-11-20',
  },
  {
    serial: 3005,
    lineNumber: 5,
    partNumber: 'PN-31006',
    revision: 'A',
    description: 'Gasket set, nitrile',
    quantity: 1000,
    requiredBy: '2026-11-20',
  },
];

function partFields(part: PartSpec) {
  return {
    lineId: fixtureId(part.serial),
    lineNumber: part.lineNumber,
    partNumber: part.partNumber,
    revision: part.revision,
    description: part.description,
    quantity: part.quantity,
    unit: 'each' as const,
  };
}

/** The parts of one RFQ, numbered from 1 and with line ids of their own. */
function rfqParts(serialBase: number, indexes: readonly number[]): PartSpec[] {
  return indexes.map((index, position) => {
    const part = parts[index];
    if (part === undefined) {
      throw new Error(`No fixture part at ${index}`);
    }
    return { ...part, serial: serialBase + position, lineNumber: position + 1 };
  });
}

function at(list: readonly PartSpec[], index: number): PartSpec {
  const part = list[index];
  if (part === undefined) {
    throw new Error(`No fixture line at ${index}`);
  }
  return part;
}

const openParts = rfqParts(3100, [0, 1, 2, 3]);
const closedParts = rfqParts(3200, [0, 1, 2, 3, 4]);
const blockedParts = rfqParts(3300, [0, 1, 2]);
const readyParts = rfqParts(3400, [3, 4, 0]);
const draftParts = rfqParts(3500, [0, 1]);

const exchangeRates = [
  { currency: 'USD', rate: '1.3642', capturedOn: '2026-09-22', source: 'centralBank' },
  { currency: 'EUR', rate: '1.4810', capturedOn: '2026-09-22', source: 'centralBank' },
] as const;

const rateTo: Readonly<Record<string, number>> = { CAD: 1, USD: 1.3642, EUR: 1.481 };

function money(amount: number, currency: string) {
  return { amount: amount.toFixed(2), currency };
}

/**
 * A synthetic stand-in for R21's normalisation, so fixture totals are consistent with their prices.
 * The API computes the real total in `libs/domain`.
 */
export function fixtureNormalisedTotal(input: {
  readonly unitPrice: number;
  readonly oneOffCosts: number;
  readonly currency: string;
  readonly quantity: number;
  readonly minimumOrderQuantity: number;
}): { amount: string; currency: string } {
  const rate = rateTo[input.currency] ?? 1;
  const total = (input.unitPrice * Math.max(input.quantity, input.minimumOrderQuantity) + input.oneOffCosts) * rate;
  return money(total, tenantCurrency);
}

interface CellSpec {
  readonly supplier: SupplierKey;
  readonly state: ComparisonCellState;
  readonly unitPrice?: number;
  readonly oneOffCosts?: number;
  readonly currency?: string;
  readonly minimumOrderQuantity?: number;
  readonly leadTimeDays?: number;
  readonly buyerRecorded?: boolean;
  readonly alternatePart?: string;
  readonly alternateAccepted?: boolean;
  readonly noQuoteReason?: string;
}

let quoteSerial = 5000;

function cell(part: PartSpec, spec: CellSpec) {
  const supplierId = suppliers[spec.supplier].supplierId;
  const quoted = spec.unitPrice !== undefined;
  const currency = spec.currency ?? tenantCurrency;
  const oneOffCosts = spec.oneOffCosts ?? 0;
  const minimumOrderQuantity = spec.minimumOrderQuantity ?? 1;
  quoteSerial += 1;
  return {
    supplierId,
    state: spec.state,
    quote: quoted
      ? {
          quoteId: fixtureId(quoteSerial),
          unitPrice: money(spec.unitPrice, currency),
          oneOffCosts: money(oneOffCosts, currency),
          minimumOrderQuantity,
          leadTimeDays: spec.leadTimeDays ?? 42,
          validUntil: '2026-12-31',
          normalisedTotal: fixtureNormalisedTotal({
            unitPrice: spec.unitPrice,
            oneOffCosts,
            currency,
            quantity: part.quantity,
            minimumOrderQuantity,
          }),
          buyerRecorded: spec.buyerRecorded ?? false,
        }
      : null,
    alternate:
      spec.alternatePart === undefined
        ? null
        : { partNumber: spec.alternatePart, acceptedByQuality: spec.alternateAccepted ?? false },
    noQuoteReason: spec.noQuoteReason ?? null,
  };
}

function comparisonLine(part: PartSpec, cells: readonly CellSpec[]) {
  const lowest = cells.find((spec) => spec.state === 'bestPrice');
  return {
    ...partFields(part),
    lowestSupplierId: lowest === undefined ? null : suppliers[lowest.supplier].supplierId,
    cells: cells.map((spec) => cell(part, spec)),
  };
}

// RFQ-1038: closed, every cell state on show.
const closedLines = [
  comparisonLine(at(closedParts, 0), [
    { supplier: 'northwind', state: 'submitted', unitPrice: 52.25, oneOffCosts: 1200, leadTimeDays: 35 },
    { supplier: 'birchfield', state: 'bestPrice', unitPrice: 49.9, oneOffCosts: 900, leadTimeDays: 49 },
    { supplier: 'kestrel', state: 'submitted', unitPrice: 41.1, oneOffCosts: 800, currency: 'USD', leadTimeDays: 28 },
  ]),
  comparisonLine(at(closedParts, 1), [
    { supplier: 'northwind', state: 'bestPrice', unitPrice: 8.4, leadTimeDays: 30, minimumOrderQuantity: 500 },
    {
      supplier: 'birchfield',
      state: 'alternate',
      unitPrice: 8.1,
      oneOffCosts: 450,
      leadTimeDays: 30,
      alternatePart: 'PN-10433-X',
      alternateAccepted: false,
    },
    { supplier: 'kestrel', state: 'noQuote', noQuoteReason: 'Capacity booked until the second quarter.' },
  ]),
  comparisonLine(at(closedParts, 2), [
    { supplier: 'northwind', state: 'stale', unitPrice: 88, leadTimeDays: 56 },
    { supplier: 'birchfield', state: 'bestPrice', unitPrice: 91.5, leadTimeDays: 42 },
    { supplier: 'kestrel', state: 'late' },
    { supplier: 'arbor', state: 'submitted', unitPrice: 67.2, currency: 'EUR', leadTimeDays: 63 },
  ]),
  comparisonLine(at(closedParts, 3), [
    { supplier: 'birchfield', state: 'bestPrice', unitPrice: 3.85, leadTimeDays: 21, buyerRecorded: true },
    { supplier: 'kestrel', state: 'pending' },
    // The lower unit price loses once the minimum order quantity raises the quantity.
    { supplier: 'arbor', state: 'submitted', unitPrice: 3.4, leadTimeDays: 14, minimumOrderQuantity: 2500 },
  ]),
  comparisonLine(at(closedParts, 4), [
    { supplier: 'northwind', state: 'pending' },
    { supplier: 'birchfield', state: 'bestPrice', unitPrice: 1.95, leadTimeDays: 21 },
    {
      supplier: 'arbor',
      state: 'alternate',
      unitPrice: 2.1,
      leadTimeDays: 10,
      alternatePart: 'PN-31006-N2',
      alternateAccepted: true,
    },
  ]),
];

function supplierColumns(keys: readonly SupplierKey[]) {
  return keys.map((key) => ({ ...suppliers[key], evidence: evidenceBySupplier[key] }));
}

function responseStatus(key: SupplierKey, linesAssigned: number, respondedAt: string | null) {
  return {
    ...suppliers[key],
    linesAssigned,
    response: respondedAt === null ? ('notYet' as const) : ('responded' as const),
    respondedAt,
  };
}

function detailLines(lines: readonly PartSpec[]) {
  return lines.map((part) => ({ ...partFields(part), requiredBy: part.requiredBy }));
}

const details: Readonly<Record<string, DetailOutput>> = {
  [fixtureRfqIds.open]: {
    rfqId: fixtureRfqIds.open,
    reference: 'RFQ-1042',
    title: 'Pump assembly castings and fasteners',
    status: 'published',
    version: 2,
    deadline: '2026-10-09T16:00:00Z',
    currency: tenantCurrency,
    round: 1,
    lines: detailLines(openParts),
    suppliers: [
      responseStatus('northwind', 3, '2026-09-25T14:12:00Z'),
      responseStatus('birchfield', 4, null),
      responseStatus('kestrel', 4, '2026-09-26T09:40:00Z'),
      responseStatus('arbor', 2, null),
    ],
    allowedTransitions: ['amend', 'extendDeadline', 'close', 'cancel'],
    blockingReasons: [{ transition: 'publish', message: 'pl.rfqs.blocked.alreadyPublished', params: {} }],
  },
  [fixtureRfqIds.closed]: {
    rfqId: fixtureRfqIds.closed,
    reference: 'RFQ-1038',
    title: 'Pump housings, shafts and seals',
    status: 'closed',
    version: 2,
    deadline: '2026-09-22T16:00:00Z',
    currency: tenantCurrency,
    round: 1,
    lines: detailLines(closedParts),
    suppliers: [
      responseStatus('northwind', 4, '2026-09-19T11:05:00Z'),
      responseStatus('birchfield', 5, '2026-09-21T17:30:00Z'),
      responseStatus('kestrel', 4, '2026-09-20T08:15:00Z'),
      responseStatus('arbor', 3, '2026-09-22T15:02:00Z'),
    ],
    allowedTransitions: ['cancel'],
    blockingReasons: [{ transition: 'extendDeadline', message: 'pl.rfqs.blocked.answersSeen', params: {} }],
  },
  [fixtureRfqIds.blockedApproval]: {
    rfqId: fixtureRfqIds.blockedApproval,
    reference: 'RFQ-1031-R2',
    title: 'Drive shafts and cover plates, re-bid',
    status: 'pendingApproval',
    version: 1,
    deadline: '2026-09-18T16:00:00Z',
    currency: tenantCurrency,
    round: 2,
    lines: detailLines(blockedParts),
    suppliers: [
      responseStatus('northwind', 3, '2026-09-15T10:00:00Z'),
      responseStatus('birchfield', 3, '2026-09-17T13:45:00Z'),
      responseStatus('kestrel', 3, '2026-09-16T09:20:00Z'),
    ],
    allowedTransitions: [],
    blockingReasons: [{ transition: 'cancel', message: 'pl.rfqs.blocked.awardPending', params: {} }],
  },
  [fixtureRfqIds.readyApproval]: {
    rfqId: fixtureRfqIds.readyApproval,
    reference: 'RFQ-1027',
    title: 'Fastener kits and gasket sets',
    status: 'pendingApproval',
    version: 1,
    deadline: '2026-09-12T16:00:00Z',
    currency: tenantCurrency,
    round: 1,
    lines: detailLines(readyParts),
    suppliers: [
      responseStatus('northwind', 3, '2026-09-10T12:00:00Z'),
      responseStatus('birchfield', 3, '2026-09-11T16:20:00Z'),
      responseStatus('arbor', 2, '2026-09-12T09:05:00Z'),
    ],
    allowedTransitions: [],
    blockingReasons: [{ transition: 'cancel', message: 'pl.rfqs.blocked.awardPending', params: {} }],
  },
  [fixtureRfqIds.draftWithoutSuppliers]: {
    rfqId: fixtureRfqIds.draftWithoutSuppliers,
    reference: 'RFQ-1050',
    title: 'Seal kits for the spring build',
    status: 'draft',
    version: 1,
    deadline: '2026-10-30T16:00:00Z',
    currency: tenantCurrency,
    round: 1,
    lines: detailLines(draftParts),
    suppliers: [],
    allowedTransitions: ['cancel'],
    blockingReasons: [{ transition: 'publish', message: 'pl.rfqs.blocked.noSuppliers', params: {} }],
  },
};

function notYetClosed(detail: DetailOutput): ComparisonOutput {
  return {
    availability: 'notYetClosed',
    rfqId: detail.rfqId,
    reference: detail.reference,
    title: detail.title,
    deadline: detail.deadline,
  };
}

function detailOf(rfqId: string): DetailOutput {
  const detail = details[rfqId];
  if (detail === undefined) {
    throw new Error(`No fixture RFQ ${rfqId}`);
  }
  return detail;
}

function closedComparison(
  detail: DetailOutput,
  lines: ReturnType<typeof comparisonLine>[],
  keys: readonly SupplierKey[],
  pending: boolean,
): ComparisonOutput {
  return {
    availability: 'available',
    rfqId: detail.rfqId,
    reference: detail.reference,
    title: detail.title,
    status: detail.status,
    version: detail.version,
    closedAt: detail.deadline,
    currency: tenantCurrency,
    exchangeRates: [...exchangeRates],
    suppliers: supplierColumns(keys),
    lines,
    allowedTransitions: pending ? [] : ['recordOutsideQuote', 'submitAward'],
    blockingReasons: pending
      ? [
          { transition: 'recordOutsideQuote', message: 'pl.rfqs.blocked.awardPending', params: {} },
          { transition: 'submitAward', message: 'pl.rfqs.blocked.awardPending', params: {} },
        ]
      : [],
  };
}

const comparisons: Readonly<Record<string, ComparisonOutput>> = {
  [fixtureRfqIds.open]: notYetClosed(detailOf(fixtureRfqIds.open)),
  [fixtureRfqIds.draftWithoutSuppliers]: notYetClosed(detailOf(fixtureRfqIds.draftWithoutSuppliers)),
  [fixtureRfqIds.closed]: closedComparison(detailOf(fixtureRfqIds.closed), closedLines, supplierOrder, false),
  [fixtureRfqIds.blockedApproval]: closedComparison(
    detailOf(fixtureRfqIds.blockedApproval),
    [
      comparisonLine(at(blockedParts, 0), [
        { supplier: 'northwind', state: 'bestPrice', unitPrice: 50.75, oneOffCosts: 1000 },
        { supplier: 'birchfield', state: 'submitted', unitPrice: 53.2, oneOffCosts: 900 },
        { supplier: 'kestrel', state: 'submitted', unitPrice: 40.2, oneOffCosts: 800, currency: 'USD' },
      ]),
      comparisonLine(at(blockedParts, 1), [
        { supplier: 'northwind', state: 'noQuote', noQuoteReason: 'Tooling not available.' },
        { supplier: 'birchfield', state: 'bestPrice', unitPrice: 7.9, leadTimeDays: 112 },
        { supplier: 'kestrel', state: 'submitted', unitPrice: 8.35, leadTimeDays: 28 },
      ]),
      comparisonLine(at(blockedParts, 2), [
        { supplier: 'northwind', state: 'pending' },
        { supplier: 'birchfield', state: 'noQuote', noQuoteReason: 'Material not stocked.' },
        { supplier: 'kestrel', state: 'pending' },
      ]),
    ],
    ['northwind', 'birchfield', 'kestrel'],
    true,
  ),
  [fixtureRfqIds.readyApproval]: closedComparison(
    detailOf(fixtureRfqIds.readyApproval),
    [
      comparisonLine(at(readyParts, 0), [
        { supplier: 'northwind', state: 'submitted', unitPrice: 3.9 },
        { supplier: 'birchfield', state: 'bestPrice', unitPrice: 3.55 },
        { supplier: 'arbor', state: 'submitted', unitPrice: 3.6 },
      ]),
      comparisonLine(at(readyParts, 1), [
        { supplier: 'northwind', state: 'submitted', unitPrice: 2.05, buyerRecorded: true },
        { supplier: 'birchfield', state: 'bestPrice', unitPrice: 1.9, leadTimeDays: 70 },
        { supplier: 'arbor', state: 'submitted', unitPrice: 2.2, leadTimeDays: 14 },
      ]),
      comparisonLine(at(readyParts, 2), [
        { supplier: 'northwind', state: 'bestPrice', unitPrice: 49.5, oneOffCosts: 900, buyerRecorded: true },
        { supplier: 'birchfield', state: 'submitted', unitPrice: 51 },
      ]),
    ],
    ['northwind', 'birchfield', 'arbor'],
    true,
  ),
};

const qualityCertificate = 'pl.rfqs.evidenceType.qualityCertificate';
const forcedLabourAttestation = 'pl.rfqs.evidenceType.forcedLabourAttestation';

/** A stable, random-looking SHA-256 stand-in; no real file has this hash. */
function fixtureHash(seed: number): string {
  let state = seed;
  let hash = '';
  while (hash.length < 64) {
    state = (state * 48271) % 2147483647;
    hash += (state % 16).toString(16);
  }
  return hash;
}

function evidence(serial: number, status: 'valid' | 'expiring' | 'expired', expiresOn: string): EvidenceDocument[] {
  return [
    {
      documentId: fixtureId(serial),
      typeLabel: qualityCertificate,
      status,
      expiresOn,
      contentHash: fixtureHash(serial),
    },
    {
      documentId: fixtureId(serial + 1),
      typeLabel: forcedLabourAttestation,
      status: 'valid',
      expiresOn: '2027-03-31',
      contentHash: fixtureHash(serial + 1),
    },
  ];
}

function decision(
  part: PartSpec,
  winner: SupplierKey | null,
  total: number | null,
  details: {
    lowest?: boolean;
    buyerRecorded?: boolean;
    justification?: string;
    evidence?: EvidenceDocument[];
    deviation?: ApprovalDecisionDeviation;
  } = {},
) {
  return {
    ...partFields(part),
    decision: winner === null ? ('noAward' as const) : ('award' as const),
    supplier: winner === null ? null : suppliers[winner],
    normalisedTotal: total === null ? null : money(total, tenantCurrency),
    lowest: details.lowest ?? false,
    buyerRecorded: details.buyerRecorded ?? false,
    justification: details.justification ?? null,
    evidence: details.evidence ?? [],
    deviation: details.deviation ?? null,
  };
}

interface ApprovalDecisionDeviation {
  readonly deviationId: string;
  readonly typeLabel: string;
  readonly reason: string;
  readonly recordedBy: string;
  readonly expiresOn: string;
}

function passed(
  check: 'linesDecided' | 'justifications' | 'evidence' | 'approvedSupplierList' | 'approverIndependent',
) {
  const params: Record<string, string | number> =
    check === 'approvedSupplierList' ? { asOf: '2026-09-27 06:00 UTC' } : {};
  return { check, passed: true, message: `pl.rfqs.gate.${check}.passed`, params };
}

const approvals: Readonly<Record<string, ApprovalOutput>> = {
  [fixtureRfqIds.blockedApproval]: {
    availability: 'submitted',
    rfqId: fixtureRfqIds.blockedApproval,
    reference: 'RFQ-1031-R2',
    title: 'Drive shafts and cover plates, re-bid',
    status: 'pendingApproval',
    awardVersion: 1,
    submittedBy: 'Dana Whitfield',
    submittedAt: '2026-09-23T15:20:00Z',
    gate: {
      checkedAt: '2026-09-27T08:00:00Z',
      passed: false,
      checks: [
        passed('linesDecided'),
        passed('justifications'),
        {
          check: 'evidence',
          passed: false,
          message: 'pl.rfqs.gate.evidence.certificateExpired',
          params: { supplier: 'Kestrel Machining', document: 'QC-4471', expiredOn: '2026-09-24' },
        },
        passed('approvedSupplierList'),
        passed('approverIndependent'),
      ],
    },
    decisions: [
      decision(at(blockedParts, 0), 'northwind', 11150, {
        lowest: true,
        evidence: evidence(6001, 'valid', '2027-05-31'),
      }),
      decision(at(blockedParts, 1), 'kestrel', 4175, {
        justification: 'The lowest quote has a 16-week lead time, which misses the line date by six weeks.',
        evidence: evidence(6011, 'expired', '2026-09-24'),
      }),
      decision(at(blockedParts, 2), null, null),
    ],
    awardedTotal: money(15325, tenantCurrency),
    exchangeRates: [...exchangeRates],
    previousRound: {
      rfqId: fixtureId(1030),
      reference: 'RFQ-1031',
      closedAt: '2026-08-28T16:00:00Z',
      suppliersInvited: 3,
      quotesReceived: 1,
      rebidReason:
        'Only one quote arrived before the drawing revision changed; the lines were re-issued at revision B.',
    },
    allowedTransitions: ['reject'],
    blockingReasons: [{ transition: 'approve', message: 'pl.rfqs.blocked.gateFailed', params: { count: 1 } }],
  },
  [fixtureRfqIds.readyApproval]: {
    availability: 'submitted',
    rfqId: fixtureRfqIds.readyApproval,
    reference: 'RFQ-1027',
    title: 'Fastener kits and gasket sets',
    status: 'pendingApproval',
    awardVersion: 2,
    submittedBy: 'Dana Whitfield',
    submittedAt: '2026-09-24T10:05:00Z',
    gate: {
      checkedAt: '2026-09-27T08:00:00Z',
      passed: true,
      checks: [
        passed('linesDecided'),
        passed('justifications'),
        passed('evidence'),
        passed('approvedSupplierList'),
        passed('approverIndependent'),
      ],
    },
    decisions: [
      decision(at(readyParts, 0), 'birchfield', 7100, {
        lowest: true,
        evidence: evidence(6021, 'expiring', '2026-11-15'),
      }),
      decision(at(readyParts, 1), 'arbor', 2200, {
        justification: 'The lowest quote ships in ten weeks; this line is needed for the November build.',
        evidence: [
          ...evidence(6031, 'valid', '2027-02-28').slice(0, 1),
          {
            documentId: fixtureId(6032),
            typeLabel: forcedLabourAttestation,
            status: 'coveredByDeviation',
            expiresOn: null,
            contentHash: null,
          },
        ],
        deviation: {
          deviationId: fixtureId(7001),
          typeLabel: forcedLabourAttestation,
          reason: 'The supplier has signed its attestation for next year; the countersigned copy is due in October.',
          recordedBy: 'Rafael Okonkwo',
          expiresOn: '2026-11-30',
        },
      }),
      decision(at(readyParts, 2), 'northwind', 10800, {
        lowest: true,
        buyerRecorded: true,
        evidence: evidence(6041, 'valid', '2027-05-31'),
      }),
    ],
    awardedTotal: money(20100, tenantCurrency),
    exchangeRates: [...exchangeRates],
    previousRound: null,
    allowedTransitions: ['approve', 'reject'],
    blockingReasons: [],
  },
};

function noAwardSubmitted(detail: DetailOutput): ApprovalOutput {
  return {
    availability: 'noAwardSubmitted',
    rfqId: detail.rfqId,
    reference: detail.reference,
    title: detail.title,
    status: detail.status,
  };
}

function scenarioResponse<Output>(
  rfqId: string,
  outputs: Readonly<Record<string, Output>>,
  fallback?: (detail: DetailOutput) => Output,
): FixtureResponse<Output> {
  if (rfqId === fixtureRfqIds.forbidden) {
    return { kind: 'refused', code: errorCode('Forbidden', 'notPermitted') };
  }
  if (rfqId === fixtureRfqIds.unavailable) {
    return { kind: 'unavailable' };
  }
  if (rfqId === fixtureRfqIds.slow) {
    return { kind: 'pending' };
  }
  const output = outputs[rfqId];
  if (output !== undefined) {
    return { kind: 'output', output };
  }
  const detail = details[rfqId];
  if (detail !== undefined && fallback !== undefined) {
    return { kind: 'output', output: fallback(detail) };
  }
  return { kind: 'refused', code: errorCode('NotFound', 'resource') };
}

export const rfqFixtureHandlers: readonly FixtureHandler[] = [
  fixtureQuery(rfqDetailQuery, ({ rfqId }) => scenarioResponse(rfqId, details)),
  fixtureQuery(quoteComparisonQuery, ({ rfqId }) => scenarioResponse(rfqId, comparisons)),
  fixtureQuery(approvalPacketQuery, ({ rfqId }) => scenarioResponse(rfqId, approvals, noAwardSubmitted)),
];

/** Every fixture output, for schema tests. */
export const rfqFixtureOutputs = {
  details: Object.values(details),
  comparisons: Object.values(comparisons),
  approvals: [...Object.values(approvals), ...Object.values(details).map(noAwardSubmitted)],
};
