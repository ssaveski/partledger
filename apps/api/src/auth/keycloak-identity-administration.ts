import { failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import type { IdentityAdministration } from './identity-administration';

export interface KeycloakAdministrationOptions {
  /** The realm URL, such as `https://id.example/realms/partledger`. */
  readonly issuer: string;
  /** The service-account client; its scope holds only `view-users` and `manage-users`. */
  readonly clientId: string;
  readonly clientSecret: string;
}

const tokenSchema = z.object({ access_token: z.string().min(1) });

const organizationsSchema = z.array(z.object({ attributes: z.record(z.string(), z.array(z.string())).optional() }));

const credentialsSchema = z.array(z.object({ id: z.string().min(1), type: z.string() }));

const requestTimeoutMilliseconds = 5000;

class AdministrationUnavailable extends Error {
  constructor(what: string) {
    super(`The identity provider's admin API could not ${what}`);
    this.name = 'AdministrationUnavailable';
  }
}

/** The realm's admin API sits at `/admin/realms/<realm>` beside the issuer's `/realms/<realm>`. */
export function adminBaseOf(issuer: string): string {
  const url = new URL(issuer);
  const marker = url.pathname.lastIndexOf('/realms/');
  if (marker === -1) {
    throw new Error('The issuer is not a Keycloak realm URL');
  }
  url.pathname = `${url.pathname.slice(0, marker)}/admin${url.pathname.slice(marker)}`;
  return url.toString().replace(/\/+$/, '');
}

/**
 * Keycloak's admin API, called with the API's service account (client credentials). Every
 * failure to reach it or an unexpected answer is `unavailable`: the command that needed it
 * refuses and rolls back, and a retry with the same idempotency key repeats it safely.
 */
export class KeycloakIdentityAdministration implements IdentityAdministration {
  private readonly adminBase: string;

  constructor(private readonly options: KeycloakAdministrationOptions) {
    this.adminBase = adminBaseOf(options.issuer);
  }

  async tenantsOf(userId: string): Promise<Result<readonly string[], 'unavailable'>> {
    return this.attempt(async (token) => {
      const response = await this.call(
        token,
        'GET',
        `/organizations/members/${encodeURIComponent(userId)}/organizations?briefRepresentation=false`,
      );
      if (response.status === 404) {
        return [];
      }
      const organizations = organizationsSchema.parse(await this.expectOk(response, 'read organizations'));
      return organizations.flatMap((organization) => organization.attributes?.tenant_id ?? []);
    });
  }

  async resetSecondFactor(userId: string): Promise<Result<{ readonly removedFactors: number }, 'unavailable'>> {
    return this.attempt(async (token) => {
      const user = `/users/${encodeURIComponent(userId)}`;
      const credentials = credentialsSchema.parse(
        await this.expectOk(await this.call(token, 'GET', `${user}/credentials`), 'read credentials'),
      );
      const secondFactors = credentials.filter((credential) => credential.type === 'otp');
      for (const credential of secondFactors) {
        const removed = await this.call(token, 'DELETE', `${user}/credentials/${encodeURIComponent(credential.id)}`);
        // A factor removed meanwhile by a concurrent reset is already gone.
        if (!removed.ok && removed.status !== 404) {
          throw new AdministrationUnavailable('remove a credential');
        }
      }
      await this.expectOk(await this.call(token, 'POST', `${user}/logout`), 'end sessions');
      return { removedFactors: secondFactors.length };
    });
  }

  private async attempt<Value>(work: (token: string) => Promise<Value>): Promise<Result<Value, 'unavailable'>> {
    try {
      return success(await work(await this.serviceToken()));
    } catch {
      return failure('unavailable');
    }
  }

  private async serviceToken(): Promise<string> {
    const credentials = `${encodeURIComponent(this.options.clientId)}:${encodeURIComponent(this.options.clientSecret)}`;
    const response = await fetch(`${this.options.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    return tokenSchema.parse(await this.expectOk(response, 'issue a service token')).access_token;
  }

  private call(token: string, method: string, path: string): Promise<Response> {
    return fetch(`${this.adminBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  }

  private async expectOk(response: Response, what: string): Promise<unknown> {
    if (!response.ok) {
      throw new AdministrationUnavailable(what);
    }
    const text = await response.text();
    const body: unknown = text === '' ? null : JSON.parse(text);
    return body;
  }
}
