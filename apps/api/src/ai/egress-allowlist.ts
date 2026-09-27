import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { failure, success, type Result } from '@partledger/domain';
import { Agent } from 'undici';

/**
 * The egress allowlist for AI calls (KTD25). Every outbound request of a provider goes through
 * `guardedFetch`: HTTPS on the default port to one of the hosts this call's configuration
 * allows, with no credentials in the URL and no redirects, and only when every address the
 * host resolves to is public. A private, loopback, link-local or cloud-metadata address, or an
 * IPv6 address that embeds one, is refused. The connection is then made only to the addresses
 * that were checked: the system network's dispatcher never resolves the name again, so a DNS
 * answer that changes between the check and the connection is never used.
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
  /** Sends a request that passed the allowlist, connecting only to `addresses`, which were checked. */
  readonly fetch: (
    input: string | URL | Request,
    init: RequestInit,
    addresses: readonly ResolvedAddress[],
  ) => Promise<Response>;
}

export class NoPublicAddressError extends Error {
  constructor() {
    super('The AI call has no checked public address to connect to');
    this.name = 'NoPublicAddressError';
  }
}

/**
 * The name lookup a connection uses: the addresses checked before the request, checked again,
 * and never a fresh DNS answer.
 */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  const pinned = addresses.filter((resolved) => isPublicAddress(resolved.address));
  return (_hostname, options, callback) => {
    const [first] = pinned;
    if (first === undefined) {
      callback(new NoPublicAddressError(), '', 0);
      return;
    }
    if (options.all === true) {
      callback(
        null,
        pinned.map((resolved) => ({ address: resolved.address, family: resolved.family })),
      );
      return;
    }
    callback(null, first.address, first.family);
  };
}

export const systemEgressNetwork: EgressNetwork = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  fetch: (input, init, addresses) => {
    // One dispatcher per request, whose connections close soon after it, so the pinned addresses
    // never serve another request.
    const dispatcher = new Agent({
      connect: { lookup: pinnedLookup(addresses) },
      keepAliveTimeout: 1_000,
      keepAliveMaxTimeout: 1_000,
    });
    // The global fetch accepts the installed undici's dispatcher; the two type packages differ.
    return fetch(input, Object.assign({ ...init }, { dispatcher }));
  },
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
  // IPv4-compatible addresses, and the unspecified and loopback addresses with them.
  ['::', 96],
  ['::1', 128],
  // IPv4-translated addresses. IPv4-mapped ones (::ffff:0:0/96) are checked as the IPv4 address
  // they carry, in `isPublicAddress`: a BlockList rule for them would match every IPv4 address.
  ['::ffff:0:0:0', 96],
  // Teredo and 6to4, which carry an IPv4 address inside.
  ['2001::', 32],
  ['2002::', 16],
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
): Promise<Result<{ readonly url: URL; readonly addresses: readonly ResolvedAddress[] }, EgressRefusal>> {
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
  return success({ url, addresses });
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
    return network.fetch(input, { ...init, redirect: 'error' }, checked.value.addresses);
  };
}
