import type { EntryAdapter } from '@partledger/contracts';
import type { CredentialKind } from '@partledger/db';

/** Adapters that arrive over HTTP, each on its own listener (KTD30). */
export const httpEntryAdapters = ['staff', 'portal', 'drop', 'operator'] as const satisfies readonly EntryAdapter[];

export type HttpEntryAdapter = (typeof httpEntryAdapters)[number];

/**
 * The credential kinds each listener accepts. Anything else is refused with the uniform 401
 * before a lookup, so a script injected into the portal cannot use a staff session.
 */
export const acceptedCredentialKinds = {
  staff: ['staff_session'],
  portal: ['supplier_link'],
  drop: ['drop_credential'],
  operator: ['platform_operator'],
} as const satisfies Record<HttpEntryAdapter, readonly CredentialKind[]>;

export function acceptsCredentialKind(adapter: HttpEntryAdapter, kind: CredentialKind): boolean {
  const accepted: readonly CredentialKind[] = acceptedCredentialKinds[adapter];
  return accepted.includes(kind);
}
