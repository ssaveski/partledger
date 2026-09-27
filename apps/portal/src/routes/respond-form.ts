import { currencyCodeSchema, decimalSchema } from '@partledger/contracts';
import {
  lineAnswerSchema,
  noQuoteReasons,
  type LineAnswer,
  type NoQuoteReason,
  type ResponseLine,
} from '@partledger/contracts/portal';
import { z } from 'zod';

export const answerKinds = ['quote', 'noQuote', 'alternate'] as const;

export type AnswerKind = (typeof answerKinds)[number];

/** The currencies offered first; the buyer's preferred currency is always among them. */
export const quoteCurrencies = ['CAD', 'USD', 'EUR', 'GBP'] as const;

/** Every field is text as typed, so a half-finished draft can be kept and shown back unchanged. */
export interface LineFormValues {
  lineId: string;
  kind: AnswerKind | '';
  currency: string;
  unitPrices: string[];
  leadTimeDays: string;
  minimumOrderQuantity: string;
  oneOffCosts: string;
  validUntil: string;
  noQuoteReason: NoQuoteReason | '';
  noQuoteNote: string;
  specification: string;
}

export interface ResponseFormValues {
  lines: LineFormValues[];
  declaredName: string;
  attestation: boolean;
}

function lineValues(line: ResponseLine, currency: string): LineFormValues {
  const blank: LineFormValues = {
    lineId: line.lineId,
    kind: '',
    currency,
    unitPrices: line.quantityBreaks.map(() => ''),
    leadTimeDays: '',
    minimumOrderQuantity: '',
    oneOffCosts: '',
    validUntil: '',
    noQuoteReason: '',
    noQuoteNote: '',
    specification: '',
  };
  const draft = line.draft;
  if (draft === null) {
    return blank;
  }
  if (draft.kind === 'noQuote') {
    return { ...blank, kind: 'noQuote', noQuoteReason: draft.reason, noQuoteNote: draft.note ?? '' };
  }
  return {
    ...blank,
    kind: draft.kind,
    currency: draft.currency,
    unitPrices: line.quantityBreaks.map(
      (quantity) => draft.priceBreaks.find((priceBreak) => priceBreak.quantity === quantity)?.unitPrice ?? '',
    ),
    leadTimeDays: String(draft.leadTimeDays),
    minimumOrderQuantity: String(draft.minimumOrderQuantity),
    oneOffCosts: draft.oneOffCosts,
    validUntil: draft.validUntil,
    specification: draft.kind === 'alternate' ? draft.specification : '',
  };
}

/** The form as the saved draft left it; the declaration and attestation are made afresh each time. */
export function responseFormValues(lines: readonly ResponseLine[], currency: string): ResponseFormValues {
  return { lines: lines.map((line) => lineValues(line, currency)), declaredName: '', attestation: false };
}

const wholeNumber = /^\d{1,9}$/;

/**
 * The answer a line's fields make, in the shape the API takes, or null while it is incomplete.
 * The submit schema below names what is missing; this only decides whether an answer exists.
 */
