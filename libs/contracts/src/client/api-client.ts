import type { z } from 'zod';

import type { QueryDeclaration } from '../define';
import type { ErrorParams, ValidationIssue } from '../errors';
import {
  internalErrorMessageKey,
  messageKeyOf,
  unauthenticatedMessageKey,
  validationMessageKey,
  errorCode,
} from '../errors';

/**
 * Why a call did not return its declared output. Expected failures come back as values, never as
 * thrown errors, so a screen handles each one where it renders.
 */
export type ClientFailure =
  /** The server refused with a declared failure: its class and a message key with params. */
  | { readonly kind: 'refused'; readonly error: string; readonly message: string; readonly params: ErrorParams }
  /** The input did not parse, on the client or on the server. */
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  /** The session or link is missing, expired or revoked. */
  | { readonly kind: 'unauthenticated' }
  /** The API could not be reached or failed unexpectedly. */
  | { readonly kind: 'unavailable' }
  /** The response did not match the declared output. */
  | { readonly kind: 'malformed' };

export type ClientResult<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly failure: ClientFailure };

/** What an adapter returns: the raw body, which the client parses against the declaration. */
export type AdapterResult =
  { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly failure: ClientFailure };

/** Transport only: the HTTP adapter calls the API, the fixture adapter serves synthetic data. */
export interface ApiAdapter {
  query(name: string, input: unknown): Promise<AdapterResult>;
}

export interface ApiClient {
  query<Declaration extends QueryDeclaration>(
    declaration: Declaration,
    input: z.input<Declaration['input']>,
  ): Promise<ClientResult<z.output<Declaration['output']>>>;
}

/**
 * One typed client over either adapter. It parses the input before sending and the output on
 * arrival against the same declaration the API serves, so a screen never sees an unchecked shape.
 */
export function createApiClient(adapter: ApiAdapter): ApiClient {
  async function query<Declaration extends QueryDeclaration>(
    declaration: Declaration,
    input: z.input<Declaration['input']>,
  ): Promise<ClientResult<z.output<Declaration['output']>>> {
    const parsedInput = parseWith(declaration.input, input);
    if (!parsedInput.success) {
      return failed({
        kind: 'invalid',
        issues: parsedInput.error.issues.map((issue) => ({
          path: issue.path.filter((segment) => typeof segment !== 'symbol'),
          code: issue.code,
        })),
      });
    }
    const response = await adapter.query(declaration.name, parsedInput.data);
    if (!response.ok) {
      return response;
    }
    const output = parseWith<Declaration['output']>(declaration.output, response.body);
    if (!output.success) {
      return failed({ kind: 'malformed' });
    }
    return { ok: true, value: output.data };
  }
  return { query };
}

function parseWith<Schema extends z.ZodType>(schema: Schema, value: unknown): z.ZodSafeParseResult<z.output<Schema>> {
  return schema.safeParse(value);
}

function failed(failure: ClientFailure): { readonly ok: false; readonly failure: ClientFailure } {
  return { ok: false, failure };
}

/** The message key a screen shows for a failure. */
export function failureMessageKey(failure: ClientFailure): string {
  switch (failure.kind) {
    case 'refused':
      return failure.message;
    case 'invalid':
      return validationMessageKey;
    case 'unauthenticated':
      return unauthenticatedMessageKey;
    case 'unavailable':
      return messageKeyOf(errorCode('Unavailable', 'dependencyUnavailable'));
    case 'malformed':
      return internalErrorMessageKey;
  }
}

/** Whether the principal lacks permission, which screens show as the no-permission state. */
export function isPermissionFailure(failure: ClientFailure): boolean {
  return failure.kind === 'refused' && failure.error === 'Forbidden';
}
