import type { QueryDeclaration } from '@partledger/contracts';
import { createApiClient, createFixtureAdapter, createHttpAdapter, type ApiClient } from '@partledger/contracts/client';
import { exchangeFixtureLink, portalFixtureHandlers } from '@partledger/contracts/fixtures/portal';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { z } from 'zod';

import { createFixtureSessionStore, type FixtureSessionStore } from './fixture-session';

export const adapterKinds = ['fixture', 'http'] as const;

export type AdapterKind = (typeof adapterKinds)[number];

/** `VITE_API_ADAPTER=http` targets the API through the portal's same-origin `/api` proxy; anything else serves fixtures. */
export function adapterKindFrom(value: unknown): AdapterKind {
  return z.enum(adapterKinds).catch('fixture').parse(value);
}

/**
 * What exchanging a link's secret for a session gave: a session, the uniform refusal of a wrong,
 * expired or revoked link (KTD21), or no answer at all.
 */
export type ExchangeOutcome = 'opened' | 'refused' | 'unavailable';

/** The portal's way to the API: typed reads, and the one POST that turns a link into a session. */
export interface PortalConnection {
  readonly kind: AdapterKind;
  readonly client: ApiClient;
  exchange(linkId: string, secret: string): Promise<ExchangeOutcome>;
}

// Enough for the loading state to register when a person clicks through the fixtures.
const fixtureLatencyMs = 250;

function fixtureLatency(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, fixtureLatencyMs);
  });
}

/**
 * Stands in for the exchange U17 builds: the session lives in this tab instead of a `__Host-`
 * cookie, and the fixture handlers serve whichever link it opened.
 */
export function createFixtureConnection(
  store: FixtureSessionStore = createFixtureSessionStore(),
  latency: () => Promise<void> = fixtureLatency,
): PortalConnection {
  return {
    kind: 'fixture',
    client: createApiClient(createFixtureAdapter(portalFixtureHandlers(store.read), { latency })),
    async exchange(linkId, secret) {
      await latency();
      const outcome = exchangeFixtureLink(linkId, secret);
      if (outcome === 'opened') {
        store.open(linkId);
      }
      return outcome;
    },
  };
}

export function createConnection(kind: AdapterKind): PortalConnection {
  if (kind === 'fixture') {
    return createFixtureConnection();
  }
  return {
    kind,
    client: createApiClient(createHttpAdapter({ fetch: (url, init) => window.fetch(url, init) })),
    // U17 adds the exchange endpoint; until then no link can be opened against the API.
    exchange: () => Promise.resolve('unavailable'),
  };
}

const ConnectionContext = createContext<PortalConnection | null>(null);

export function ConnectionProvider({ connection, children }: { connection: PortalConnection; children: ReactNode }) {
  return <ConnectionContext value={connection}>{children}</ConnectionContext>;
}

export function useConnection(): PortalConnection {
  const connection = useContext(ConnectionContext);
  if (connection === null) {
    throw new Error('The portal screens need a ConnectionProvider');
  }
  return connection;
}

/** Query keys are the operation name and its input. */
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
  const { client } = useConnection();
  return useQuery({
    queryKey: queryKeyOf(declaration, input),
    queryFn: () => client.query(declaration, input),
  });
}
