import { Logger } from '@nestjs/common';
import { failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import type { IdentityOrganizations, NewPerson, OrganizationRefusal } from './identity-organizations';

export interface KeycloakAdminOptions {
  /** The realm URL, which is also its token issuer, such as `https://id.example/realms/partledger`. */
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() });

const requestTimeoutMilliseconds = 5000;
/** Renew the service account's token this long before it expires. */
const tokenRenewalMarginMilliseconds = 30_000;

class KeycloakUnavailableError extends Error {
  constructor(what: string) {
    super(`Keycloak could not ${what}`);
    this.name = 'KeycloakUnavailableError';
  }
}

/** The admin API of the realm the issuer names: `/realms/<realm>` becomes `/admin/realms/<realm>`. */
export function adminBaseUrl(issuer: string): string {
  const url = new URL(issuer);
  const match = /^(.*)\/realms\/([^/]+)$/.exec(url.pathname);
  if (match === null) {
    throw new Error('The Keycloak issuer does not name a realm');
  }
  return `${url.origin}${match[1] ?? ''}/admin/realms/${match[2] ?? ''}`;
}

/**
 * Keycloak organizations through the API's service account (KTD20). The account holds
 * `manage-users`, `view-users` and `manage-realm` in the region's realm: Keycloak 26 guards
 * its organization endpoints with `manage-realm`. This adapter calls only the organization and
 * user endpoints below and never assigns a realm or client role.
 */
export class KeycloakOrganizations implements IdentityOrganizations {
  private readonly logger = new Logger('KeycloakOrganizations');
  private readonly adminBase: string;
  private token: { readonly value: string; readonly expiresAt: number } | undefined;

  constructor(private readonly options: KeycloakAdminOptions) {
    this.adminBase = adminBaseUrl(options.issuer);
  }

  async createOrganization(organization: {
    readonly alias: string;
    readonly name: string;
    readonly tenantId: string;
  }): Promise<Result<string, OrganizationRefusal>> {
    return this.created('create an organization', '/organizations', {
      name: organization.name,
      alias: organization.alias,
      enabled: true,
      // Keycloak requires at least one domain; it is not verified and routes no one.
      domains: [{ name: `${organization.alias}.tenants.partledger.invalid`, verified: false }],
      attributes: { tenant_id: [organization.tenantId] },
    });
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    await this.bestEffort('delete an organization', 'DELETE', `/organizations/${encodeURIComponent(organizationId)}`);
  }

  async createMember(organizationId: string, person: NewPerson): Promise<Result<string, OrganizationRefusal>> {
    const user = await this.created('create a user', '/users', {
      username: person.email,
      email: person.email,
      emailVerified: false,
      enabled: true,
      firstName: person.displayName,
      // The person sets a password on first sign-in; the invitation email follows with U34.
      requiredActions: ['UPDATE_PASSWORD'],
    });
    if (!user.ok) {
      return user;
    }
    const added = await this.send(
      'add an organization member',
      'POST',
      `/organizations/${encodeURIComponent(organizationId)}/members`,
      user.value,
    );
    if (added.ok && added.value.status === 201) {
      return user;
    }
    await this.deleteUser(user.value);
    return failure('unavailable');
  }

  async deleteUser(userId: string): Promise<void> {
    await this.bestEffort('delete a user', 'DELETE', `/users/${encodeURIComponent(userId)}`);
  }

  async removeMember(organizationId: string, userId: string): Promise<Result<void, 'unavailable'>> {
    const removed = await this.send(
      'remove an organization member',
      'DELETE',
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    );
    // Not found means the member is already gone, which is the outcome asked for.
    if (!removed.ok || (removed.value.status !== 204 && removed.value.status !== 404)) {
      return failure('unavailable');
    }
    await this.bestEffort('end a user’s sessions', 'POST', `/users/${encodeURIComponent(userId)}/logout`);
    return success(undefined);
  }

  /** Creates a resource and returns the id Keycloak names in its `Location` header. */
  private async created(what: string, path: string, body: unknown): Promise<Result<string, OrganizationRefusal>> {
    const response = await this.send(what, 'POST', path, body);
    if (!response.ok) {
      return response;
    }
    if (response.value.status === 409) {
      return failure('already_exists');
    }
    const id = response.value.headers.get('location')?.split('/').pop();
    if (response.value.status !== 201 || id === undefined || id === '') {
      this.logger.warn(`Keycloak refused to ${what} (${response.value.status})`);
      return failure('unavailable');
    }
    return success(id);
  }

  private async bestEffort(what: string, method: string, path: string): Promise<void> {
    const response = await this.send(what, method, path);
    if (!response.ok || response.value.status >= 300) {
      this.logger.warn(`Keycloak could not ${what}; an operator should check the realm`);
    }
  }

  private async send(
    what: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result<Response, 'unavailable'>> {
    try {
      const token = await this.accessToken();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      const response = await fetch(`${this.adminBase}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
      if (response.status === 401 || response.status === 403 || response.status >= 500) {
        this.token = undefined;
        throw new KeycloakUnavailableError(what);
      }
      return success(response);
    } catch (error) {
      this.logger.warn(`Keycloak could not ${what}: ${error instanceof Error ? error.name : 'unknown error'}`);
      return failure('unavailable');
    }
  }

  private async accessToken(): Promise<string> {
    if (this.token !== undefined && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    const response = await fetch(`${this.options.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    if (!response.ok) {
      throw new KeycloakUnavailableError('issue a service account token');
    }
    const token = tokenSchema.parse(await response.json());
    this.token = {
      value: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000 - tokenRenewalMarginMilliseconds,
    };
    return token.access_token;
  }
}
