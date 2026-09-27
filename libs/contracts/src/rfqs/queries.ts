import { z } from 'zod';

import { defineQuery } from '../define';
import { errorCode, errorParamsSchema, messageKeySchema } from '../errors';
import { lifecycleRead } from '../lifecycle';
import { currencyCodeSchema, decimalSchema, moneySchema } from '../money';
import { listInputSchema, listReadErrors } from '../reads';

/**
 * The reads behind the three key screens (U3): RFQ detail, quote comparison and approval packet.
 * The API implements them in Phase D; until then the fixture adapter serves synthetic data in
 * these shapes, so wiring a screen to the API swaps the adapter and keeps the components.
 */

export const staffReaders = { person: ['buyer', 'quality_engineer', 'approver', 'auditor'] } as const;

export const readErrors = [errorCode('NotFound', 'resource'), errorCode('Forbidden', 'notPermitted')] as const;

export const rfqInputSchema = z
  .object({
    rfqId: z.uuid().describe('The RFQ to read.'),
  })
  .strict()
  .describe('Which RFQ to read.');

export const rfqStatuses = ['draft', 'published', 'closed', 'pendingApproval', 'sealed', 'cancelled'] as const;

export const rfqStatusSchema = z.enum(rfqStatuses).describe('Where the RFQ is in its lifecycle.');

export type RfqStatus = z.infer<typeof rfqStatusSchema>;

export const referenceSchema = z
  .string()
  .regex(/^RFQ-\d{4,}(-R\d+)?$/)
  .describe('The human-readable RFQ reference, with the round for a re-bid, such as RFQ-1031-R2.');

export const titleSchema = z.string().min(1).max(200).describe('The title the buyer gave the RFQ.');

export const partSchema = {
  lineNumber: z.number().int().positive().describe('The line number within the RFQ.'),
  partNumber: z.string().min(1).describe('The part number snapshotted at publish.'),
  revision: z.string().min(1).describe('The part revision snapshotted at publish.'),
  description: z.string().describe('The part description snapshotted at publish.'),
  quantity: z.number().int().positive().describe('The requested quantity.'),
  unit: z.enum(['each', 'kilogram', 'metre']).describe('The unit the quantity is counted in.'),
};

// ---------------------------------------------------------------------------------------------
// RFQ detail

export const rfqTransitions = ['publish', 'amend', 'extendDeadline', 'close', 'cancel'] as const;

export const responseStatuses = ['responded', 'notYet'] as const;

/**
 * Until the RFQ closes, staff see whether each supplier has responded and nothing of what it
 * answered (R40, Q10), so this shape has no field that could carry an answer.
 */
export const supplierResponseStatusSchema = z
  .object({
    supplierId: z.uuid().describe('The invited supplier.'),
    name: z.string().min(1).describe('The supplier organisation name.'),
    linesAssigned: z.number().int().nonnegative().describe('How many lines the supplier was invited to quote.'),
    response: z.enum(responseStatuses).describe('Whether the supplier has submitted a response.'),
    respondedAt: z.iso.datetime().nullable().describe('When the supplier last submitted, or null.'),
  })
  .strict()
  .describe('One invited supplier and whether it has responded; never its answers.');

export type SupplierResponseStatus = z.infer<typeof supplierResponseStatusSchema>;

export const driftFields = ['revision', 'description', 'unit'] as const;

export const partDriftSchema = z
  .object({
    detectedAt: z.iso.datetime().describe('When an import first changed the part after publish.'),
    changes: z
      .array(
        z
          .object({
            field: z.enum(driftFields).describe('The part field that changed.'),
            snapshot: z.string().describe('The value the line snapshotted at publish.'),
            current: z.string().describe('The value the part has now.'),
          })
          .strict(),
      )
      .min(1)
      .describe('Each field that differs from the snapshot.'),
  })
  .strict()
  .describe('How the part changed since the line was published; the snapshot itself never changes (R8).');

export type PartDrift = z.infer<typeof partDriftSchema>;

export const quantityBreaksSchema = z
  .array(z.number().int().positive())
  .max(6)
  .describe('Further quantities suppliers price, ascending; the requested quantity is always priced.');

export const rfqDetailLineSchema = z
  .object({
    lineId: z.uuid().describe('The RFQ line.'),
    ...partSchema,
    quantityBreaks: quantityBreaksSchema,
    requiredBy: z.iso.date().describe('The date the parts are needed by.'),
    drift: partDriftSchema.nullable().describe('How the part changed since publish, on an open line, or null.'),
  })
  .strict()
  .describe('One line of the RFQ.');

