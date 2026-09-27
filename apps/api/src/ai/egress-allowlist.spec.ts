import { describe, expect, it } from 'vitest';

import {
  checkEgress,
  EgressBlockedError,
  guardedFetch,
  isPublicAddress,
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
        sent.push(init ?? {});
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
});
