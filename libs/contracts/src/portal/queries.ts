import { z } from 'zod';

import { defineQuery } from '../define';
import { errorCode, messageKeySchema } from '../errors';
import { lifecycleRead } from '../lifecycle';
import { currencyCodeSchema, decimalSchema } from '../money';

/**
 * The reads behind the supplier portal (U28). A portal session belongs to one supplier link, so
 * every read takes no identifiers: the server derives the supplier, the RFQ and what the link
 * allows from the session (KTD21), and each shape carries only that supplier's own lines. A bad,
 * expired or revoked link or session is the one uniform 401, which the client reports as
 * `unauthenticated`; these reads declare no failure of their own for it.
 */

const supplierReaders = { supplier_token: true } as const;

const portalReadErrors = [errorCode('Forbidden', 'notPermitted')] as const;

const sessionInputSchema = z
  .object({})
  .strict()
  .describe('No input: the portal session names the supplier, the link and the RFQ.');

/** What a link was issued for (KTD21). */
export const linkScopes = ['rfq_response', 'evidence_request'] as const;

export const linkScopeSchema = z
  .enum(linkScopes)
  .describe('rfq_response: answer an RFQ; evidence_request: provide requested evidence documents.');

export type LinkScope = z.infer<typeof linkScopeSchema>;

/** The portal screens; which of them a session opens follows the link scope and the RFQ state (R17). */
export const portalViews = ['respond', 'submission', 'outcome', 'evidence'] as const;

export const portalViewSchema = z.enum(portalViews);

export type PortalView = z.infer<typeof portalViewSchema>;

/** The RFQ as a supplier sees it: open for answers, closed and awaiting a decision, or decided. */
export const portalRfqStates = ['open', 'closed', 'sealed'] as const;

export const portalRfqStateSchema = z
  .enum(portalRfqStates)
  .describe(
    'open: answers can be saved and submitted until the deadline; closed: the last submission can be read; sealed: the supplier outcome can be read.',
  );

export type PortalRfqState = z.infer<typeof portalRfqStateSchema>;

const referenceSchema = z
  .string()
  .regex(/^RFQ-\d{4,}(-R\d+)?$/)
  .describe('The human-readable RFQ reference, such as RFQ-1060.');

const titleSchema = z.string().min(1).max(200).describe('The title the buyer gave the RFQ.');

export const timeZoneSchema = z
  .string()
  .min(1)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'not an IANA time zone')
  .describe('An IANA time zone, such as America/Toronto.');

const partFields = {
  lineId: z.uuid().describe('The RFQ line.'),
  lineNumber: z.number().int().positive().describe('The line number within the RFQ.'),
  partNumber: z.string().min(1).describe('The part number snapshotted at publish.'),
  revision: z.string().min(1).describe('The part revision snapshotted at publish.'),
  description: z.string().describe('The part description snapshotted at publish.'),
  quantity: z.number().int().positive().describe('The requested quantity.'),
  unit: z.enum(['each', 'kilogram', 'metre']).describe('The unit the quantity is counted in.'),
};

// ---------------------------------------------------------------------------------------------
// Session

export const portalSessionSchema = z
  .object({
    scope: linkScopeSchema,
    supplierName: z.string().min(1).describe('The supplier organisation the link was issued to.'),
    buyerName: z.string().min(1).describe('The buying organisation that sent the link.'),
    rfq: z
      .object({
        reference: referenceSchema,
        title: titleSchema,
        state: portalRfqStateSchema,
      })
      .strict()
      .nullable()
      .describe('The RFQ an rfq_response link belongs to, or null for an evidence request.'),
    views: z
      .tuple([portalViewSchema], portalViewSchema)
      .describe('The screens this session opens now, derived by the server from the scope and RFQ state.'),
    timeZone: timeZoneSchema.describe('The supplier time zone, in which the portal shows deadlines beside UTC.'),
    expiresAt: z.iso.datetime().describe('When the link stops working, in UTC.'),
  })
  .strict()
  .describe('What the current portal session opens, for one supplier organisation.');

export type PortalSession = z.infer<typeof portalSessionSchema>;

export const portalSessionQuery = defineQuery({
  name: 'portal.session',
  description:
    'Read what the current supplier link session opens: the supplier, the buyer, the RFQ state and the screens it allows.',
  input: sessionInputSchema,
  output: portalSessionSchema,
  errors: portalReadErrors,
  access: supplierReaders,
});

// ---------------------------------------------------------------------------------------------
// Answers

/** Why a supplier declines to quote a line (R18). */
export const noQuoteReasons = ['capacity', 'capability', 'material', 'leadTime', 'other'] as const;

export const noQuoteReasonSchema = z.enum(noQuoteReasons).describe('Why the supplier declines to quote the line.');

export type NoQuoteReason = z.infer<typeof noQuoteReasonSchema>;

