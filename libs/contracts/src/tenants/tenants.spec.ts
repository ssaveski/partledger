import { describe, expect, it } from 'vitest';

import { createApiClient } from '../client/api-client';
import { createFixtureAdapter } from '../client/fixture-adapter';
import { createTenantFixtures, fixtureSignedInUserId } from '../fixtures/tenants';
import {
  currentMemberQuery,
  grantRoleCommand,
  inviteMemberCommand,
  listMembersQuery,
  removeMemberCommand,
} from './members';
import { aiPolicySchema, provisionTenantInputSchema } from './tenants';

const provisioning = {
  slug: 'maple-ridge-components',
  displayName: 'Maple Ridge Components',
  region: 'ca',
  enabledPacks: ['canada'],
  supplierListSource: 'erp',
  baseCurrency: 'CAD',
  aiPolicy: { provider: 'platform_default', keyReference: null, regionRestricted: false },
  firstAdmin: { email: 'Avery.Lindqvist@Synthetic.Test', displayName: 'Avery Lindqvist' },
};

describe('tenant provisioning input', () => {
  it('accepts a tenant and lowercases its first administrator’s email', () => {
    const parsed = provisionTenantInputSchema.parse(provisioning);
    expect(parsed.firstAdmin.email).toBe('avery.lindqvist@synthetic.test');
  });

  it('refuses a slug that is not lowercase letters, digits and hyphens, and a pack listed twice', () => {
    expect(provisionTenantInputSchema.safeParse({ ...provisioning, slug: 'Maple Ridge' }).success).toBe(false);
    expect(provisionTenantInputSchema.safeParse({ ...provisioning, enabledPacks: ['canada', 'canada'] }).success).toBe(
      false,
    );
  });

  it('has a key reference exactly when the tenant brings its own AI provider', () => {
    expect(
      aiPolicySchema.safeParse({ provider: 'anthropic', keyReference: null, regionRestricted: true }).success,
    ).toBe(false);
    expect(
      aiPolicySchema.safeParse({ provider: 'platform_default', keyReference: 'kms/key', regionRestricted: true })
        .success,
    ).toBe(false);
    expect(
      aiPolicySchema.safeParse({ provider: 'mistral', keyReference: 'kms/tenant-key', regionRestricted: true }).success,
    ).toBe(true);
  });
});

describe('the synthetic tenant in the preview', () => {
  function client() {
    const fixtures = createTenantFixtures(() => new Date('2026-09-27T10:00:00.000Z'));
    return createApiClient(
      createFixtureAdapter(fixtures.queries, { commands: fixtures.commands, session: fixtures.session }),
    );
  }

  it('is signed in as a tenant administrator until the person signs out', async () => {
    const preview = client();
    const current = await preview.query(currentMemberQuery, {});
    expect(current.ok && current.value.member.roles).toEqual(['tenant_admin', 'buyer']);
    expect((await preview.session()).ok).toBe(true);
    await preview.signOut();
    expect(await preview.session()).toEqual({ ok: false, failure: { kind: 'unauthenticated' } });
  });

  it('shows an invited member and role changes in the member list until the page reloads', async () => {
    const preview = client();
    const invited = await preview.command(
      inviteMemberCommand,
      { email: 'kai.berglund@synthetic.test', displayName: 'Kai Berglund' },
      'key-0000000000000001',
    );
    expect(invited.ok).toBe(true);
    if (!invited.ok) {
      return;
    }
    expect(
      (await preview.command(grantRoleCommand, { userId: invited.value.userId, role: 'buyer' }, 'key-0000000000000002'))
        .ok,
    ).toBe(true);
    const listed = await preview.query(listMembersQuery, {});
    expect(listed.ok && listed.value.members.find((member) => member.userId === invited.value.userId)?.roles).toEqual([
      'buyer',
    ]);
  });

  it('refuses to remove the last tenant administrator', async () => {
    const removed = await client().command(
      removeMemberCommand,
      { userId: fixtureSignedInUserId },
      'key-0000000000000003',
    );
    expect(removed).toEqual({
      ok: false,
      failure: {
        kind: 'refused',
        error: 'Conflict',
        message: 'pl.error.conflict.lastTenantAdmin',
        params: {},
      },
    });
  });
});
