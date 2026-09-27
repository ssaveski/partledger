import type { Type } from '@nestjs/common';
import type { CommandDeclaration, ErrorCodeOf, InputOf, OutputOf, QueryDeclaration } from '@partledger/contracts';
import type { DomainErrorOf, Result } from '@partledger/domain';

import type { CommandAudit } from '../audit/command-audit';
import type { AppDatabase } from '../db/tenant-transaction';
import type { CommandJobs } from '../jobs/enqueue';
import type { Principal } from '../principals/principal';

/** What a handler runs with: the principal from the credential and the request's tenant transaction. */
export interface OperationContext {
  readonly principal: Principal;
  /** The request's transaction, with the principal's tenant set as its first statement (KTD10). */
  readonly database: AppDatabase;
  /** One instant per request, from the application's clock (KTD12). */
  readonly now: Date;
}

/**
 * A command also records what it changed in its one audit entry (R26), and enqueues its
 * follow-up work in its own transaction (KTD16).
 */
export interface CommandContext extends OperationContext {
  readonly audit: CommandAudit;
  readonly jobs: CommandJobs;
}

/** A handler returns its declared failures as values; any failure rolls the transaction back (KTD14). */
export type HandlerResult<Declaration extends CommandDeclaration | QueryDeclaration> = Result<
  OutputOf<Declaration>,
  DomainErrorOf<ErrorCodeOf<Declaration>>
>;

export interface CommandHandler<Declaration extends CommandDeclaration = CommandDeclaration> {
  execute(input: InputOf<Declaration>, context: CommandContext): Promise<HandlerResult<Declaration>>;
}

export interface QueryHandler<Declaration extends QueryDeclaration = QueryDeclaration> {
  execute(input: InputOf<Declaration>, context: OperationContext): Promise<HandlerResult<Declaration>>;
}

export interface CommandRegistration<Declaration extends CommandDeclaration = CommandDeclaration> {
  readonly declaration: Declaration;
  /** A Nest provider, so handlers inject the services they need. */
  readonly handler: Type<CommandHandler<Declaration>>;
}

export interface QueryRegistration<Declaration extends QueryDeclaration = QueryDeclaration> {
  readonly declaration: Declaration;
  readonly handler: Type<QueryHandler<Declaration>>;
}

export function registerCommand<Declaration extends CommandDeclaration>(
  declaration: Declaration,
  handler: Type<CommandHandler<Declaration>>,
): CommandRegistration<Declaration> {
  return { declaration, handler };
}

export function registerQuery<Declaration extends QueryDeclaration>(
  declaration: Declaration,
  handler: Type<QueryHandler<Declaration>>,
): QueryRegistration<Declaration> {
  return { declaration, handler };
}

/** Every command and query the API serves. */
export interface OperationRegistry {
  readonly commands: readonly CommandRegistration[];
  readonly queries: readonly QueryRegistration[];
}
