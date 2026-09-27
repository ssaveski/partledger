import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler, type FixtureResponse } from '../client/fixture-adapter';
import { errorCode } from '../errors';
import {
  portalEvidenceRequestsQuery,
  portalOutcomeQuery,
  portalResponseQuery,
  portalSessionQuery,
  portalSubmissionQuery,
  type PortalView,
} from '../portal/queries';

/**
 * Synthetic supplier links for the portal screens: invented buyer, suppliers, parts and people.
 * Each RFQ holds every line and every supplier's answer, as the database does; the handlers
 * project them onto the session's supplier the way the portal role's policy will (KTD15), so the
 * screens only ever receive that supplier's own lines.
 */

type SessionOutput = z.input<typeof portalSessionQuery.output>;
type ResponseOutput = z.input<typeof portalResponseQuery.output>;
type SubmissionOutput = z.input<typeof portalSubmissionQuery.output>;
type OutcomeOutput = z.input<typeof portalOutcomeQuery.output>;
type EvidenceOutput = z.input<typeof portalEvidenceRequestsQuery.output>;
type Answer = NonNullable<ResponseOutput['lines'][number]['draft']>;
type QuoteAnswer = Extract<Answer, { kind: 'quote' }>;

function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

/** An obviously synthetic secret in the real shape: 43 base64url characters. */
function fixtureSecret(label: string): string {
  return `fixture-${label}-`.padEnd(43, 'x');
}

export const portalFixtureScenarios = [
  'open',
  'closed',
  'sealed',
  'evidence',
  'expired',
  'revoked',
  'slow',
  'unavailable',
] as const;

export type PortalFixtureScenario = (typeof portalFixtureScenarios)[number];

type LinkStatus = 'active' | 'expired' | 'revoked';

interface FixtureLink {
  readonly scenario: PortalFixtureScenario;
  readonly linkId: string;
  readonly secret: string;
  readonly status: LinkStatus;
}

const linkStatuses: Readonly<Record<PortalFixtureScenario, LinkStatus>> = {
  open: 'active',
  closed: 'active',
  sealed: 'active',
  evidence: 'active',
  expired: 'expired',
  revoked: 'revoked',
  slow: 'active',
  unavailable: 'active',
};

const links: readonly FixtureLink[] = portalFixtureScenarios.map((scenario, index) => ({
  scenario,
  linkId: fixtureId(7001 + index),
  secret: fixtureSecret(scenario),
  status: linkStatuses[scenario],
}));

function linkOf(scenario: PortalFixtureScenario): { linkId: string; secret: string } {
  const link = links.find((candidate) => candidate.scenario === scenario);
  if (link === undefined) {
    throw new Error(`No fixture link for ${scenario}`);
  }
  return { linkId: link.linkId, secret: link.secret };
}

/** The id and secret of each fixture link, so a reviewer can open `/link/<id>#<secret>`. */
export const portalFixtureLinks = {
  open: linkOf('open'),
  closed: linkOf('closed'),
  sealed: linkOf('sealed'),
  evidence: linkOf('evidence'),
  expired: linkOf('expired'),
  revoked: linkOf('revoked'),
  slow: linkOf('slow'),
  unavailable: linkOf('unavailable'),
} as const satisfies Readonly<Record<PortalFixtureScenario, { linkId: string; secret: string }>>;

/**
 * Stands in for the exchange U17 adds: a wrong secret, an expired link and a revoked link are
 * refused alike, as the API's one uniform 401 will be.
 */
export function exchangeFixtureLink(linkId: string, secret: string): boolean {
  const link = links.find((candidate) => candidate.linkId === linkId);
  return link !== undefined && link.secret === secret && link.status === 'active';
}

// ---------------------------------------------------------------------------------------------
// Organisations and RFQs

const buyerName = 'Harbourline Industries';

const supplierNames = { birchfield: 'Birchfield Precision', kestrel: 'Kestrel Machining' } as const;

