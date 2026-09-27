import type { IdentityRegister, RegisterAnswer } from './identity-standing';

export const identityRegisters = Symbol('IdentityRegisters');

/**
 * The registers a supplier's identity is checked against (R10, KTD36): VIES for EU VAT ids,
 * GLEIF for LEIs. An answer never throws: a timeout, an outage or a reply the client cannot
 * read is `unreachable`, which the check records as "not checked".
 */
export interface IdentityRegisters {
  ask(register: IdentityRegister, identifier: string): Promise<RegisterAnswer>;
}

export type RegisterFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RegisterClientOptions {
  /** The register's API base, without a trailing slash. */
  readonly baseUrl: string;
  /** How long one question may take before it counts as unreachable. */
  readonly timeoutMilliseconds: number;
  readonly fetch?: RegisterFetch;
}

export interface RegisterClient {
  check(identifier: string): Promise<RegisterAnswer>;
}

/** Sends each question to its register's client. */
export function registersOf(clients: Readonly<Record<IdentityRegister, RegisterClient>>): IdentityRegisters {
  return { ask: (register, identifier) => clients[register].check(identifier) };
}

/** A GET with the client's time limit; any failure to get a response is `null`. */
export async function fetchWithin(
  options: RegisterClientOptions,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response | null> {
  const send = options.fetch ?? ((target: string, init: RequestInit) => fetch(target, init));
  try {
    return await send(url, { headers, signal: AbortSignal.timeout(options.timeoutMilliseconds) });
  } catch {
    return null;
  }
}

/** The body as JSON, or `null` when it cannot be read in time or is not JSON. */
export async function jsonBodyOf(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}
