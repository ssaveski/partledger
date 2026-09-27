import { z } from 'zod';

import type { QueryDeclaration } from '../define';
import { messageKeyOf, type ErrorCode } from '../errors';
import type { AdapterResult, ApiAdapter, ClientFailure } from './api-client';

/**
 * What a fixture returns for one input: the output, a declared failure, the uniform refusal of a
 * missing, expired or revoked session or link, or a response that never arrives.
 */
export type FixtureResponse<Output> =
  | { readonly kind: 'output'; readonly output: Output }
  | { readonly kind: 'refused'; readonly code: ErrorCode }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'pending' };

/**
 * A state a reviewer can ask every read of a page to show, whatever it reads: `empty` serves
 * lists without entries, the others fail every read the way the API or network would.
 */
export const previewStates = ['empty', 'slow', 'unavailable', 'forbidden'] as const;

export const previewStateSchema = z.enum(previewStates);

export type PreviewState = z.infer<typeof previewStateSchema>;

/** What a handler serves: its synthetic data, or the same shape with every list empty. */
export type FixtureView = 'populated' | 'empty';

export interface FixtureHandler {
  readonly name: string;
  respond(input: unknown, view: FixtureView): FixtureResponse<unknown> | { readonly kind: 'invalid' };
}

/** Serves one declared query from synthetic data; the input is parsed exactly as the API would. */
export function fixtureQuery<Declaration extends QueryDeclaration>(
  declaration: Declaration,
  respond: (
    input: z.output<Declaration['input']>,
    view: FixtureView,
  ) => FixtureResponse<z.input<Declaration['output']>>,
): FixtureHandler {
  return {
    name: declaration.name,
    respond(input, view) {
      const parsed = parseInput<Declaration['input']>(declaration.input, input);
      return parsed.success ? respond(parsed.data, view) : { kind: 'invalid' };
    },
  };
}

function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.ZodSafeParseResult<z.output<Schema>> {
  return schema.safeParse(value);
}

export interface FixtureAdapterOptions {
  /** Simulated network time before each response, so loading states show as they would against the API. */
  readonly latency?: () => Promise<void>;
  /** The preview state asked for when a read is made, if any. */
  readonly previewState?: () => PreviewState | null;
}

/**
 * Serves synthetic data in the declared shapes. Bodies cross a JSON round trip, as they would over
 * HTTP, so a screen can never depend on sharing an object with the fixtures.
 */
export function createFixtureAdapter(
  handlers: readonly FixtureHandler[],
  { latency = () => Promise.resolve(), previewState = () => null }: FixtureAdapterOptions = {},
): ApiAdapter {
  const byName = new Map(handlers.map((handler) => [handler.name, handler]));
  return {
    async query(name, input): Promise<AdapterResult> {
      await latency();
      const handler = byName.get(name);
      if (handler === undefined) {
        return refusedWith({ tag: 'NotFound', reason: 'route' });
      }
      const state = previewState();
      const response = forcedResponse(state) ?? handler.respond(input, state === 'empty' ? 'empty' : 'populated');
      switch (response.kind) {
        case 'output':
          return { ok: true, body: JSON.parse(JSON.stringify(response.output)) };
        case 'refused':
          return refusedWith(response.code);
        case 'invalid':
          return { ok: false, failure: { kind: 'invalid', issues: [{ path: [], code: 'invalid_input' }] } };
        case 'unauthenticated':
          return { ok: false, failure: { kind: 'unauthenticated' } };
        case 'unavailable':
          return { ok: false, failure: { kind: 'unavailable' } };
        case 'pending':
          return new Promise<never>(() => undefined);
      }
    },
  };
}

function forcedResponse(state: PreviewState | null): FixtureResponse<never> | null {
  switch (state) {
    case 'slow':
      return { kind: 'pending' };
    case 'unavailable':
      return { kind: 'unavailable' };
    case 'forbidden':
      return { kind: 'refused', code: { tag: 'Forbidden', reason: 'notPermitted' } };
    case 'empty':
    case null:
      return null;
  }
}

function refusedWith(code: ErrorCode): { readonly ok: false; readonly failure: ClientFailure } {
  return { ok: false, failure: { kind: 'refused', error: code.tag, message: messageKeyOf(code), params: {} } };
}