export type RfqDetailLine = z.infer<typeof rfqDetailLineSchema>;

export const rfqDetailSchema = lifecycleRead(
  z
    .object({
      rfqId: z.uuid().describe('The RFQ.'),
      reference: referenceSchema,
      title: titleSchema,
      status: rfqStatusSchema,
      version: z.number().int().positive().describe('The published version; amendments add one.'),
      deadline: z.iso.datetime().describe('The response deadline in UTC.'),
      currency: currencyCodeSchema.describe('The tenant currency that quotes are normalised to.'),
      round: z.number().int().positive().describe('1 for a first round; a re-bid is the next round.'),
      lines: z.array(rfqDetailLineSchema).describe('The lines, in line-number order.'),
      suppliers: z.array(supplierResponseStatusSchema).describe('The invited suppliers and their response status.'),
    })
    .strict(),
  rfqTransitions,
).describe('An RFQ with the response status of each invited supplier.');

export type RfqDetail = z.infer<typeof rfqDetailSchema>;

export const rfqDetailQuery = defineQuery({
  name: 'rfqs.detail',
  description: 'Read an RFQ, its lines and whether each invited supplier has responded, never the answers.',
  input: rfqInputSchema,
  output: rfqDetailSchema,
  errors: readErrors,
  access: staffReaders,
});

// ---------------------------------------------------------------------------------------------
// RFQ list

export const rfqListRowSchema = z
  .object({
    rfqId: z.uuid().describe('The RFQ.'),
    reference: referenceSchema,
    title: titleSchema,
    status: rfqStatusSchema,
    deadline: z.iso.datetime().describe('The response deadline in UTC.'),
    round: z.number().int().positive().describe('1 for a first round; a re-bid is the next round.'),
    lineCount: z.number().int().nonnegative().describe('How many lines the RFQ has.'),
    invitedCount: z.number().int().nonnegative().describe('How many suppliers are invited.'),
    respondedCount: z
      .number()
      .int()
      .nonnegative()
      .describe('How many invited suppliers have responded; never what they answered (R40).'),
    driftedLineCount: z
      .number()
      .int()
      .nonnegative()
      .describe('How many open lines have a part that changed since publish (R8).'),
  })
  .strict()
  .describe('One RFQ in the list.');

export type RfqListRow = z.infer<typeof rfqListRowSchema>;

export const rfqListSchema = z
  .object({
    rfqs: z.array(rfqListRowSchema).describe('Every RFQ the reader may see, newest reference first.'),
  })
  .strict()
  .describe('The tenant RFQs.');

export type RfqList = z.infer<typeof rfqListSchema>;

export const rfqListQuery = defineQuery({
  name: 'rfqs.list',
  description: 'List the tenant RFQs with their status, deadline, response counts and drifted lines.',
  input: listInputSchema,
  output: rfqListSchema,
  errors: listReadErrors,
  access: staffReaders,
});

// ---------------------------------------------------------------------------------------------
// Quote comparison

/** The seven states a comparison cell can show; each has one legend entry and one accessible name. */
export const comparisonCellStates = [
  'bestPrice',
  'submitted',
  'alternate',
  'noQuote',
  'pending',
  'stale',
  'late',
] as const;

export const comparisonCellStateSchema = z
  .enum(comparisonCellStates)
  .describe(
    'bestPrice: the lowest normalised total on the line; submitted: a quote; alternate: a quote for an alternate part; noQuote: declined with a reason; pending: no response; stale: answered an earlier version of a changed line; late: attempted after the deadline and refused.',
  );

export type ComparisonCellState = z.infer<typeof comparisonCellStateSchema>;

/** States whose cell carries a quote. */
export const quotedCellStates: readonly ComparisonCellState[] = ['bestPrice', 'submitted', 'alternate', 'stale'];

