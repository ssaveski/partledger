import type { OperationRegistry, QueryRegistration } from './handlers';
import { productionCommands } from './command-registry';

/** Every query the API serves in production; modules add theirs as they add commands. */
export const productionQueries: readonly QueryRegistration[] = [];

export const productionRegistry: OperationRegistry = { commands: productionCommands, queries: productionQueries };
