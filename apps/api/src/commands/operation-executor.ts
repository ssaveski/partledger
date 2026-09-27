import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { idempotencyKeySchema, type OperationDeclaration, type ValidationIssue } from '@partledger/contracts';
import { isJsonObject, parseJson as parseJsonValue, type JsonObject } from '@partledger/chain';
import { domainError, type DomainError, type Result } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

import { appendAuditEntry, auditActorOf } from '../audit/audit-writer';
import { auditToken, checkedAuditObject } from '../audit/audit-payload';
import { CommandAudit } from '../audit/command-audit';
import { TenantTransactions, type AppDatabase } from '../db/tenant-transaction';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { inputFingerprint } from '../idempotency/fingerprint';
import type { HttpEntryAdapter } from '../listeners/entry-adapters';
import { isAllowed } from '../principals/authorize';
import type { AuthenticatedPrincipal, Principal } from '../principals/principal';
import { PrincipalResolver, type PresentedHeaders } from '../principals/principal-resolver';
import { roleDirectory, type RoleDirectory } from '../principals/role-directory';
import { hasRecentStepUp } from '../principals/step-up';
import { clock, type Clock } from '../time/clock';
import type { HandlerResult } from './handlers';
import { operationRoutes, type OperationRoutes } from './route-generator';

export interface OperationRequest {
  /** The listener the request arrived on; `undefined` when no listener accepted it. */
  readonly adapter: HttpEntryAdapter | undefined;
  /** The `Authorization` and `Cookie` headers; which one counts depends on the listener. */
  readonly credentialHeaders: PresentedHeaders;
  readonly correlationId: string;
}

export interface CommandRequest extends OperationRequest {
  readonly body: unknown;
  readonly idempotencyKey: string | undefined;
}

export interface QueryRequest extends OperationRequest {
  /** The `input` query parameter: the query's input as JSON. */
  readonly input: string | undefined;
}

export type Outcome =
  | { readonly kind: 'success'; readonly output: unknown; readonly replayed: boolean }
  | { readonly kind: 'failure'; readonly error: DomainError }
  | { readonly kind: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: 'unauthenticated' };

type Failed = Extract<Outcome, { kind: 'failure' }>;

class RollbackWith extends Error {
  readonly outcome: Failed;

  constructor(outcome: Failed) {
    super('The operation failed; its transaction rolls back');
    this.outcome = outcome;
  }
}

class UndeclaredFailureError extends Error {
  constructor(operation: string, error: DomainError) {
    super(`${operation} returned ${error._tag}.${error.reason}, which it does not declare`);
    this.name = 'UndeclaredFailureError';
  }
}

function refused(error: DomainError): Failed {
  return { kind: 'failure', error };
}

/**
 * Runs a command or query for a request: authenticate the credential, parse the input, then,
 * in one tenant transaction, read the principal's roles, check access and step-up, claim the
 * idempotency key and run the handler. A failure at any step inside the transaction rolls it
 * back, so a command's effects happen entirely or not at all (KTD14).
 */
