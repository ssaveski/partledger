import type { CommandRegistration } from './handlers';

/**
 * Every command the API serves in production. A module declares its commands in
 * `libs/contracts/src/<module>/`, implements their handlers in `apps/api/src/<module>/`, and
 * adds its registrations here; routes, permission checks and the registry rules follow.
 */
export const productionCommands: readonly CommandRegistration[] = [];