const priceBreakSchema = z
  .object({
    quantity: z.number().int().positive().describe('The quantity break the price applies from.'),
    unitPrice: decimalSchema.describe('The unit price at this quantity break, in the quote currency.'),
  })
  .strict()
  .describe('One quantity break and its unit price.');

const priceFields = {
  currency: currencyCodeSchema.describe('The currency of every price in the answer.'),
  priceBreaks: z.array(priceBreakSchema).min(1).describe('A unit price per quantity break the buyer asked for.'),
  leadTimeDays: z.number().int().nonnegative().describe('The lead time in days from order.'),
  minimumOrderQuantity: z.number().int().positive().describe('The supplier minimum order quantity.'),
  oneOffCosts: decimalSchema.describe('Tooling and other one-off costs, in the quote currency.'),
  validUntil: z.iso.date().describe('The last day the prices are valid.'),
};

export const lineAnswerSchema = z
  .discriminatedUnion('kind', [
    z
      .object({ kind: z.literal('quote').describe('A quote for the requested part.'), ...priceFields })
      .strict()
      .describe('A quote for the requested part.'),
    z
      .object({
        kind: z.literal('noQuote').describe('The supplier declines the line.'),
        reason: noQuoteReasonSchema,
        note: z.string().max(1000).nullable().describe('What the supplier added about the reason, or null.'),
      })
      .strict()
      .describe('A no-quote with its reason.'),
    z
      .object({
        kind: z.literal('alternate').describe('A quote for an alternate part.'),
        specification: z.string().min(1).max(2000).describe('The alternate part the supplier offers instead.'),
        ...priceFields,
      })
      .strict()
      .describe('A quote for an alternate part, which a quality engineer must accept before it can win (R22).'),
  ])
  .describe('The supplier answer on one line: a quote, a no-quote with a reason, or an alternate (R18).');

export type LineAnswer = z.infer<typeof lineAnswerSchema>;

// ---------------------------------------------------------------------------------------------
// Response form

export const responseTransitions = ['saveDraft', 'submit'] as const;

export const lineChangeSchema = z
  .object({
    version: z.number().int().positive().describe('The RFQ version that changed the line.'),
    changedAt: z.iso.datetime().describe('When the buyer published the change, in UTC.'),
  })
  .strict()
  .describe(
    'The line changed after the supplier last submitted, so its answer must be reviewed and resubmitted (R16).',
  );

export const responseLineSchema = z
  .object({
    ...partFields,
    requiredBy: z.iso.date().describe('The date the parts are needed by.'),
    quantityBreaks: z
      .array(z.number().int().positive())
      .min(1)
      .describe('The quantities the buyer asks a unit price for, ascending.'),
    changed: lineChangeSchema.nullable().describe('How the line changed since the last submission, or null.'),
    draft: lineAnswerSchema.nullable().describe('The saved draft answer on the line, or null.'),
  })
  .strict()
  .describe('One line assigned to the supplier.');

export type ResponseLine = z.infer<typeof responseLineSchema>;

export const portalResponseSchema = lifecycleRead(
  z
    .object({
      reference: referenceSchema,
      title: titleSchema,
      buyerName: z.string().min(1).describe('The buying organisation.'),
      version: z.number().int().positive().describe('The current RFQ version the answers must match.'),
      deadline: z.iso.datetime().describe('The response deadline in UTC; the server refuses anything later (R19).'),
      currency: currencyCodeSchema.describe('The currency the buyer prefers; the supplier may quote in another.'),
      draftSavedAt: z.iso.datetime().nullable().describe('When the draft was last saved, or null.'),
      lastSubmittedAt: z.iso.datetime().nullable().describe('When the supplier last submitted, or null.'),
      lines: z.array(responseLineSchema).min(1).describe('The lines assigned to this supplier only, in line order.'),
    })
    .strict(),
  responseTransitions,
).describe('The response form of an open RFQ for one supplier.');

export type PortalResponse = z.infer<typeof portalResponseSchema>;

export const portalResponseQuery = defineQuery({
  name: 'portal.response',
  description:
    'Read the response form of the open RFQ the session belongs to: the supplier own lines, its draft answers and which lines changed since it last submitted.',
  input: sessionInputSchema,
  output: portalResponseSchema,
  errors: portalReadErrors,
  access: supplierReaders,
});

// ---------------------------------------------------------------------------------------------
// Submission

export const submissionLineSchema = z
  .object({
    ...partFields,
    answer: lineAnswerSchema,
    changedSince: z.boolean().describe('Whether the buyer changed the line after this submission.'),
  })
  .strict()
  .describe('One submitted line.');

export const portalSubmissionSchema = z
  .object({
    availability: z.literal('submitted').describe('The supplier has submitted a response.'),
    reference: referenceSchema,
    title: titleSchema,
    rfqState: portalRfqStateSchema,
    submissionVersion: z.number().int().positive().describe('1 for the first submission; each revision adds one.'),
    rfqVersion: z.number().int().positive().describe('The RFQ version the submission answered.'),
    submittedAt: z.iso.datetime().describe('The server receipt time of the submission, in UTC.'),
    declaredName: z.string().min(1).describe('The name the submitter declared (R20).'),
    attestedAuthority: z
      .literal(true)
      .describe('The submitter attested to their authority to submit for the supplier (R20).'),
    lines: z.array(submissionLineSchema).min(1).describe('The submitted answers, for this supplier own lines only.'),
  })
  .strict();

