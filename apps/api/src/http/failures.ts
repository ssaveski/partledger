import type { ValidationIssue } from '@partledger/contracts';
import type { DomainError } from '@partledger/domain';

/**
 * Carriers from the gateway to the error filter. Services and handlers return failures as
 * values; only the gateway turns an outcome into one of these, so the filter is the one place
 * that decides status codes and bodies.
 */

export class DomainFailure extends Error {
  readonly error: DomainError;

  constructor(error: DomainError) {
    super(`${error._tag}: ${error.reason}`);
    this.name = 'DomainFailure';
    this.error = error;
  }
}

export class RequestValidationFailure extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('The request input does not parse');
    this.name = 'RequestValidationFailure';
    this.issues = issues;
  }
}

/** Every refused credential, whatever the reason; the response is identical for all of them. */
export class UnauthenticatedFailure extends Error {
  constructor() {
    super('The credential was refused');
    this.name = 'UnauthenticatedFailure';
  }
}
