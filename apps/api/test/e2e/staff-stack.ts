import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { insertTenant, startTestDatabase } from '@partledger/db/testing';

import { e2eStaffUserFile, e2eStaffUserSchema, staffStackPorts } from './staff-stack-contract.ts';
import { adminClientId, clientId, startKeycloak, syntheticPassword } from '../support/keycloak.ts';

/**
 * The stack the staff app's end-to-end sign-in test runs against, started by Playwright as a
 * web server: PostgreSQL 18 and Keycloak 26 in containers, one synthetic tenant with its
 * organization and one synthetic user, and the built API on the ports the staff app's `/api`
 * proxy expects. The user's generated credentials go to a file only the test reads. Runs
 * under Node directly, after `pnpm --filter @partledger/api build`.
 */
const entryPoint = join(import.meta.dirname, '..', '..', 'dist', 'main.js');

const database = await startTestDatabase();
const keycloak = await startKeycloak();
let api: ChildProcess | undefined;

async function stop(): Promise<void> {
  api?.kill('SIGTERM');
  await rm(e2eStaffUserFile, { force: true });
  await Promise.allSettled([keycloak.stop(), database.stop()]);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(0));
  });
}

try {
  const superuser = await database.connect('superuser');
  const tenantId = await insertTenant(superuser, 'synthetic-e2e');
  await superuser.end();
  const organizationId = await keycloak.admin.createOrganization('synthetic-e2e', tenantId);
  const user = e2eStaffUserSchema.parse({
    username: 'synthetic.e2e.buyer',
    email: 'synthetic.e2e.buyer@synthetic.test',
    password: syntheticPassword(),
    tenantId,
  });
  const userId = await keycloak.admin.createUser(user);
  await keycloak.admin.addMember(organizationId, userId);
  await writeFile(e2eStaffUserFile, JSON.stringify(user), { mode: 0o600 });

  api = spawn(process.execPath, ['--enable-source-maps', entryPoint], {
    env: {
      TZ: 'UTC',
      NODE_ENV: 'test',
      STAFF_PORT: String(staffStackPorts.staff),
      PORTAL_PORT: String(staffStackPorts.portal),
      DROP_PORT: String(staffStackPorts.drop),
      OPERATOR_PORT: String(staffStackPorts.operator),
      DATABASE_URL: database.connectionString('pl_app'),
      JOBS_DATABASE_URL: database.connectionString('pl_job_runner'),
      JOBS_WORKERS: 'off',
      STAFF_APP_ORIGIN: 'http://127.0.0.1:5173',
      KEYCLOAK_ISSUER: keycloak.issuer,
      KEYCLOAK_CLIENT_ID: clientId,
      KEYCLOAK_CLIENT_SECRET: await keycloak.admin.regenerateClientSecret(clientId),
      KEYCLOAK_ADMIN_CLIENT_SECRET: await keycloak.admin.regenerateClientSecret(adminClientId),
      SESSION_TOKEN_KEY: randomBytes(32).toString('base64'),
    },
    stdio: 'inherit',
  });
  api.once('exit', (code) => {
    if (code !== null && code !== 0) {
      void stop().finally(() => process.exit(code));
    }
  });
} catch (error) {
  console.error(error);
  await stop();
  process.exit(1);
}
