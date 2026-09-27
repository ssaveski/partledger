import type { z } from 'zod';

import type { QueryDeclaration } from '../define';
import { messageKeyOf, type ErrorCode } from '../errors';
import type { AdapterResult, ApiAdapter, ClientFailure } from './api-client';

/** What a fixture returns for one input: the output, a declared failure, or a response that never arrives. */
export type FixtureResponse<Output> =
  | { readonly kind: 'output'; readonly output: Output }
  | { readonly kind: 'refused'; readonly code: ErrorCode }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'pending' };

export interface FixtureHandler {
  readonly name: string;
  respond(input: unknown): FixtureResponse<unknown> | { readonly kind: 'invalid' };
}

/** Serves one declared query from synthetic data; the input is parsed exactly as the API would. */
export function fixtureQuery<Declaration extends QueryDeclaration>(
  declaration: Declaration,
  respond: (input: z.output<Declaration['input']>) => FixtureResponse<z.input<Declaration['output']>>,
): FixtureHandler {
  return {
    name: declaration.name,
    respond(input) {
      const parsed = parseInput<Declaration['input']>(declaration.input, input);
      return parsed.success ? respond(parsed.data) : { kind: 'invalid' };
    },
  };
}

function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.ZodSafeParseResult<z.output<Schema>> {
  return schema.safeParse(value);
}

export interface FixtureAdapterOptions {
  /** Simulated network time before each response, so loading states show as they would against the API. */
  readonly latency?: () => Promise<void>;
}

/**
 * Serves synthetic data in the declared shapes. Bodies cross a JSON round trip, as they would over
 * HTTP, so a screen can never depend on sharing an object with the fixtures.
 */
export function createFixtureAdapter(
  handlers: readonly FixtureHandler[],
  { latency = () => Promise.resolve() }: FixtureAdapterOptions = {},
): ApiAdapter {
  const byName = new Map(handlers.map((handler) => [handler.name, handler]));
  return {
    async query(name, input): Promise<AdapterResult> {
      await latency();
      const handler = byName.get(name);
      if (handler === undefined) {
        return refusedWith({ tag: 'NotFound', reason: 'route' });
      }
      const response = handler.respond(input);
      switch (response.kind) {
        case 'output':
          return { ok: true, body: JSON.parse(JSON.stringify(response.output)) };
        case 'refused':
          return refusedWith(response.code);
        case 'invalid':
          return { ok: false, failure: { kind: 'invalid', issues: [{ path: [], code: 'invalid_input' }] } };
        case 'unavailable':
          return { ok: false, failure: { kind: 'unavailable' } };
        case 'pending':
          return new Promise<never>(() => undefined);
      }
    },
  };
}

function refusedWith(code: ErrorCode): { readonly ok: false; readonly failure: ClientFailure } {
  return { ok: false, failure: { kind: 'refused', error: code.tag, message: messageKeyOf(code), params: {} } };
}