type SupplierKey = keyof typeof supplierNames;

/** Every fixture link belongs to this supplier; Kestrel's lines and answers must never reach it. */
const sessionSupplier: SupplierKey = 'birchfield';

interface FixtureLine {
  readonly serial: number;
  readonly lineNumber: number;
  readonly partNumber: string;
  readonly revision: string;
  readonly description: string;
  readonly quantity: number;
  readonly requiredBy: string;
  readonly quantityBreaks: readonly number[];
  readonly assigned: readonly SupplierKey[];
  /** Set when the line changed after the suppliers' last submissions. */
  readonly changed?: { readonly version: number; readonly changedAt: string };
  readonly drafts?: Partial<Record<SupplierKey, Answer>>;
  readonly submitted?: Partial<Record<SupplierKey, Answer>>;
  readonly winner?: SupplierKey | null;
}

function lineFields(line: FixtureLine) {
  return {
    lineId: fixtureId(line.serial),
    lineNumber: line.lineNumber,
    partNumber: line.partNumber,
    revision: line.revision,
    description: line.description,
    quantity: line.quantity,
    unit: 'each' as const,
  };
}

function quote(
  currency: string,
  prices: readonly (readonly [number, string])[],
  extra: Partial<Omit<QuoteAnswer, 'kind' | 'currency' | 'priceBreaks'>> = {},
): QuoteAnswer {
  return {
    kind: 'quote',
    currency,
    priceBreaks: prices.map(([quantity, unitPrice]) => ({ quantity, unitPrice })),
    leadTimeDays: 35,
    minimumOrderQuantity: 100,
    oneOffCosts: '0.00',
    validUntil: '2026-12-31',
    ...extra,
  };
}

const openLines: readonly FixtureLine[] = [
  {
    serial: 8101,
    lineNumber: 1,
    partNumber: 'PN-10432',
    revision: 'C',
    description: 'Pump housing, cast aluminium',
    quantity: 200,
    requiredBy: '2026-12-04',
    quantityBreaks: [200, 500],
    assigned: ['birchfield', 'kestrel'],
    drafts: {
      birchfield: quote(
        'CAD',
        [
          [200, '52.40'],
          [500, '48.90'],
        ],
        { oneOffCosts: '1250.00' },
      ),
      kestrel: quote('CAD', [
        [200, '49.10'],
        [500, '45.00'],
      ]),
    },
  },
  {
    serial: 8102,
    lineNumber: 2,
    partNumber: 'PN-10433',
    revision: 'A',
    description: 'Cover plate, machined',
    quantity: 500,
    requiredBy: '2026-12-04',
    quantityBreaks: [500],
    assigned: ['kestrel'],
    drafts: { kestrel: quote('USD', [[500, '8.25']]) },
  },
  {
    serial: 8103,
    lineNumber: 3,
    partNumber: 'PN-20877',
    revision: 'B',
    description: 'Drive shaft, stainless steel, tolerance revised in version 2',
    quantity: 120,
    requiredBy: '2027-01-15',
    quantityBreaks: [120, 250],
    assigned: ['birchfield', 'kestrel'],
    changed: { version: 2, changedAt: '2026-09-24T14:30:00Z' },
    drafts: {
      birchfield: quote(
        'CAD',
        [
          [120, '88.00'],
          [250, '81.50'],
        ],
        { leadTimeDays: 42 },
      ),
    },
    submitted: {
      birchfield: quote(
        'CAD',
        [
          [120, '88.00'],
          [250, '81.50'],
        ],
        { leadTimeDays: 42 },
      ),
    },
  },
  {
    serial: 8104,
    lineNumber: 4,
    partNumber: 'PN-31005',
    revision: 'D',
    description: 'Fastener kit, 48 pieces',
    quantity: 2000,
    requiredBy: '2026-11-20',
    quantityBreaks: [2000, 5000],
    assigned: ['birchfield'],
  },
  {
    serial: 8105,
    lineNumber: 5,
    partNumber: 'PN-31006',
    revision: 'A',
    description: 'Gasket set, nitrile',
    quantity: 1000,
    requiredBy: '2026-11-20',
    quantityBreaks: [1000],
    assigned: ['kestrel'],
  },
];

