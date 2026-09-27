import { z } from 'zod';

/**
 * Field rules the RFQ builder, the amend dialog and the extend dialog share. Errors are message
 * keys. Deadlines are entered in UTC (R19) as `YYYY-MM-DDTHH:mm`.
 */

const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The instant a `datetime-local` value names when read as UTC, or null when it names none. */
export function utcInstantOf(value: string): string | null {
  if (!localDateTimePattern.test(value)) {
    return null;
  }
  const time = Date.parse(`${value}:00Z`);
  // A round trip refuses dates such as 30 February, which some engines roll over into March.
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 16) === value ? `${value}:00Z` : null;
}

/** A deadline in UTC, strictly after `after` (an ISO instant). */
export function deadlineSchema(after: string, messages: { readonly invalid: string; readonly tooEarly: string }) {
  return z
    .string()
    .transform((value, context) => {
      const instant = utcInstantOf(value);
      if (instant === null) {
        context.addIssue({ code: 'custom', message: messages.invalid });
        return z.NEVER;
      }
      return instant;
    })
    .refine((instant) => Date.parse(instant) > Date.parse(after), messages.tooEarly);
}

export function quantitySchema(messageKey: string) {
  return z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, messageKey)
    .transform(Number)
    .refine((value) => value > 0, messageKey);
}

const maximumBreaks = 6;

/**
 * Further quantities to price, written as a list such as `100, 500`: whole numbers above zero,
 * ascending, at most six. The requested quantity is always priced, so it need not be listed.
 */
export function quantityBreaksSchema(messageKey: string) {
  return z
    .string()
    .transform((value, context) => {
      const parts = value
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter((part) => part !== '');
      if (!parts.every((part) => /^\d{1,9}$/.test(part))) {
        context.addIssue({ code: 'custom', message: messageKey });
        return z.NEVER;
      }
      return parts.map(Number);
    })
    .refine(
      (breaks) =>
        breaks.length <= maximumBreaks &&
        breaks.every((quantity, index) => quantity > 0 && (index === 0 || quantity > (breaks[index - 1] ?? 0))),
      messageKey,
    );
}

/** The UTC calendar date of an instant, for comparing with a required-by date. */
export function utcDateOf(instant: string): string {
  return instant.slice(0, 10);
}

/** The value a `datetime-local` field shows for an instant, in UTC. */
export function localDateTimeOf(instant: string): string {
  return instant.slice(0, 16);
}
