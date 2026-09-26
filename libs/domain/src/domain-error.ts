import type { DomainErrorTag, ErrorCode, ErrorParams, ReasonOf } from '@partledger/contracts';

import { failure, type Failure } from './result';

/**
 * An expected failure, discriminated on `_tag`, with a reason from the tag's closed list in
 * `@partledger/contracts` (errors.ts). One filter in the API maps each tag to an HTTP status
 * and each reason to the message key `pl.error.<tag>.<reason>`.
 */
export type DomainErrorOf<Code extends ErrorCode> = Code extends ErrorCode
  ? { readonly _tag: Code['tag']; readonly reason: Code['reason']; readonly params: ErrorParams }
  : never;

export type DomainError = DomainErrorOf<ErrorCode>;

export function domainError<Tag extends DomainErrorTag, Reason extends ReasonOf<Tag>>(
  tag: Tag,
  reason: Reason,
  params: ErrorParams = {},
): { readonly _tag: Tag; readonly reason: Reason; readonly params: ErrorParams } {
  return { _tag: tag, reason, params };
}

/** A failed `Result` carrying a domain error. */
export function refuse<Tag extends DomainErrorTag, Reason extends ReasonOf<Tag>>(
  tag: Tag,
  reason: Reason,
  params: ErrorParams = {},
): Failure<{ readonly _tag: Tag; readonly reason: Reason; readonly params: ErrorParams }> {
  return failure(domainError(tag, reason, params));
}

/**
 * Commands on versioned aggregates compare the client's expected version with the stored one
 * before they change anything (R33).
 */
export function versionConflict(
  expectedVersion: number,
  actualVersion: number,
): DomainErrorOf<{ readonly tag: 'Conflict'; readonly reason: 'versionMismatch' }> | null {
  return expectedVersion === actualVersion
    ? null
    : domainError('Conflict', 'versionMismatch', { expectedVersion, actualVersion });
}