const closedLines: readonly FixtureLine[] = [
  {
    serial: 8201,
    lineNumber: 1,
    partNumber: 'PN-40210',
    revision: 'A',
    description: 'Hydraulic elbow fitting, 90 degrees',
    quantity: 800,
    requiredBy: '2026-11-02',
    quantityBreaks: [800],
    assigned: ['birchfield', 'kestrel'],
    submitted: {
      birchfield: quote('CAD', [[800, '6.85']], { leadTimeDays: 21, minimumOrderQuantity: 500 }),
      kestrel: quote('CAD', [[800, '6.20']]),
    },
  },
  {
    serial: 8202,
    lineNumber: 2,
    partNumber: 'PN-40211',
    revision: 'B',
    description: 'Hydraulic tee fitting',
    quantity: 400,
    requiredBy: '2026-11-02',
    quantityBreaks: [400],
    assigned: ['birchfield'],
    submitted: {
      birchfield: { kind: 'noQuote', reason: 'capacity', note: 'Our forging line is fully booked until January.' },
    },
  },
  {
    serial: 8203,
    lineNumber: 3,
    partNumber: 'PN-40212',
    revision: 'A',
    description: 'Pressure relief valve body',
    quantity: 150,
    requiredBy: '2026-12-10',
    quantityBreaks: [150],
    assigned: ['kestrel'],
    submitted: { kestrel: quote('EUR', [[150, '31.00']]) },
  },
  {
    serial: 8204,
    lineNumber: 4,
    partNumber: 'PN-40213',
    revision: 'C',
    description: 'Manifold block, anodised',
    quantity: 60,
    requiredBy: '2026-12-10',
    quantityBreaks: [60, 120],
    assigned: ['birchfield', 'kestrel'],
    submitted: {
      birchfield: {
        kind: 'alternate',
        specification: 'PN-40213-H, hard-anodised finish to the same drawing',
        currency: 'USD',
        priceBreaks: [
          { quantity: 60, unitPrice: '142.00' },
          { quantity: 120, unitPrice: '131.50' },
        ],
        leadTimeDays: 49,
        minimumOrderQuantity: 60,
        oneOffCosts: '2400.00',
        validUntil: '2027-01-31',
      },
      kestrel: quote('CAD', [
        [60, '188.00'],
        [120, '176.00'],
      ]),
    },
  },
];

const sealedLines: readonly FixtureLine[] = [
  {
    serial: 8301,
    lineNumber: 1,
    partNumber: 'PN-55120',
    revision: 'B',
    description: 'Gearbox housing, left',
    quantity: 40,
    requiredBy: '2026-10-30',
    quantityBreaks: [40],
    assigned: ['birchfield', 'kestrel'],
    submitted: { birchfield: quote('CAD', [[40, '410.00']]), kestrel: quote('CAD', [[40, '395.00']]) },
    winner: 'kestrel',
  },
  {
    serial: 8302,
    lineNumber: 2,
    partNumber: 'PN-55121',
    revision: 'B',
    description: 'Gearbox housing, right',
    quantity: 40,
    requiredBy: '2026-10-30',
    quantityBreaks: [40],
    assigned: ['birchfield', 'kestrel'],
    submitted: { birchfield: quote('CAD', [[40, '405.00']]), kestrel: quote('CAD', [[40, '415.00']]) },
    winner: 'birchfield',
  },
  {
    serial: 8303,
    lineNumber: 3,
    partNumber: 'PN-55122',
    revision: 'A',
    description: 'Input shaft seal carrier',
    quantity: 80,
    requiredBy: '2026-11-12',
    quantityBreaks: [80],
    assigned: ['kestrel'],
    submitted: { kestrel: quote('CAD', [[80, '64.00']]) },
    winner: 'kestrel',
  },
  {
    serial: 8304,
    lineNumber: 4,
    partNumber: 'PN-55123',
    revision: 'A',
    description: 'Output flange',
    quantity: 80,
    requiredBy: '2026-11-12',
    quantityBreaks: [80],
    assigned: ['kestrel'],
    submitted: { kestrel: quote('CAD', [[80, '72.50']]) },
    winner: 'kestrel',
  },
  {
    serial: 8305,
    lineNumber: 5,
    partNumber: 'PN-55124',
    revision: 'C',
    description: 'Breather cap assembly',
    quantity: 80,
    requiredBy: '2026-11-12',
    quantityBreaks: [80],
    assigned: ['birchfield'],
    submitted: { birchfield: quote('CAD', [[80, '18.40']]) },
    winner: null,
  },
];

