import type { QueryDeclaration } from '@partledger/contracts';
import { createApiClient, createFixtureAdapter, createHttpAdapter, type ApiClient } from '@partledger/contracts/client';
import { fixtureHandlers } from '@partledger/contracts/fixtures';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { z } from 'zod';

export const adapterKinds = ['fixture', 'http'] as const;

export type AdapterKind = (typeof adapterKinds)[number];

/** `VITE_API_ADAPTER=http` targets the API through the same-origin `/api` proxy; anything else serves fixtures. */
export function adapterKindFrom(value: unknown): AdapterKind {
  return z.enum(adapterKinds).catch('fixture').parse(value);
}

// Enough for the loading state to register when a person clicks through the fixtures.
const fixtureLatencyMs = 250;

export function createClient(kind: AdapterKind): ApiClient {
  if (kind === 'http') {
    return createApiClient(createHttpAdapter({ fetch: (url, init) => window.fetch(url, init) }));
  }
  return createApiClient(
    createFixtureAdapter(fixtureHandlers, {
      latency: () =>
        new Promise((resolve) => {
          window.setTimeout(resolve, fixtureLatencyMs);
        }),
    }),
  );
}

interface ApiContextValue {
  readonly client: ApiClient;
  readonly kind: AdapterKind;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ client, kind, children }: ApiContextValue & { children: ReactNode }) {
  return <ApiContext value={{ client, kind }}>{children}</ApiContext>;
}

function useApiContext(): ApiContextValue {
  const context = useContext(ApiContext);
  if (context === null) {
    throw new Error('useApiQuery needs an ApiProvider');
  }
  return context;
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
