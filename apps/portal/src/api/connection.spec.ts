import { portalFixtureLinks } from '@partledger/contracts/fixtures/portal';
import { portalSessionQuery } from '@partledger/contracts/portal';
import { describe, expect, it } from 'vitest';

import { adapterKindFrom, createFixtureConnection } from './connection';
import { createFixtureSessionStore } from './fixture-session';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const noLatency = () => Promise.resolve();

describe('choosing the API adapter', () => {
  it('uses the HTTP adapter only when the build asks for it, and the fixtures otherwise', () => {
    expect(adapterKindFrom('http')).toBe('http');
    expect(adapterKindFrom(undefined)).toBe('fixture');
    expect(adapterKindFrom('HTTP')).toBe('fixture');
  });
});

describe('the fixture connection', () => {
  it('starts no session until a link is exchanged, and then serves that link', async () => {
    const storage = memoryStorage();
    const connection = createFixtureConnection(
      createFixtureSessionStore(() => storage),
      noLatency,
    );
    expect(await connection.client.query(portalSessionQuery, {})).toEqual({
      ok: false,
      failure: { kind: 'unauthenticated' },
    });
    expect(storage.length).toBe(0);

    const { linkId, secret } = portalFixtureLinks.sealed;
    expect(await connection.exchange(linkId, secret)).toBe('opened');
    const session = await connection.client.query(portalSessionQuery, {});
    expect(session.ok && session.value.views).toEqual(['outcome', 'submission']);
  });

  it('refuses an expired, a revoked or a wrong link alike and opens no session', async () => {
    const storage = memoryStorage();
    const connection = createFixtureConnection(
      createFixtureSessionStore(() => storage),
      noLatency,
    );
    const { expired, revoked, open, closed } = portalFixtureLinks;
    expect(await connection.exchange(expired.linkId, expired.secret)).toBe('refused');
    expect(await connection.exchange(revoked.linkId, revoked.secret)).toBe('refused');
    expect(await connection.exchange(open.linkId, closed.secret)).toBe('refused');
    expect(storage.length).toBe(0);
  });

  it('keeps the session across a reload of the tab, as the portal cookie will', async () => {
    const storage = memoryStorage();
    const first = createFixtureConnection(
      createFixtureSessionStore(() => storage),
      noLatency,
    );
    await first.exchange(portalFixtureLinks.open.linkId, portalFixtureLinks.open.secret);
    const reloaded = createFixtureConnection(
      createFixtureSessionStore(() => storage),
      noLatency,
    );
    expect((await reloaded.client.query(portalSessionQuery, {})).ok).toBe(true);
  });

  it('still opens a session for the page when session storage is unavailable', async () => {
    const unavailable = (): Storage => {
      throw new Error('Storage is disabled');
    };
    const connection = createFixtureConnection(createFixtureSessionStore(unavailable), noLatency);
    await connection.exchange(portalFixtureLinks.open.linkId, portalFixtureLinks.open.secret);
    expect((await connection.client.query(portalSessionQuery, {})).ok).toBe(true);
  });
});
