import {
  previewStateSchema,
  type AdapterResult,
  type ApiAdapter,
  type PreviewState,
} from '@partledger/contracts/client';

/** `?preview=empty|slow|unavailable|forbidden` asks every read of the opened page for that state. */
export const previewSearchParameter = 'preview';

export function previewStateFrom(search: string): PreviewState | null {
  const parsed = previewStateSchema.safeParse(new URLSearchParams(search).get(previewSearchParameter));
  return parsed.success ? parsed.data : null;
}

/**
 * What the fixture preview has written, so a later read of the same query and input returns it.
 * It lives for the page's lifetime; nothing reaches a server.
 */
export interface PreviewStore {
  read(name: string, input: unknown): { readonly found: true; readonly body: unknown } | { readonly found: false };
  write(name: string, input: unknown, body: unknown): void;
}

function keyOf(name: string, input: unknown): string {
  return `${name} ${JSON.stringify(input)}`;
}

export function createPreviewStore(): PreviewStore {
  const bodies = new Map<string, string>();
  return {
    read(name, input) {
      const body = bodies.get(keyOf(name, input));
      return body === undefined ? { found: false } : { found: true, body: JSON.parse(body) };
    },
    write(name, input, body) {
      bodies.set(keyOf(name, input), JSON.stringify(body));
    },
  };
}

/** Reads what the preview wrote before asking the fixtures. */
export function withPreviewStore(adapter: ApiAdapter, store: PreviewStore): ApiAdapter {
  return {
    query(name, input): Promise<AdapterResult> {
      const written = store.read(name, input);
      return written.found ? Promise.resolve({ ok: true, body: written.body }) : adapter.query(name, input);
    },
  };
}
