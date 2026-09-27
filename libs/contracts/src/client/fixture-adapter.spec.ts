import { describe, expect, it } from 'vitest';

import { fixtureHandlers, fixtureRfqIds } from '../fixtures';
import { approvalPacketQuery, quoteComparisonQuery, rfqDetailQuery, rfqQueries } from '../rfqs/queries';
import { createApiClient } from './api-client';
import { createFixtureAdapter } from './fixture-adapter';

const client = createApiClient(createFixtureAdapter(fixtureHandlers));

/** Resolves after every promise already in flight has had many turns to settle. */
async function settled<Value>(value: Value): Promise<Value> {
  for (let turn = 0; turn < 50; turn += 1) {
    await Promise.resolve();
  }
  return value;
}

const servedScenarios = ['open', 'closed', 'blockedApproval', 'readyApproval', 'draftWithoutSuppliers'] as const;

describe('the fixture adapter', () => {
  it('serves every RFQ scenario of every key-screen read in its declared output shape', async () => {
    for (const declaration of rfqQueries) {
      for (const scenario of servedScenarios) {
        const result = await client.query(declaration, { rfqId: fixtureRfqIds[scenario] });
        expect(result.ok, `${declaration.name} for ${scenario}`).toBe(true);
      }
    }
  });

  it('refuses the no-permission scenario as not permitted', async () => {
    const result = await client.query(rfqDetailQuery, { rfqId: fixtureRfqIds.forbidden });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'refused', error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: {} },
    });
  });

  it('fails the unavailable scenario as the network would', async () => {
    const result = await client.query(quoteComparisonQuery, { rfqId: fixtureRfqIds.unavailable });
    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable' } });
  });

  it('never answers the slow scenario, so the loading state stays', async () => {
    const pending = Symbol('pending');
    const result = await Promise.race([
      client.query(approvalPacketQuery, { rfqId: fixtureRfqIds.slow }),
      settled(pending),
    ]);
    expect(result).toBe(pending);
  });

  it('refuses an RFQ it does not know as not found', async () => {
    const result = await client.query(rfqDetailQuery, { rfqId: '00000000-0000-4000-8000-000000004040' });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'refused', error: 'NotFound', message: 'pl.error.notFound.resource', params: {} },
    });
  });

  it('refuses a query it does not serve as a missing route', async () => {
    const adapter = createFixtureAdapter(fixtureHandlers);
    expect(await adapter.query('rfqs.unknown', {})).toEqual({
      ok: false,
      failure: { kind: 'refused', error: 'NotFound', message: 'pl.error.notFound.route', params: {} },
    });
  });

  it('refuses input that the declaration would not accept', async () => {
    const adapter = createFixtureAdapter(fixtureHandlers);
    const result = await adapter.query('rfqs.detail', { rfqId: 'RFQ-1042' });
    expect(result.ok).toBe(false);
  });

  it('hands out a copy of the fixture, so a screen cannot change what the next read returns', async () => {
    const first = await client.query(rfqDetailQuery, { rfqId: fixtureRfqIds.open });
    if (!first.ok) {
      throw new Error('The open RFQ should be served');
    }
    first.value.suppliers.length = 0;
    const second = await client.query(rfqDetailQuery, { rfqId: fixtureRfqIds.open });
    expect(second.ok && second.value.suppliers.length).toBe(4);
  });

  it('waits for its latency before answering', async () => {
    let released = false;
    const adapter = createFixtureAdapter(fixtureHandlers, {
      latency: async () => {
        await settled(undefined);
        released = true;
      },
    });
    await adapter.query('rfqs.detail', { rfqId: fixtureRfqIds.open });
    expect(released).toBe(true);
  });
});
