import { z } from 'zod';

import { messageKeyPattern } from './i18n/catalogue';

/**
 * The closed vocabulary of expected failures (R32). Every tag maps to one HTTP status in the
 * API's error filter, and every reason to the message key `pl.error.<tag>.<reason>` in
 * `i18n/en/error.json`. Adding a reason means adding its message; adding a tag means mapping
 * it in the filter, which the compiler enforces.
 */
export const domainErrorReasons = {
  NotFound: ['resource', 'route'],
  Conflict: ['versionMismatch', 'transitionNotAllowed', 'alreadyExists', 'lastTenantAdmin'],
  Invalid: ['request', 'idempotencyKeyRequired'],
  Unprocessable: ['idempotencyKeyReused', 'regionNotServed', 'aiRegionNotAllowed', 'aiOutputInvalid'],
  Forbidden: ['notPermitted', 'crossSiteRequest'],
  Unavailable: ['dependencyUnavailable'],
  StepUpRequired: ['recentAuthentication'],
} as const satisfies Readonly<Record<string, readonly [string, ...string[]]>>;

export type DomainErrorTag = keyof typeof domainErrorReasons;

export type ReasonOf<Tag extends DomainErrorTag> = (typeof domainErrorReasons)[Tag][number];

/** One declared failure: a tag and one of its reasons. */
export type ErrorCode = {
  [Tag in DomainErrorTag]: { readonly tag: Tag; readonly reason: ReasonOf<Tag> };
}[DomainErrorTag];

export function isDomainErrorTag(value: string): value is DomainErrorTag {
  return Object.hasOwn(domainErrorReasons, value);
}

export const domainErrorTags: readonly DomainErrorTag[] = Object.keys(domainErrorReasons).filter(isDomainErrorTag);

export function isErrorCode(value: { readonly tag: string; readonly reason: string }): value is ErrorCode {
  if (!isDomainErrorTag(value.tag)) {
    return false;
  }
  const reasons: readonly string[] = domainErrorReasons[value.tag];
  return reasons.includes(value.reason);
}

export function errorCode<Tag extends DomainErrorTag, Reason extends ReasonOf<Tag>>(
  tag: Tag,
  reason: Reason,
): { readonly tag: Tag; readonly reason: Reason } {
  return { tag, reason };
}

/** Every code in the vocabulary, for catalogue and mapping checks. */
export const allErrorCodes: readonly ErrorCode[] = domainErrorTags.flatMap((tag) => {
  const reasons: readonly string[] = domainErrorReasons[tag];
  return reasons.map((reason) => ({ tag, reason })).filter(isErrorCode);
});

export function messageKeyOf(code: { readonly tag: DomainErrorTag; readonly reason: string }): string {
  return `pl.error.${code.tag.charAt(0).toLowerCase()}${code.tag.slice(1)}.${code.reason}`;
}

/** The one body every refused credential gets, whatever the reason (KTD21). */
export const unauthenticatedMessageKey = 'pl.error.unauthenticated.credential';

/** Unexpected failures; the details go to the log, never to the client. */
export const internalErrorMessageKey = 'pl.error.internal.unexpected';

export const messageKeySchema = z.string().regex(messageKeyPattern).describe('A translation key; never prose.');

export const errorParamsSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe('Values interpolated into the message: identifiers and counts, never personal data.');

export type ErrorParams = z.infer<typeof errorParamsSchema>;

export const errorBodySchema = z
  .object({
    error: z.string().describe('The failure class, such as Conflict or Unauthenticated.'),
    message: messageKeySchema,
    params: errorParamsSchema,
  })
  .strict()
  .describe('The body of every refused request except input validation.');

export type ErrorBody = z.infer<typeof errorBodySchema>;

export const validationIssueSchema = z
  .object({
    path: z.array(z.union([z.string(), z.number()])).describe('Where in the input the problem is.'),
    code: z.string().describe('A stable problem code, such as invalid_type or too_small.'),
  })
  .strict();

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const validationMessageKey = messageKeyOf(errorCode('Invalid', 'request'));

export const validationErrorBodySchema = z
  .object({
    error: z.literal('Invalid'),
    message: z.literal(validationMessageKey),
    issues: z.array(validationIssueSchema).min(1),
  })
  .strict()
  .describe('The body of a request whose input does not parse; it never echoes the values sent.');

export type ValidationErrorBody = z.infer<typeof validationErrorBodySchema>;