export const noSubmissionSchema = z
  .object({
    availability: z.literal('notSubmitted').describe('The supplier has not submitted a response.'),
    reference: referenceSchema,
    title: titleSchema,
    rfqState: portalRfqStateSchema,
  })
  .strict();

export const submissionReadSchema = z
  .discriminatedUnion('availability', [portalSubmissionSchema, noSubmissionSchema])
  .describe('The last submission of the supplier, read-only, or that it has not submitted.');

export type SubmissionRead = z.infer<typeof submissionReadSchema>;

export type PortalSubmission = z.infer<typeof portalSubmissionSchema>;

export const portalSubmissionQuery = defineQuery({
  name: 'portal.submission',
  description: 'Read the last submission of the supplier on the RFQ the session belongs to, read-only.',
  input: sessionInputSchema,
  output: submissionReadSchema,
  errors: portalReadErrors,
  access: supplierReaders,
});

// ---------------------------------------------------------------------------------------------
// Outcome

export const lineResults = ['awarded', 'notAwarded'] as const;

/**
 * A result names only whether this supplier won the line: never the winner, another supplier's
 * price, or how many others answered (R20).
 */
export const outcomeLineSchema = z
  .object({
    ...partFields,
    result: z.enum(lineResults).describe('Whether the line was awarded to this supplier.'),
  })
  .strict()
  .describe('The outcome of one line for this supplier.');

export type OutcomeLine = z.infer<typeof outcomeLineSchema>;

export const portalOutcomeSchema = z
  .object({
    reference: referenceSchema,
    title: titleSchema,
    sealedAt: z.iso.datetime().describe('When the award was sealed, in UTC.'),
    lines: z.array(outcomeLineSchema).min(1).describe('The outcome of this supplier own lines only.'),
  })
  .strict()
  .describe('The outcome of the supplier own lines once the award is sealed.');

export type PortalOutcome = z.infer<typeof portalOutcomeSchema>;

export const portalOutcomeQuery = defineQuery({
  name: 'portal.outcome',
  description: 'Read the outcome of the supplier own lines after the award is sealed; never other suppliers results.',
  input: sessionInputSchema,
  output: portalOutcomeSchema,
  errors: portalReadErrors,
  access: supplierReaders,
});

// ---------------------------------------------------------------------------------------------
// Evidence requests

export const evidenceRequestStatuses = ['requested', 'underReview', 'accepted', 'rejected'] as const;

export const evidenceRequestSchema = z
  .object({
    requestId: z.uuid().describe('The evidence request.'),
    typeLabel: messageKeySchema.describe('The message key naming the requested evidence type.'),
    status: z
      .enum(evidenceRequestStatuses)
      .describe(
        'requested: nothing uploaded yet; underReview: uploaded and awaiting the buyer quality review; accepted; rejected with a reason.',
      ),
    dueBy: z.iso.date().describe('The date the buyer needs the document by.'),
    uploadedAt: z.iso.datetime().nullable().describe('When the supplier last uploaded a document, or null.'),
    rejectionReason: z.string().min(1).nullable().describe('Why the buyer rejected the document, or null.'),
    validUntil: z.iso.date().nullable().describe('The last day an accepted document is valid, or null.'),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.rejectionReason !== null) !== (request.status === 'rejected')) {
      context.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'only a rejection carries a reason' });
    }
    if ((request.uploadedAt === null) !== (request.status === 'requested')) {
      context.addIssue({ code: 'custom', path: ['uploadedAt'], message: 'every status but requested has an upload' });
    }
  })
  .describe('One evidence document the buyer asked the supplier for.');

export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;

export const evidenceRequestListSchema = z
  .object({
    buyerName: z.string().min(1).describe('The buying organisation that asked for the evidence.'),
    requests: z.array(evidenceRequestSchema).describe('The requests of this link, most urgent first.'),
  })
  .strict()
  .describe('The evidence the buyer asked this supplier for.');

export type EvidenceRequestList = z.infer<typeof evidenceRequestListSchema>;

export const portalEvidenceRequestsQuery = defineQuery({
  name: 'portal.evidenceRequests',
  description:
    'List the evidence documents the buyer asked the supplier for through the session link, with their status.',
  input: sessionInputSchema,
  output: evidenceRequestListSchema,
  errors: portalReadErrors,
  access: supplierReaders,
});

export const portalQueries = [
  portalSessionQuery,
  portalResponseQuery,
  portalSubmissionQuery,
  portalOutcomeQuery,
  portalEvidenceRequestsQuery,
] as const;
