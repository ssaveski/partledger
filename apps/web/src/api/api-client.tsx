import type { QueryDeclaration } from '@partledger/contracts';
import { createApiClient, createFixtureAdapter, createHttpAdapter, type ApiClient } from '@partledger/contracts/client';
import { fixtureHandlers } from '@partledger/contracts/fixtures';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { z } from 'zod';

import { previewStateFrom, withPreviewStore, type PreviewStore } from './preview';

export const adapterKinds = ['fixture', 'http'] as const;

export type AdapterKind = (typeof adapterKinds)[number];

/** `VITE_API_ADAPTER=http` targets the API through the same-origin `/api` proxy; anything else serves fixtures. */
export function adapterKindFrom(value: unknown): AdapterKind {
  return z.enum(adapterKinds).catch('fixture').parse(value);
}

// Enough for the loading state to register when a person clicks through the fixtures.
const fixtureLatencyMs = 250;

/** The fixture client reads what the preview wrote first, then the fixtures in the state the address asks for. */
export function createClient(kind: AdapterKind, preview: PreviewStore | null = null): ApiClient {
  if (kind === 'http') {
    return createApiClient(createHttpAdapter({ fetch: (url, init) => window.fetch(url, init) }));
  }
  const fixtures = createFixtureAdapter(fixtureHandlers, {
    latency: () =>
      new Promise((resolve) => {
        window.setTimeout(resolve, fixtureLatencyMs);
      }),
    previewState: () => previewStateFrom(window.location.search),
  });
  return createApiClient(preview === null ? fixtures : withPreviewStore(fixtures, preview));
}

interface ApiContextValue {
  readonly client: ApiClient;
  readonly kind: AdapterKind;
  /** Where fixture-preview writes go; null against the API, where writes are commands. */
  readonly preview?: PreviewStore | null;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ client, kind, preview = null, children }: ApiContextValue & { children: ReactNode }) {
  return <ApiContext value={{ client, kind, preview }}>{children}</ApiContext>;
}

function useApiContext(): ApiContextValue {
  const context = useContext(ApiContext);
  if (context === null) {
    throw new Error('useApiQuery needs an ApiProvider');
  }
  return context;
}

/** The typed client, for a screen that reads once outside a rendered query, such as before a preview write. */
export function useApiClient(): ApiClient {
  return useApiContext().client;
}

/** Whether screens show synthetic data, which the shell announces. */
export function useAdapterKind(): AdapterKind {
  return useApiContext().kind;
}

/** Query keys are the operation name and its input, so a screen can update one read in place. */
export function queryKeyOf<Declaration extends QueryDeclaration>(
  declaration: Declaration,
  input: z.input<Declaration['input']>,
): readonly [string, z.input<Declaration['input']>] {
  return [declaration.name, input];
}

/**
 * Runs a declared query through the client. The query function never throws: a failure is the
 * data, so every screen renders it through `QueryView` rather than an error boundary.
 */
export function useApiQuery<Declaration extends QueryDeclaration>(
  declaration: Declaration,
  input: z.input<Declaration['input']>,
) {
  const { client } = useApiContext();
  return useQuery({
    queryKey: queryKeyOf(declaration, input),
    queryFn: () => client.query(declaration, input),
  });
}

export type PreviewWrite = <Declaration extends QueryDeclaration>(
  declaration: Declaration,
  input: z.input<Declaration['input']>,
  value: z.output<Declaration['output']>,
) => void;

/**
 * Under the fixture adapter a preview write replaces what a read returns, for this page's
 * lifetime, and updates any screen showing it. Against the API there is no preview write, so
 * screens disable the action with its reason until the command exists.
 */
export function usePreviewWrite(): PreviewWrite | null {
  const { preview } = useApiContext();
  const queryClient = useQueryClient();
  const write = useCallback<PreviewWrite>(
    (declaration, input, value) => {
      preview?.write(declaration.name, declaration.input.parse(input), value);
      queryClient.setQueryData(queryKeyOf(declaration, input), { ok: true, value });
    },
    [preview, queryClient],
  );
  return preview === null || preview === undefined ? null : write;
}
