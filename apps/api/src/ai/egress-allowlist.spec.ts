import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import {
  checkEgress,
  EgressBlockedError,
  guardedFetch,
  isPublicAddress,
  pinnedLookup,
  systemEgressNetwork,
  type ResolvedAddress,
  type EgressNetwork,
  type Resolver,
} from './egress-allowlist';

const allowed = new Set(['api.anthropic.com']);

function resolvingTo(...addresses: string[]): Resolver {
  return () => Promise.resolve(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

const publicResolver = resolvingTo('160.79.104.10');

describe('the AI egress allowlist', () => {
  it('lets a request through to an allowed host that resolves to public addresses', async () => {
    const checked = await checkEgress('https://api.anthropic.com/v1/messages', allowed, publicResolver);
    expect(checked.ok).toBe(true);
  });

  it('blocks a request to a cloud metadata address, however it is written', async () => {
    expect(await checkEgress('http://169.254.169.254/latest/meta-data/', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'not_https',
    });
    expect(await checkEgress('https://169.254.169.254/latest/meta-data/', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'address_literal',
    });
    expect(await checkEgress('https://[fd00:ec2::254]/latest/meta-data/', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'address_literal',
    });
  });

  it('blocks an allowed host whose name resolves to a metadata or private address', async () => {
    for (const address of [
      '169.254.169.254',
      '100.100.100.200',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.10',
      '127.0.0.1',
      '0.0.0.0',
      'fd00:ec2::254',
      '::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe',
    ]) {
      expect(await checkEgress('https://api.anthropic.com/v1/messages', allowed, resolvingTo(address))).toEqual({
        ok: false,
        error: 'private_address',
      });
    }
    expect(
      await checkEgress('https://api.anthropic.com/v1/messages', allowed, resolvingTo('160.79.104.10', '10.0.0.8')),
    ).toEqual({ ok: false, error: 'private_address' });
  });

  it('blocks a host that is not on the allowlist, another port, and credentials in the URL', async () => {
    expect(await checkEgress('https://attacker.example/v1', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'host_not_allowed',
    });
    expect(await checkEgress('https://api.anthropic.com.attacker.example/v1', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'host_not_allowed',
    });
    expect(await checkEgress('https://api.anthropic.com:8443/v1', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'port_not_allowed',
    });
    expect(await checkEgress('https://user:secret@api.anthropic.com/v1', allowed, publicResolver)).toEqual({
      ok: false,
      error: 'credentials_in_url',
    });
    expect(await checkEgress('not a url', allowed, publicResolver)).toEqual({ ok: false, error: 'malformed_url' });
  });

  it('blocks a host that does not resolve', async () => {
    const failing: Resolver = () => Promise.reject(new Error('ENOTFOUND'));
    expect(await checkEgress('https://api.anthropic.com/v1', allowed, failing)).toEqual({
      ok: false,
      error: 'unresolvable',
    });
    expect(await checkEgress('https://api.anthropic.com/v1', allowed, resolvingTo())).toEqual({
      ok: false,
      error: 'unresolvable',
    });
  });

  it('classifies public and non-public addresses', () => {
    expect(isPublicAddress('160.79.104.10')).toBe(true);
    expect(isPublicAddress('2607:6bc0::10')).toBe(true);
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('not-an-address')).toBe(false);
  });

  it('never sends a blocked request, and forbids redirects on an allowed one', async () => {
    const sent: RequestInit[] = [];
    const network: EgressNetwork = {
      resolve: resolvingTo('169.254.169.254'),
      fetch: (_input, init) => {
        sent.push(init);
        return Promise.resolve(new Response('{}'));
      },
    };
    await expect(guardedFetch(allowed, network)('https://api.anthropic.com/v1/messages')).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    expect(sent).toEqual([]);
    await guardedFetch(allowed, { ...network, resolve: publicResolver })('https://api.anthropic.com/v1/messages', {
      method: 'POST',
    });
    expect(sent).toEqual([{ method: 'POST', redirect: 'error' }]);
  });

  it('treats IPv6 ranges that embed an IPv4 address as non-public', () => {
    for (const address of [
      '2002:a9fe:a9fe::1',
      '2001:0:4136:e378:8000:63bf:3fff:fdd2',
      '::a9fe:a9fe',
      '::',
      '::ffff:a9fe:a9fe',
      '::ffff:0:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    expect(isPublicAddress('2607:6bc0::10')).toBe(true);
  });

  it('connects only to the addresses checked at resolution, never to a later DNS answer', async () => {
    const answers: (readonly ResolvedAddress[])[] = [
      [{ address: '160.79.104.10', family: 4 }],
      [{ address: '169.254.169.254', family: 4 }],
    ];
    let resolutions = 0;
    const connectedTo: string[] = [];
    const network: EgressNetwork = {
      resolve: () => Promise.resolve(answers[Math.min(resolutions++, answers.length - 1)] ?? []),
      fetch: (_input, _init, addresses) => {
        const lookup = pinnedLookup(addresses);
        lookup('api.anthropic.com', {}, (_error, address) => {
          connectedTo.push(typeof address === 'string' ? address : address.map((entry) => entry.address).join(','));
        });
        lookup('api.anthropic.com', { all: true }, (_error, address) => {
          connectedTo.push(typeof address === 'string' ? address : address.map((entry) => entry.address).join(','));
        });
        return Promise.resolve(new Response('{}'));
      },
    };
    await guardedFetch(allowed, network)('https://api.anthropic.com/v1/messages');
    expect(resolutions).toBe(1);
    expect(connectedTo).toEqual(['160.79.104.10', '160.79.104.10']);
  });

  it('never connects when no checked address is public, even to a name that resolves locally', async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(
        systemEgressNetwork.fetch(`http://localhost:${port}/`, {}, [{ address: '127.0.0.1', family: 4 }]),
      ).rejects.toThrow();
      await expect(systemEgressNetwork.fetch(`http://localhost:${port}/`, {}, [])).rejects.toThrow();
      expect(connections).toBe(0);
      // The same request without the pinned dispatcher does reach the local server.
      await fetch(`http://localhost:${port}/`).catch(() => undefined);
      expect(connections).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
