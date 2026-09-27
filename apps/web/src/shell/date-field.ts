import { z } from 'zod';

export interface DateRule {
  readonly test: (date: string) => boolean;
  /** The message key shown when the rule fails. */
  readonly message: string;
}

/**
 * A calendar date field (`YYYY-MM-DD`). It reports one message: that the date is missing or
 * malformed, or else the first rule it breaks, so a blank field never also reads as "too early".
 */
export function dateSchema(invalidKey: string, rules: readonly DateRule[] = []) {
  return z.string().superRefine((value, context) => {
    if (!z.iso.date().safeParse(value).success) {
      context.addIssue({ code: 'custom', message: invalidKey });
      return;
    }
    const broken = rules.find((rule) => !rule.test(value));
    if (broken !== undefined) {
      context.addIssue({ code: 'custom', message: broken.message });
    }
  });
}
