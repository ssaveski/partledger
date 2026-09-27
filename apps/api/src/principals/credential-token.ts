import { credentialKindSchema, type CredentialKind, type PresentedCredential } from '@partledger/db';

/**
 * The token format for every credential kind, following KTD21's supplier-link token:
 * `<prefix>_<public id>_<secret>`. The prefix names the kind, so a listener refuses another
 * kind before any lookup; the id is the credential's uuid and the secret its 43-character
 * base64url value. Staff sessions travel in the `__Host-` session cookie (U7); the other
 * kinds are sent as `Authorization: Bearer <token>` (supplier links move to a cookie exchange
 * in U17). Every kind keeps this resolution path.
 */
export const credentialTokenPrefixes = {
  staff_session: 'pls',
  supplier_link: 'plk',
  drop_credential: 'pld',
  platform_operator: 'plo',
} as const satisfies Record<CredentialKind, string>;

const tokenPattern =
  /^(pls|plk|pld|plo)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

const kindByPrefix = new Map<string, CredentialKind>(
  Object.entries(credentialTokenPrefixes).map(([kind, prefix]) => [prefix, credentialKindSchema.parse(kind)]),
);

export function formatCredentialToken(kind: CredentialKind, id: string, secret: string): string {
  return `${credentialTokenPrefixes[kind]}_${id}_${secret}`;
}

/** Parses a bare token; anything malformed is `null`, which the caller answers with the uniform 401. */
export function parseCredentialToken(token: string): PresentedCredential | null {
  const match = tokenPattern.exec(token);
  if (match === null) {
    return null;
  }
  const [, prefix = '', id = '', secret = ''] = match;
  const kind = kindByPrefix.get(prefix);
  return kind === undefined ? null : { kind, id, secret };
}

/** Parses an `Authorization` header; anything malformed is `null`, which the caller answers with the uniform 401. */
export function parseAuthorizationHeader(header: string | undefined): PresentedCredential | null {
  if (header?.startsWith('Bearer ') !== true) {
    return null;
  }
  return parseCredentialToken(header.slice('Bearer '.length));
}
