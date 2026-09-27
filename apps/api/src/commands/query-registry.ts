import { staffAlertsQuery } from '@partledger/contracts';

import { aiQueries } from '../ai/ai-operations';
import { StaffAlertsHandler } from '../notifications/alerts.query';
import { tenantQueries } from '../tenants/tenant-operations';
import { registerQuery, type OperationRegistry, type QueryRegistration } from './handlers';
import { productionCommands } from './command-registry';

/** Every query the API serves in production; modules add theirs as they add commands. */
export const productionQueries: readonly QueryRegistration[] = [
  registerQuery(staffAlertsQuery, StaffAlertsHandler),
  ...tenantQueries,
  ...aiQueries,
];

export const productionRegistry: OperationRegistry = { commands: productionCommands, queries: productionQueries };