export const quoteSchema = z
  .object({
    quoteId: z.uuid().describe('The quote.'),
    unitPrice: moneySchema.describe('The unit price at the applicable quantity break, in the quote currency.'),
    oneOffCosts: moneySchema.describe('Tooling and other one-off costs, in the quote currency.'),
    minimumOrderQuantity: z.number().int().positive().describe('The supplier minimum order quantity.'),
    leadTimeDays: z.number().int().nonnegative().describe('The quoted lead time in days.'),
    validUntil: z.iso.date().describe('The last day the quote is valid.'),
    normalisedTotal: moneySchema.describe(
      'Unit price times the requested quantity raised to the minimum order quantity, plus one-off costs, converted to the tenant currency at the captured rate (R21).',
    ),
    buyerRecorded: z
      .boolean()
      .describe('True when a buyer recorded a quote the supplier sent outside the portal (R42).'),
  })
  .strict()
  .describe('A quote as normalised for comparison.');

export type Quote = z.infer<typeof quoteSchema>;

export const alternateOfferSchema = z
  .object({
    partNumber: z.string().min(1).describe('The alternate part the supplier offers.'),
    acceptedByQuality: z
      .boolean()
      .describe('Whether a quality engineer accepted the alternate; only an accepted alternate can win (R22).'),
  })
  .strict()
  .describe('An alternate part offered instead of the requested one.');

export const comparisonCellSchema = z
  .object({
    supplierId: z.uuid().describe('The supplier column this cell belongs to.'),
    state: comparisonCellStateSchema,
    quote: quoteSchema.nullable().describe('The quote, for the states that carry one.'),
    alternate: alternateOfferSchema.nullable().describe('The alternate offered, for an alternate cell.'),
    noQuoteReason: z.string().nullable().describe('The reason the supplier gave for not quoting.'),
  })
  .strict()
  .superRefine((cell, context) => {
    if ((cell.quote !== null) !== quotedCellStates.includes(cell.state)) {
      context.addIssue({ code: 'custom', path: ['quote'], message: 'quote must match the cell state' });
    }
    if ((cell.alternate !== null) !== (cell.state === 'alternate')) {
      context.addIssue({ code: 'custom', path: ['alternate'], message: 'alternate must match the cell state' });
    }
  })
  .describe('What one supplier answered on one line; a supplier not invited to the line has no cell.');

export type ComparisonCell = z.infer<typeof comparisonCellSchema>;

export const comparisonLineSchema = z
  .object({
    lineId: z.uuid().describe('The RFQ line.'),
    ...partSchema,
    lowestSupplierId: z
      .uuid()
      .nullable()
      .describe('The supplier with the lowest normalised total, highlighted and never preselected (R21).'),
    cells: z.array(comparisonCellSchema).describe('One cell per supplier invited to the line.'),
  })
  .strict()
  // The highlighted cell and the named lowest supplier are one fact, so they can never disagree.
  .superRefine((line, context) => {
    const best = line.cells.filter((cell) => cell.state === 'bestPrice');
    const consistent =
      line.lowestSupplierId === null
        ? best.length === 0
        : best.length === 1 && best[0]?.supplierId === line.lowestSupplierId;
    if (!consistent) {
      context.addIssue({
        code: 'custom',
        path: ['lowestSupplierId'],
        message: 'exactly the lowest supplier cell is bestPrice',
      });
    }
  })
  .describe('One RFQ line with every invited supplier answer.');

export type ComparisonLine = z.infer<typeof comparisonLineSchema>;

export const supplierEvidenceStatuses = ['valid', 'expiring', 'invalid', 'deviation'] as const;

export const supplierEvidenceStatusSchema = z
  .enum(supplierEvidenceStatuses)
  .describe(
    'valid: all required evidence valid; expiring: valid but expiring within 60 days; invalid: missing, expired or rejected; deviation: an active deviation covers the gap (R41).',
  );

export type SupplierEvidenceStatus = z.infer<typeof supplierEvidenceStatusSchema>;

export const comparisonSupplierSchema = z
  .object({
    supplierId: z.uuid().describe('The supplier.'),
    name: z.string().min(1).describe('The supplier organisation name.'),
    evidence: supplierEvidenceStatusSchema,
  })
  .strict()
  .describe('A supplier column of the comparison.');

export type ComparisonSupplier = z.infer<typeof comparisonSupplierSchema>;

export const exchangeRateSchema = z
  .object({
    currency: currencyCodeSchema.describe('The quote currency converted from.'),
    rate: decimalSchema.describe('Tenant-currency units per one unit of the quote currency.'),
    capturedOn: z.iso.date().describe('The reference date of the rate.'),
    source: z.enum(['centralBank', 'manual']).describe('A central-bank reference rate or a buyer override (KTD39).'),
  })
  .strict()
  .describe('An exchange rate captured for the comparison.');

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