export function lineAnswer(values: LineFormValues, quantityBreaks: readonly number[]): LineAnswer | null {
  let candidate: unknown = null;
  if (values.kind === 'noQuote') {
    candidate = {
      kind: 'noQuote',
      reason: values.noQuoteReason,
      note: values.noQuoteNote.trim() === '' ? null : values.noQuoteNote.trim(),
    };
  } else if (values.kind === 'quote' || values.kind === 'alternate') {
    const priced = {
      currency: values.currency,
      priceBreaks: quantityBreaks.map((quantity, index) => ({
        quantity,
        unitPrice: values.unitPrices[index]?.trim() ?? '',
      })),
      leadTimeDays: wholeNumber.test(values.leadTimeDays.trim()) ? Number(values.leadTimeDays.trim()) : Number.NaN,
      minimumOrderQuantity: wholeNumber.test(values.minimumOrderQuantity.trim())
        ? Number(values.minimumOrderQuantity.trim())
        : Number.NaN,
      oneOffCosts: values.oneOffCosts.trim(),
      validUntil: values.validUntil,
    };
    candidate =
      values.kind === 'quote'
        ? { kind: 'quote', ...priced }
        : { kind: 'alternate', specification: values.specification.trim(), ...priced };
  }
  const parsed = lineAnswerSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** A positive decimal such as `52.40`. */
function isPrice(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return decimalSchema.safeParse(trimmed).success && Number(trimmed) > 0;
}

function isWholeNumber(value: string, minimum: number): boolean {
  const trimmed = value.trim();
  return wholeNumber.test(trimmed) && Number(trimmed) >= minimum;
}

/**
 * What submitting needs (R18, R20): an answer on every line, each complete, and the submitter's
 * declared name and authority attestation. Errors are message keys, which the form translates
 * where it shows them.
 */
export function responseFormSchema(lines: readonly ResponseLine[]) {
  return z
    .object({
      lines: z.array(
        z.object({
          lineId: z.string(),
          kind: z.enum(['', ...answerKinds]),
          currency: z.string(),
          unitPrices: z.array(z.string()),
          leadTimeDays: z.string(),
          minimumOrderQuantity: z.string(),
          oneOffCosts: z.string(),
          validUntil: z.string(),
          noQuoteReason: z.enum(['', ...noQuoteReasons]),
          noQuoteNote: z.string(),
          specification: z.string(),
        }),
      ),
      declaredName: z.string(),
      attestation: z.boolean(),
    })
    .superRefine((form, context) => {
      const issue = (path: (string | number)[], message: string) => {
        context.addIssue({ code: 'custom', path, message });
      };
      form.lines.forEach((values, index) => {
        const line = lines[index];
        if (line === undefined) {
          return;
        }
        const at = (...field: (string | number)[]) => ['lines', index, ...field];
        if (values.kind === 'noQuote') {
          if (values.noQuoteReason === '') {
            issue(at('noQuoteReason'), 'pl.portal.respond.error.noQuoteReason');
          } else if (values.noQuoteReason === 'other' && values.noQuoteNote.trim() === '') {
            issue(at('noQuoteNote'), 'pl.portal.respond.error.noQuoteNote');
          }
          return;
        }
        if (values.kind !== 'quote' && values.kind !== 'alternate') {
          issue(at('kind'), 'pl.portal.respond.error.answerRequired');
          return;
        }
        if (values.kind === 'alternate' && values.specification.trim() === '') {
          issue(at('specification'), 'pl.portal.respond.error.specification');
        }
        if (!currencyCodeSchema.safeParse(values.currency).success) {
          issue(at('currency'), 'pl.portal.respond.error.currency');
        }
        line.quantityBreaks.forEach((_quantity, breakIndex) => {
          if (!isPrice(values.unitPrices[breakIndex])) {
            issue(at('unitPrices', breakIndex), 'pl.portal.respond.error.unitPrice');
          }
        });
        if (!isWholeNumber(values.leadTimeDays, 0)) {
          issue(at('leadTimeDays'), 'pl.portal.respond.error.leadTimeDays');
        }
        if (!isWholeNumber(values.minimumOrderQuantity, 1)) {
          issue(at('minimumOrderQuantity'), 'pl.portal.respond.error.minimumOrderQuantity');
        }
        if (!decimalSchema.safeParse(values.oneOffCosts.trim()).success) {
          issue(at('oneOffCosts'), 'pl.portal.respond.error.oneOffCosts');
        }
        if (!z.iso.date().safeParse(values.validUntil).success) {
          issue(at('validUntil'), 'pl.portal.respond.error.validUntil');
        }
      });
      if (form.declaredName.trim() === '') {
        issue(['declaredName'], 'pl.portal.respond.error.declaredName');
      }
      if (!form.attestation) {
        issue(['attestation'], 'pl.portal.respond.error.attestation');
      }
    });
}