@Injectable()
export class OperationExecutor {
  constructor(
    @Inject(operationRoutes) private readonly routes: OperationRoutes,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(roleDirectory) private readonly roles: RoleDirectory,
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(clock) private readonly time: Clock,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  async executeCommand(name: string, request: CommandRequest): Promise<Outcome> {
    const now = this.time.now();
    const authenticated = await this.authenticate(request, now);
    if (authenticated === null) {
      return { kind: 'unauthenticated' };
    }
    return this.runCommand(authenticated, name, request.body, request.idempotencyKey, now);
  }

  /**
   * Runs a command for a principal that is already authenticated: a request's credential, or
   * a background job acting as `system` (U9). Every successful, non-replayed command appends
   * exactly one audit entry inside its transaction (R26).
   */
  async runCommand(
    authenticated: AuthenticatedPrincipal,
    name: string,
    body: unknown,
    requestIdempotencyKey: string | undefined,
    now: Date = this.time.now(),
  ): Promise<Outcome> {
    const registration = this.routes.command(name);
    if (registration === undefined) {
      return refused(domainError('NotFound', 'route'));
    }
    const { declaration } = registration;
    const input = parseInput(declaration.input, body);
    if (!input.ok) {
      return { kind: 'invalid', issues: input.error };
    }
    let idempotencyKey: string | undefined;
    if (requestIdempotencyKey !== undefined) {
      const parsedKey = idempotencyKeySchema.safeParse(requestIdempotencyKey);
      if (!parsedKey.success) {
        return { kind: 'invalid', issues: [{ path: ['headers', 'idempotency-key'], code: 'invalid_format' }] };
      }
      idempotencyKey = parsedKey.data;
    } else if (declaration.idempotencyKey === 'required') {
      return refused(domainError('Invalid', 'idempotencyKeyRequired'));
    }

    return this.inTenantTransaction(authenticated, async (principal, database) => {
      if (!isAllowed(declaration.access, principal)) {
        return refused(domainError('Forbidden', 'notPermitted'));
      }
      if (declaration.stepUp && !hasRecentStepUp(principal, now)) {
        return refused(domainError('StepUpRequired', 'recentAuthentication'));
      }
      let claimId: string | undefined;
      const { actedUnder } = principal;
      if (idempotencyKey !== undefined && actedUnder.grant !== 'job') {
        const claim = await this.idempotency.claim(database, {
          tenantId: principal.tenantId,
          credentialId: actedUnder.credentialId,
          command: declaration.name,
          key: idempotencyKey,
          fingerprint: inputFingerprint(declaration.name, input.value),
          now,
        });
        if (claim.kind === 'replay') {
          return { kind: 'success', output: declaration.output.parse(claim.result), replayed: true };
        }
        if (claim.kind === 'reused_with_other_input') {
          return refused(domainError('Unprocessable', 'idempotencyKeyReused'));
        }
        claimId = claim.id;
      }
      const handler = this.moduleRef.get(registration.handler);
      const audit = new CommandAudit(database, principal.tenantId, now);
      const result = await handler.execute(input.value, { principal, database, now, audit });
      const outcome = this.outcomeOf(declaration, result);
      if (outcome.kind === 'success') {
        await appendAuditEntry(
          database,
          {
            tenantId: principal.tenantId,
            actor: auditActorOf(principal),
            event: auditToken(declaration.name),
            data: { output: checkedAuditObject(outputForAudit(outcome.output)), changes: audit.changes },
          },
          this.time,
        );
        if (claimId !== undefined) {
          await this.idempotency.complete(database, claimId, outcome.output);
        }
      }
      return outcome;
    });
  }

  async executeQuery(name: string, request: QueryRequest): Promise<Outcome> {
    const now = this.time.now();
    const authenticated = await this.authenticate(request, now);
    if (authenticated === null) {
      return { kind: 'unauthenticated' };
    }
    const registration = this.routes.query(name);
    if (registration === undefined) {
      return refused(domainError('NotFound', 'route'));
    }
    const { declaration } = registration;
    const json = parseJson(request.input ?? '{}');
    if (!json.ok) {
      return { kind: 'invalid', issues: [{ path: ['input'], code: 'invalid_json' }] };
    }
    const input = parseInput(declaration.input, json.value);
    if (!input.ok) {
      return { kind: 'invalid', issues: input.error };
    }
    return this.inTenantTransaction(authenticated, async (principal, database) => {
      if (!isAllowed(declaration.access, principal)) {
        return refused(domainError('Forbidden', 'notPermitted'));
      }
      // Queries are GETs and must have no side effects; the database enforces it.
      await database.execute(sql`set transaction read only`);
      const handler = this.moduleRef.get(registration.handler);
      return this.outcomeOf(declaration, await handler.execute(input.value, { principal, database, now }));
    });
  }

  private async authenticate(request: OperationRequest, now: Date): Promise<AuthenticatedPrincipal | null> {
    if (request.adapter === undefined) {
      return null;
    }
    return this.principals.authenticate(request.adapter, request.credentialHeaders, request.correlationId, now);
  }

  private async inTenantTransaction(
    authenticated: AuthenticatedPrincipal,
    work: (principal: Principal, database: AppDatabase) => Promise<Outcome>,
  ): Promise<Outcome> {
    try {
      return await this.transactions.run(authenticated.tenantId, async (database) => {
        const principal: Principal =
          authenticated.type === 'person'
            ? {
                ...authenticated,
                roles: await this.roles.rolesOf(
                  { tenantId: authenticated.tenantId, userId: authenticated.userId },
                  database,
                ),
              }
            : authenticated;
        const outcome = await work(principal, database);
        if (outcome.kind === 'failure') {
          throw new RollbackWith(outcome);
        }
        return outcome;
      });
    } catch (error) {
      if (error instanceof RollbackWith) {
        return error.outcome;
      }
      throw error;
    }
  }

  private outcomeOf(
    declaration: OperationDeclaration,
    result: HandlerResult<OperationDeclaration>,
  ): Extract<Outcome, { kind: 'success' | 'failure' }> {
    if (result.ok) {
      return { kind: 'success', output: declaration.output.parse(result.value), replayed: false };
    }
    const declared = declaration.errors.some(
      (code) => code.tag === result.error._tag && code.reason === result.error.reason,
    );
    if (!declared) {
      throw new UndeclaredFailureError(declaration.name, result.error);
    }
    return refused(result.error);
  }
}

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): Result<z.output<Schema>, ValidationIssue[]> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    error: parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
      code: issue.code,
    })),
  };
}

/** A command's output holds identifiers, versions, counts and enumerations only (KTD14), so the chain may carry it. */
function outputForAudit(output: unknown): JsonObject {
  const value = parseJsonValue(JSON.stringify(output));
  return isJsonObject(value) ? value : { value };
}

function parseJson(text: string): Result<unknown, null> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, error: null };
  }
}
