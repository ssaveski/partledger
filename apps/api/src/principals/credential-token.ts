import { credentialKindSchema, type CredentialKind, type PresentedCredential } from '@partledger/db';

/**
 * The bearer format for every credential kind, following KTD21's supplier-link token:
 * `<prefix>_<public id>_<secret>`, sent as `Authorization: Bearer <token>`. The prefix names
 * the kind, so a listener refuses another kind before any lookup; the id is the credential's
 * uuid and the secret its 43-character base64url value. Staff sessions move to a cookie (U7)
 * and supplier links to a cookie exchange (U17); both keep this resolution path.
 */
export const credentialTokenPrefixes = {
  staff_session: 'pls',
  supplier_link: 'plk',
  drop_credential: 'pld',
  platform_operator: 'plo',
} as const satisfies Record<CredentialKind, string>;

const tokenPattern =
  /^Bearer (pls|plk|pld|plo)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

const kindByPrefix = new Map<string, CredentialKind>(
  Object.entries(credentialTokenPrefixes).map(([kind, prefix]) => [prefix, credentialKindSchema.parse(kind)]),
);

export function formatCredentialToken(kind: CredentialKind, id: string, secret: string): string {
  return `${credentialTokenPrefixes[kind]}_${id}_${secret}`;
}

/** Parses an `Authorization` header; anything malformed is `null`, which the caller answers with the uniform 401. */
export function parseAuthorizationHeader(header: string | undefined): PresentedCredential | null {
  if (header === undefined) {
    return null;
  }
  const match = tokenPattern.exec(header);
  if (match === null) {
    return null;
  }
  const [, prefix = '', id = '', secret = ''] = match;
  const kind = kindByPrefix.get(prefix);
  return kind === undefined ? null : { kind, id, secret };
}
