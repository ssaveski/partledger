import { createHash, createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { z } from 'zod';

import { formOn, syntheticPassword, TestBrowser, type StartedKeycloak } from './keycloak';

/**
 * The operator realm in tests (KTD20, R4): synthetic operators with a password and a one-time
 * code, signed in through the realm's browser flow the way an operator's console would, with
 * the authorization code flow and PKCE and a loopback redirect.
 */
export const operatorRealmName = 'partledger-operators';

export const operatorConsoleClientId = 'partledger-operator-console';

export const operatorRealmFile = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'compose',
  'keycloak',
  'operator-realm.json',
);

const loopbackRedirect = 'http://127.0.0.1:49152/operator-callback';

const tokenBody = z.object({ access_token: z.string().min(1) });

export interface SyntheticOperator {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  /** The raw TOTP secret Keycloak holds for the operator. */
  readonly otpSecret: string;
}

/** RFC 6238 with the realm's policy: HMAC-SHA1, six digits, thirty-second steps. */
export function oneTimeCode(secret: string, at: Date = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

export function operatorIssuer(keycloak: StartedKeycloak): string {
  return `${keycloak.baseUrl}/realms/${operatorRealmName}`;
}

export async function createOperator(keycloak: StartedKeycloak): Promise<SyntheticOperator> {
  const username = `operator.${randomBytes(4).toString('hex')}`;
  const password = syntheticPassword();
  const otpSecret = randomBytes(20).toString('hex');
  const response = await keycloak.admin.request('POST', `/${operatorRealmName}/users`, {
    username,
    email: `${username}@synthetic.test`,
    firstName: 'Synthetic',
    lastName: 'Operator',
    enabled: true,
    emailVerified: true,
    credentials: [
      { type: 'password', value: password, temporary: false },
      {
        type: 'otp',
        userLabel: 'synthetic',
        secretData: JSON.stringify({ value: otpSecret }),
        credentialData: JSON.stringify({ subType: 'totp', digits: 6, counter: 0, period: 30, algorithm: 'HmacSHA1' }),
      },
    ],
  });
  const id = response.headers.get('location')?.split('/').pop();
  if (response.status !== 201 || id === undefined) {
    throw new Error(`Keycloak refused to create an operator: ${response.status}`);
  }
  return { id, username, password, otpSecret };
}

export interface OperatorSignIn {
  /** The access token, or `null` when the realm stopped short of issuing a code. */
  readonly accessToken: string | null;
  /** The last page the realm showed. */
  readonly page: string;
}

/**
 * Signs an operator in through the realm's browser flow. With `withCode: false` the operator
 * offers only a password, and the flow must stop at the one-time code form.
 */
export async function signInOperator(
  keycloak: StartedKeycloak,
  operator: SyntheticOperator,
  { withCode = true }: { readonly withCode?: boolean } = {},
): Promise<OperatorSignIn> {
  const browser = new TestBrowser();
  const verifier = randomBytes(32).toString('base64url');
  const authorization = new URL(`${operatorIssuer(keycloak)}/protocol/openid-connect/auth`);
  authorization.search = new URLSearchParams({
    client_id: operatorConsoleClientId,
    response_type: 'code',
    scope: 'openid',
    redirect_uri: loopbackRedirect,
    state: randomBytes(8).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  let page = await (await browser.get(authorization.toString())).text();
  const passwordForm = formOn(page, /login-actions\/authenticate/);
  if (passwordForm === null) {
    return { accessToken: null, page };
  }
  let response = await browser.post(passwordForm.action, {
    ...passwordForm.fields,
    username: operator.username,
    password: operator.password,
  });
  page = await response.text();
  const codeForm = formOn(page, /login-actions\/authenticate/);
  if (!withCode || codeForm === null || response.headers.get('location') !== null) {
    return { accessToken: null, page };
  }
  response = await browser.post(codeForm.action, { ...codeForm.fields, otp: oneTimeCode(operator.otpSecret) });
  const location = response.headers.get('location');
  const code = location === null ? null : new URL(location).searchParams.get('code');
  if (code === null) {
    return { accessToken: null, page: await response.text() };
  }
  const tokens = await fetch(`${operatorIssuer(keycloak)}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: operatorConsoleClientId,
      code,
      redirect_uri: loopbackRedirect,
      code_verifier: verifier,
    }),
  });
  return { accessToken: tokenBody.parse(await tokens.json()).access_token, page: '' };
}
