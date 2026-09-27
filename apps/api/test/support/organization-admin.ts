import { z } from 'zod';

import { realmName, type StartedKeycloak } from './keycloak';

/**
 * A test-only service account for Keycloak's organization endpoints. Keycloak 26.4 guards
 * adding and removing organization members, and creating organizations, with the
 * `realm-management` role `manage-realm`; the shipped realm does not grant it to the API's
 * service account until the owner decides to (see docs/runbooks/keycloak.md). Tests that
 * exercise invitations, removals and provisioning against a real Keycloak use this client
 * instead, created per run with a generated secret and never shipped.
 */
export const testOrganizationAdminClientId = 'partledger-test-organization-admin';

const idRows = z.array(z.object({ id: z.string() }));
const roleRows = z.array(z.object({ id: z.string(), name: z.string() }));
const serviceAccount = z.object({ id: z.string() });

export async function createTestOrganizationAdmin(keycloak: StartedKeycloak): Promise<string> {
  const { admin } = keycloak;
  const created = await admin.request('POST', `/${realmName}/clients`, {
    clientId: testOrganizationAdminClientId,
    publicClient: false,
    serviceAccountsEnabled: true,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
  });
  if (created.status !== 201) {
    throw new Error(`Keycloak refused to create the test organization admin: ${created.status}`);
  }
  const [client] = idRows.parse(
    await admin.json(`/${realmName}/clients?clientId=${encodeURIComponent(testOrganizationAdminClientId)}`),
  );
  const [realmManagement] = idRows.parse(await admin.json(`/${realmName}/clients?clientId=realm-management`));
  if (client === undefined || realmManagement === undefined) {
    throw new Error('The test organization admin or realm-management is missing');
  }
  const account = serviceAccount.parse(await admin.json(`/${realmName}/clients/${client.id}/service-account-user`));
  const roles = roleRows
    .parse(await admin.json(`/${realmName}/clients/${realmManagement.id}/roles`))
    .filter((role) => ['manage-users', 'view-users', 'manage-realm'].includes(role.name));
  const mapped = await admin.request(
    'POST',
    `/${realmName}/users/${account.id}/role-mappings/clients/${realmManagement.id}`,
    roles,
  );
  if (mapped.status !== 204) {
    throw new Error(`Keycloak refused the test organization admin's roles: ${mapped.status}`);
  }
  return admin.regenerateClientSecret(testOrganizationAdminClientId);
}
