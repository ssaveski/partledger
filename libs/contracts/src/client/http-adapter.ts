import { staffAuthPaths, staffRequestHeader } from '../auth';
import { commandPath, idempotencyKeyHeader, queryPath } from '../define';
import { errorBodySchema, validationErrorBodySchema } from '../errors';
import type { AdapterResult, ApiAdapter } from './api-client';

/** The part of `fetch` the adapter uses, so the library needs no DOM types. */
export type FetchLike = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    credentials: 'same-origin';
    body?: string;
    cache?: 'no-store';
  },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface HttpAdapterOptions {
  readonly fetch: FetchLike;
  /** Prefix before `/api/v1`; empty for the front-end's same-origin `/api` proxy (KTD30). */
  readonly origin?: string;
}

const unauthorizedStatus = 401;
const noContentStatus = 204;

/**
 * Calls the routes the API generates from the declarations (U5): `GET /api/v1/queries/<name>`
 * with the input as JSON in the `input` parameter, and `POST /api/v1/commands/<name>` with the
 * input as the body, an idempotency key and the staff app's request header (KTD20). The
 * session endpoints are the API's own (U7). The session cookie travels same-origin.
 */
export function createHttpAdapter({ fetch, origin = '' }: HttpAdapterOptions): ApiAdapter {
  async function send(url: string, init: Parameters<FetchLike>[1]): Promise<AdapterResult> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetch(url, init);
    } catch {
      return { ok: false, failure: { kind: 'unavailable' } };
    }
    if (response.status === noContentStatus) {
      return { ok: true, body: null };
    }
    const body = await readJson(response);
    if (response.ok) {
      return body.parsed ? { ok: true, body: body.value } : { ok: false, failure: { kind: 'malformed' } };
    }
    if (response.status === unauthorizedStatus) {
      // A step-up refusal is a 401 with its own message; a refused credential is the uniform 401.
      const refusal = errorBodySchema.safeParse(body.parsed ? body.value : undefined);
      if (refusal.success && refusal.data.error === 'StepUpRequired') {
        const { error, message, params } = refusal.data;
        return { ok: false, failure: { kind: 'refused', error, message, params } };
      }
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
  }

  const stateChanging = { [staffRequestHeader.name]: staffRequestHeader.value };

  return {
    query(name, input) {
      return send(`${origin}${queryPath(name)}?input=${encodeURIComponent(JSON.stringify(input))}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
    },
    command(name, input, idempotencyKey) {
      return send(`${origin}${commandPath(name)}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          [idempotencyKeyHeader]: idempotencyKey,
          ...stateChanging,
        },
        credentials: 'same-origin',
        body: JSON.stringify(input),
      });
    },
    session() {
      return send(`${origin}${staffAuthPaths.session}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
    },
    signOut() {
      return send(`${origin}${staffAuthPaths.signOut}`, {
        method: 'POST',
        headers: stateChanging,
        credentials: 'same-origin',
      });
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