interface FixtureRfq {
  readonly reference: string;
  readonly title: string;
  readonly state: 'open' | 'closed' | 'sealed';
  readonly version: number;
  readonly deadline: string;
  readonly currency: string;
  readonly lines: readonly FixtureLine[];
  readonly draftSavedAt: string | null;
  readonly submission: {
    readonly version: number;
    readonly rfqVersion: number;
    readonly submittedAt: string;
    readonly declaredName: string;
  } | null;
  readonly sealedAt: string | null;
}

const rfqs = {
  open: {
    reference: 'RFQ-1060',
    title: 'Pump assembly components, winter build',
    state: 'open',
    version: 2,
    deadline: '2026-10-15T17:00:00Z',
    currency: 'CAD',
    lines: openLines,
    draftSavedAt: '2026-09-25T13:05:00Z',
    submission: { version: 1, rfqVersion: 1, submittedAt: '2026-09-20T15:12:00Z', declaredName: 'Morgan Ellery' },
    sealedAt: null,
  },
  closed: {
    reference: 'RFQ-1055',
    title: 'Hydraulic fittings, fourth quarter',
    state: 'closed',
    version: 1,
    deadline: '2026-09-18T20:00:00Z',
    currency: 'CAD',
    lines: closedLines,
    draftSavedAt: '2026-09-18T19:31:00Z',
    submission: { version: 2, rfqVersion: 1, submittedAt: '2026-09-18T19:40:12Z', declaredName: 'Morgan Ellery' },
    sealedAt: null,
  },
  sealed: {
    reference: 'RFQ-1047',
    title: 'Gearbox housings and seals',
    state: 'sealed',
    version: 1,
    deadline: '2026-08-28T16:00:00Z',
    currency: 'CAD',
    lines: sealedLines,
    draftSavedAt: '2026-08-27T21:10:00Z',
    submission: { version: 1, rfqVersion: 1, submittedAt: '2026-08-27T21:14:40Z', declaredName: 'Priya Castell' },
    sealedAt: '2026-09-12T15:02:00Z',
  },
} as const satisfies Readonly<Record<string, FixtureRfq>>;

const rfqOfScenario: Readonly<Record<PortalFixtureScenario, FixtureRfq | null>> = {
  open: rfqs.open,
  closed: rfqs.closed,
  sealed: rfqs.sealed,
  evidence: null,
  expired: rfqs.open,
  revoked: rfqs.open,
  slow: rfqs.open,
  unavailable: rfqs.open,
};

const timeZone = 'America/Toronto';

// ---------------------------------------------------------------------------------------------
// Projections onto the session's supplier

function ownLines(rfq: FixtureRfq, supplier: SupplierKey): FixtureLine[] {
  return rfq.lines.filter((line) => line.assigned.includes(supplier));
}

