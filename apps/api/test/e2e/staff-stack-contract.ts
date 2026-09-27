import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

/**
 * What the end-to-end staff stack hands the Playwright test: the ports the API listens on
 * (the staff app's dev server proxies `/api` to the staff port) and the synthetic user it
 * created, whose password is generated per run.
 */
export const staffStackPorts = { staff: 3000, portal: 3001, drop: 3002, operator: 3003 } as const;

export const e2eStaffUserFile = join(tmpdir(), 'partledger-e2e-staff-user.json');

export const e2eStaffUserSchema = z.object({
  username: z.string(),
  email: z.string(),
  password: z.string(),
  tenantId: z.uuid(),
  tenantDisplayName: z.string(),
  displayName: z.string(),
});

export type E2eStaffUser = z.infer<typeof e2eStaffUserSchema>;