export const awardDraftTransitions = ['recordOutsideQuote', 'submitAward'] as const;

export const quoteComparisonSchema = lifecycleRead(
  z
    .object({
      availability: z.literal('available').describe('The RFQ has closed, so its answers can be compared.'),
      rfqId: z.uuid().describe('The RFQ.'),
      reference: referenceSchema,
      title: titleSchema,
      status: rfqStatusSchema,
      version: z.number().int().positive().describe('The RFQ version the answers belong to.'),
      deadline: z.iso
        .datetime()
        .describe('The response deadline in UTC; quotes received outside the portal count only up to it (R42).'),
      closedAt: z.iso
        .datetime()
        .describe('When the RFQ closed: before the deadline on an early close, after it with grace.'),
      currency: currencyCodeSchema.describe('The tenant currency every total is normalised to.'),
      exchangeRates: z.array(exchangeRateSchema).describe('The rates used to normalise quotes in other currencies.'),
      suppliers: z.array(comparisonSupplierSchema).describe('The supplier columns, in invitation order.'),
      lines: z.array(comparisonLineSchema).describe('The line rows, in line-number order.'),
    })
    .strict(),
  awardDraftTransitions,
);

export type QuoteComparison = z.infer<typeof quoteComparisonSchema>;

export const comparisonNotYetClosedSchema = z
  .object({
    availability: z.literal('notYetClosed').describe('The RFQ is still open, so no answer can be shown (R40).'),
    rfqId: z.uuid().describe('The RFQ.'),
    reference: referenceSchema,
    title: titleSchema,
    deadline: z.iso.datetime().describe('The response deadline in UTC.'),
  })
  .strict();

export const comparisonReadSchema = z
  .discriminatedUnion('availability', [quoteComparisonSchema, comparisonNotYetClosedSchema])
  .describe('The quote comparison of a closed RFQ, or why it is not available yet.');

export type ComparisonRead = z.infer<typeof comparisonReadSchema>;

export const quoteComparisonQuery = defineQuery({
  name: 'rfqs.comparison',
  description:
    'Compare the quotes of a closed RFQ: lines by suppliers, each cell with its state and normalised total, and an evidence status per supplier.',
  input: rfqInputSchema,
  output: comparisonReadSchema,
  errors: readErrors,
  access: staffReaders,
});

// ---------------------------------------------------------------------------------------------
// Approval packet

export const approvalTransitions = ['approve', 'reject'] as const;

export const gateCheckIds = [
  'linesDecided',
  'justifications',
  'evidence',
  'approvedSupplierList',
  'approverIndependent',
] as const;

export const gateCheckSchema = z
  .object({
    check: z.enum(gateCheckIds).describe('Which gate condition this is (R23, R24).'),
    passed: z.boolean().describe('Whether the condition holds at the time of the check.'),
    message: messageKeySchema,
    params: errorParamsSchema,
  })
  .strict()
  .describe('One condition of the approval gate and its outcome, as a message key.');

export type GateCheck = z.infer<typeof gateCheckSchema>;

export const winnerEvidenceStatuses = ['valid', 'expiring', 'expired', 'missing', 'coveredByDeviation'] as const;

export const evidenceDocumentSchema = z
  .object({
    documentId: z.uuid().describe('The evidence document.'),
    typeLabel: messageKeySchema.describe('The message key naming the pack evidence type.'),
    status: z.enum(winnerEvidenceStatuses).describe('The document status at the time of the gate check.'),
    expiresOn: z.iso.date().nullable().describe('The last day the document is valid, or null.'),
    contentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
      .describe('SHA-256 of the file the seal will record, or null when no document exists.'),
  })
  .strict()
  .describe('One required evidence document of a winning supplier.');

export const deviationSchema = z
  .object({
    deviationId: z.uuid().describe('The deviation.'),
    typeLabel: messageKeySchema.describe('The message key naming the evidence type the deviation covers.'),
    reason: z.string().min(1).describe('Why the quality engineer accepted the gap.'),
    recordedBy: z.string().min(1).describe('The quality engineer who recorded it.'),
    expiresOn: z.iso.date().describe('The last day the deviation is active.'),
  })
  .strict()
  .describe('An active deviation covering a missing or invalid evidence type (R41).');

export type Deviation = z.infer<typeof deviationSchema>;

