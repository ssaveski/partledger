import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { failure, success, type Result } from '@partledger/domain';

/**
 * The egress allowlist for AI calls (KTD25). Every outbound request of a provider goes through
 * `guardedFetch`: HTTPS on the default port to one of the hosts this call's configuration
 * allows, with no credentials in the URL and no redirects, and only when every address the
 * host resolves to is public. A private, loopback, link-local or cloud-metadata address is
 * refused, so neither a configuration nor a DNS answer can turn an AI call into a request
 * inside the region's network.
 */

export type EgressRefusal =
  | 'malformed_url'
  | 'not_https'
  | 'port_not_allowed'
  | 'credentials_in_url'
  | 'address_literal'
  | 'host_not_allowed'
  | 'unresolvable'
  | 'private_address';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type Resolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** What an AI call reaches the network with; tests replace both, so no call ever leaves the process. */
export interface EgressNetwork {
  readonly resolve: Resolver;
  readonly fetch: FetchFunction;
}

export const systemEgressNetwork: EgressNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  fetch: (input, init) => fetch(input, init),
};

const nonPublic = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  // Carrier-grade NAT, which also holds some clouds' metadata services (100.100.100.200).
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  // Link-local, which holds the metadata service of most clouds (169.254.169.254).
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  // Unique local addresses, which hold IPv6 metadata services (fd00:ec2::254).
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !nonPublic.check(address, 'ipv4');
  }
  if (family === 6) {
    const mapped = mappedIpv4.exec(address)?.[1];
    if (mapped !== undefined) {
      return isPublicAddress(mapped);
    }
    // The mapped range in its hexadecimal form, such as ::ffff:a9fe:a9fe.
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(address)) {
      return false;
    }
    return !nonPublic.check(address, 'ipv6');
  }
  return false;
}

/** Checks one request URL against the hosts a configuration allows. */
export async function checkEgress(
  target: string,
  allowedHosts: ReadonlySet<string>,
  resolve: Resolver,
): Promise<Result<URL, EgressRefusal>> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return failure('malformed_url');
  }
  if (url.protocol !== 'https:') {
    return failure('not_https');
  }
  if (url.port !== '' && url.port !== '443') {
    return failure('port_not_allowed');
  }
  if (url.username !== '' || url.password !== '') {
    return failure('credentials_in_url');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0) {
    return failure('address_literal');
  }
  if (!allowedHosts.has(hostname)) {
    return failure('host_not_allowed');
  }
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return failure('unresolvable');
  }
  if (addresses.length === 0) {
    return failure('unresolvable');
  }
  if (!addresses.every((resolved) => isPublicAddress(resolved.address))) {
    return failure('private_address');
  }
  return success(url);
}

export class EgressBlockedError extends Error {
  readonly refusal: EgressRefusal;

  constructor(refusal: EgressRefusal) {
    super(`The AI call's request was refused by the egress allowlist: ${refusal}`);
    this.name = 'EgressBlockedError';
    this.refusal = refusal;
  }
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/** A `fetch` for one AI call that only reaches `allowedHosts`, and never follows a redirect. */
export function guardedFetch(allowedHosts: ReadonlySet<string>, network: EgressNetwork): FetchFunction {
  return async (input, init) => {
    const checked = await checkEgress(urlOf(input), allowedHosts, network.resolve);
    if (!checked.ok) {
      throw new EgressBlockedError(checked.error);
    }
    return network.fetch(input, { ...init, redirect: 'error' });
  };
}