/** What the link opens now follows the RFQ state (R17). */
function viewsOf(rfq: FixtureRfq | null): [PortalView, ...PortalView[]] {
  if (rfq === null) {
    return ['evidence'];
  }
  const withSubmission = rfq.submission === null ? [] : (['submission'] as const);
  switch (rfq.state) {
    case 'open':
      return ['respond', ...withSubmission];
    case 'closed':
      return ['submission'];
    case 'sealed':
      return ['outcome', ...withSubmission];
  }
}

function sessionOf(rfq: FixtureRfq | null): SessionOutput {
  return {
    scope: rfq === null ? 'evidence_request' : 'rfq_response',
    supplierName: supplierNames[sessionSupplier],
    buyerName,
    rfq: rfq === null ? null : { reference: rfq.reference, title: rfq.title, state: rfq.state },
    views: viewsOf(rfq),
    timeZone,
    expiresAt: rfq === null ? '2026-10-31T23:59:59Z' : rfq.state === 'open' ? rfq.deadline : '2026-12-31T23:59:59Z',
  };
}

function responseOf(rfq: FixtureRfq, supplier: SupplierKey): ResponseOutput {
  return {
    reference: rfq.reference,
    title: rfq.title,
    buyerName,
    version: rfq.version,
    deadline: rfq.deadline,
    currency: rfq.currency,
    draftSavedAt: rfq.draftSavedAt,
    lastSubmittedAt: rfq.submission?.submittedAt ?? null,
    lines: ownLines(rfq, supplier).map((line) => ({
      ...lineFields(line),
      requiredBy: line.requiredBy,
      quantityBreaks: [...line.quantityBreaks],
      changed: line.changed === undefined || line.submitted?.[supplier] === undefined ? null : { ...line.changed },
      draft: line.drafts?.[supplier] ?? null,
    })),
    allowedTransitions: ['saveDraft', 'submit'],
    blockingReasons: [],
  };
}

function submissionOf(rfq: FixtureRfq, supplier: SupplierKey): SubmissionOutput {
  const { submission } = rfq;
  const answered = ownLines(rfq, supplier).flatMap((line) => {
    const answer = line.submitted?.[supplier];
    return answer === undefined ? [] : [{ line, answer }];
  });
  if (submission === null || answered.length === 0) {
    return { availability: 'notSubmitted', reference: rfq.reference, title: rfq.title, rfqState: rfq.state };
  }
  return {
    availability: 'submitted',
    reference: rfq.reference,
    title: rfq.title,
    rfqState: rfq.state,
    submissionVersion: submission.version,
    rfqVersion: submission.rfqVersion,
    submittedAt: submission.submittedAt,
    declaredName: submission.declaredName,
    attestedAuthority: true,
    lines: answered.map(({ line, answer }) => ({
      ...lineFields(line),
      answer,
      changedSince: line.changed !== undefined && line.changed.version > submission.rfqVersion,
    })),
  };
}

function outcomeOf(rfq: FixtureRfq, supplier: SupplierKey): OutcomeOutput | null {
  if (rfq.sealedAt === null) {
    return null;
  }
  return {
    reference: rfq.reference,
    title: rfq.title,
    sealedAt: rfq.sealedAt,
    lines: ownLines(rfq, supplier).map((line) => ({
      ...lineFields(line),
      result: line.winner === supplier ? 'awarded' : 'notAwarded',
    })),
  };
}