export const awardDecisionSchema = z
  .object({
    lineId: z.uuid().describe('The RFQ line.'),
    ...partSchema,
    decision: z.enum(['award', 'noAward']).describe('A winner, or no award for the line.'),
    supplier: z
      .object({
        supplierId: z.uuid().describe('The winning supplier.'),
        name: z.string().min(1).describe('The supplier organisation name.'),
      })
      .strict()
      .nullable()
      .describe('The winning supplier, or null for no award.'),
    normalisedTotal: moneySchema.nullable().describe('The winning normalised total, or null for no award.'),
    lowest: z.boolean().describe('Whether the winner has the lowest normalised total on the line.'),
    buyerRecorded: z.boolean().describe('Whether the winning quote was recorded by a buyer (R42).'),
    alternate: alternateOfferSchema
      .nullable()
      .describe('The alternate part the winner offered, which quality accepted (R22), or null.'),
    justification: z.string().nullable().describe('Why a winner that is not the lowest was chosen, or null.'),
    evidence: z
      .array(evidenceDocumentSchema)
      .describe('The winning supplier required evidence at the time of the gate check.'),
    deviation: deviationSchema.nullable().describe('An active deviation on the winner, or null.'),
  })
  .strict()
  .describe('The decision on one line.');

export type AwardDecision = z.infer<typeof awardDecisionSchema>;

export const previousRoundSchema = z
  .object({
    rfqId: z.uuid().describe('The previous round.'),
    reference: referenceSchema,
    closedAt: z.iso.datetime().describe('When the previous round closed.'),
    suppliersInvited: z.number().int().nonnegative().describe('How many suppliers the previous round invited.'),
    quotesReceived: z.number().int().nonnegative().describe('How many quotes the previous round received.'),
    rebidReason: z.string().min(1).describe('Why the buyer started a re-bid.'),
  })
  .strict()
  .describe('The round this re-bid replaces (R16).');

export const approvalPacketSchema = lifecycleRead(
  z
    .object({
      availability: z.literal('submitted').describe('An award is waiting for approval.'),
      rfqId: z.uuid().describe('The RFQ.'),
      reference: referenceSchema,
      title: titleSchema,
      status: rfqStatusSchema,
      awardVersion: z.number().int().positive().describe('The award version under approval.'),
      submittedBy: z.string().min(1).describe('The buyer who submitted the award.'),
      submittedAt: z.iso.datetime().describe('When the award was submitted.'),
      gate: z
        .object({
          checkedAt: z.iso.datetime().describe('When the gate was last re-checked.'),
          passed: z.boolean().describe('Whether every check passed.'),
          checks: z.array(gateCheckSchema).describe('Every gate condition with its outcome.'),
        })
        .strict()
        .describe('The gate result approval re-checks (R23).'),
      decisions: z.array(awardDecisionSchema).describe('The decision on every line, in line-number order.'),
      awardedTotal: moneySchema.describe('The sum of the winning normalised totals.'),
      exchangeRates: z.array(exchangeRateSchema).describe('The rates the award captured.'),
      previousRound: previousRoundSchema.nullable().describe('The previous round of a re-bid, or null.'),
    })
    .strict(),
  approvalTransitions,
);

export type ApprovalPacket = z.infer<typeof approvalPacketSchema>;

export const approvalNotSubmittedSchema = z
  .object({
    availability: z.literal('noAwardSubmitted').describe('No award is waiting for approval.'),
    rfqId: z.uuid().describe('The RFQ.'),
    reference: referenceSchema,
    title: titleSchema,
    status: rfqStatusSchema,
  })
  .strict();

export const approvalReadSchema = z
  .discriminatedUnion('availability', [approvalPacketSchema, approvalNotSubmittedSchema])
  .describe('The approval packet of a submitted award, or that no award is waiting.');

export type ApprovalRead = z.infer<typeof approvalReadSchema>;

export const approvalPacketQuery = defineQuery({
  name: 'rfqs.approvalPacket',
  description:
    'Read the approval packet of a submitted award: the gate checklist with blocking reasons, each winner with its evidence and any active deviation, and the previous round of a re-bid.',
  input: rfqInputSchema,
  output: approvalReadSchema,
  errors: readErrors,
  access: staffReaders,
});

export const rfqQueries = [rfqDetailQuery, quoteComparisonQuery, approvalPacketQuery] as const;
