import { queryPath } from '../define';
import { errorBodySchema, validationErrorBodySchema } from '../errors';
import type { AdapterResult, ApiAdapter } from './api-client';

/** The part of `fetch` the adapter uses, so the library needs no DOM types. */
export type FetchLike = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; credentials: 'same-origin' },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface HttpAdapterOptions {
  readonly fetch: FetchLike;
  /** Prefix before `/api/v1`; empty for the front-end's same-origin `/api` proxy (KTD30). */
  readonly origin?: string;
}

const unauthorizedStatus = 401;

/**
 * Calls the routes the API generates from the declarations (U5): `GET /api/v1/queries/<name>`
 * with the input as JSON in the `input` parameter. The session cookie travels same-origin.
 */
export function createHttpAdapter({ fetch, origin = '' }: HttpAdapterOptions): ApiAdapter {
  return {
    async query(name, input): Promise<AdapterResult> {
      const url = `${origin}${queryPath(name)}?input=${encodeURIComponent(JSON.stringify(input))}`;
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        });
      } catch {
        return { ok: false, failure: { kind: 'unavailable' } };
      }
      const body = await readJson(response);
      if (response.ok) {
        return body.parsed ? { ok: true, body: body.value } : { ok: false, failure: { kind: 'malformed' } };
      }
      if (response.status === unauthorizedStatus) {
        return { ok: false, failure: { kind: 'unauthenticated' } };
      }
      const validation = validationErrorBodySchema.safeParse(body.parsed ? body.value : undefined);
      if (validation.success) {
        return { ok: false, failure: { kind: 'invalid', issues: validation.data.issues } };
      }
      const refusal = errorBodySchema.safeParse(body.parsed ? body.value : undefined);
      if (refusal.success) {
        const { error, message, params } = refusal.data;
        return { ok: false, failure: { kind: 'refused', error, message, params } };
      }
      return { ok: false, failure: { kind: 'unavailable' } };
    },
  };
}

async function readJson(response: {
  json(): Promise<unknown>;
}): Promise<{ parsed: true; value: unknown } | { parsed: false }> {
  try {
    return { parsed: true, value: await response.json() };
  } catch {
    return { parsed: false };
  }
}