const evidenceRequests: EvidenceOutput = {
  buyerName,
  requests: [
    {
      requestId: fixtureId(8401),
      typeLabel: 'pl.portal.evidenceType.forcedLabourAttestation',
      status: 'rejected',
      dueBy: '2026-10-05',
      uploadedAt: '2026-09-21T18:22:00Z',
      rejectionReason: 'The attestation is not signed. Upload a signed copy.',
      validUntil: null,
    },
    {
      requestId: fixtureId(8402),
      typeLabel: 'pl.portal.evidenceType.qualityCertificate',
      status: 'requested',
      dueBy: '2026-10-10',
      uploadedAt: null,
      rejectionReason: null,
      validUntil: null,
    },
    {
      requestId: fixtureId(8403),
      typeLabel: 'pl.portal.evidenceType.materialCertificate',
      status: 'underReview',
      dueBy: '2026-10-17',
      uploadedAt: '2026-09-24T12:40:00Z',
      rejectionReason: null,
      validUntil: null,
    },
    {
      requestId: fixtureId(8404),
      typeLabel: 'pl.portal.evidenceType.insuranceCertificate',
      status: 'accepted',
      dueBy: '2026-09-30',
      uploadedAt: '2026-09-15T09:05:00Z',
      rejectionReason: null,
      validUntil: '2027-09-30',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// Handlers

const forbidden = { kind: 'refused', code: errorCode('Forbidden', 'notPermitted') } as const;

function output<Output>(value: Output): FixtureResponse<Output> {
  return { kind: 'output', output: value };
}

/** Outputs of every active scenario, for fixture tests. */
export const portalFixtureOutputs = {
  sessions: portalFixtureScenarios.map((scenario) => sessionOf(rfqOfScenario[scenario])),
  responses: [responseOf(rfqs.open, sessionSupplier)],
  submissions: [rfqs.open, rfqs.closed, rfqs.sealed].map((rfq) => submissionOf(rfq, sessionSupplier)),
  outcomes: [outcomeOf(rfqs.sealed, sessionSupplier)],
  evidence: [evidenceRequests],
  /** Every line of every fixture RFQ, including those assigned only to other suppliers. */
  allLines: [...openLines, ...closedLines, ...sealedLines].map((line) => ({
    ...lineFields(line),
    assignedToSessionSupplier: line.assigned.includes(sessionSupplier),
  })),
};

/**
 * The portal reads, served for whichever link the fixture session opened. `currentLinkId` returns
 * the link a person exchanged with Continue, or null before; without an active link every read is
 * the uniform refusal.
 */
export function portalFixtureHandlers(currentLinkId: () => string | null): readonly FixtureHandler[] {
  function activeLink(): FixtureLink | null {
    const linkId = currentLinkId();
    return links.find((link) => link.linkId === linkId && link.status === 'active') ?? null;
  }

  function screenRead<Output>(
    view: PortalView,
    read: (rfq: FixtureRfq | null) => Output | null,
  ): FixtureResponse<Output> {
    const link = activeLink();
    if (link === null) {
      return { kind: 'unauthenticated' };
    }
    if (link.scenario === 'slow') {
      return { kind: 'pending' };
    }
    if (link.scenario === 'unavailable') {
      return { kind: 'unavailable' };
    }
    const rfq = rfqOfScenario[link.scenario];
    if (!viewsOf(rfq).includes(view)) {
      return forbidden;
    }
    const value = read(rfq);
    return value === null ? forbidden : output(value);
  }

  return [
    fixtureQuery(portalSessionQuery, () => {
      const link = activeLink();
      return link === null ? { kind: 'unauthenticated' } : output(sessionOf(rfqOfScenario[link.scenario]));
    }),
    fixtureQuery(portalResponseQuery, () =>
      screenRead('respond', (rfq) => (rfq === null ? null : responseOf(rfq, sessionSupplier))),
    ),
    fixtureQuery(portalSubmissionQuery, () =>
      screenRead('submission', (rfq) => (rfq === null ? null : submissionOf(rfq, sessionSupplier))),
    ),
    fixtureQuery(portalOutcomeQuery, () =>
      screenRead('outcome', (rfq) => (rfq === null ? null : outcomeOf(rfq, sessionSupplier))),
    ),
    fixtureQuery(portalEvidenceRequestsQuery, () =>
      screenRead('evidence', (rfq) => (rfq === null ? evidenceRequests : null)),
    ),
  ];
}
