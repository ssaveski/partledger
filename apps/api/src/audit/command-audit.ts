import { jsonValueOf, type JsonObject } from '@partledger/chain';

import { assertCommittedPayload, type Commitment, type CommittedPayload } from './audit-payload';
import type { AuditDatabase } from './audit-writer';
import { commitValue } from './commitments';

/**
 * The audit record of one command. Every successful command appends exactly one entry
 * (R26), written by the executor inside the command's transaction; the handler adds the
 * changes it made (a transition, a seal) and commits any personal or free-text value it
 * wants that entry to cover.
 */
export class CommandAudit {
  private readonly recordedChanges: JsonObject[] = [];

  constructor(
    private readonly database: AuditDatabase,
    private readonly tenantId: string,
    private readonly now: Date,
  ) {}

  /** Adds a change to this command's entry. Personal fields must hold commitments. */
  record<Change extends JsonObject>(change: CommittedPayload<Change>): void {
    const value = jsonValueOf(change);
    assertCommittedPayload(value);
    this.recordedChanges.push(change);
  }

  /** Stores a personal or free-text value in the commitment store and returns its commitment. */
  commit(value: string): Promise<Commitment> {
    return commitValue(this.database, { tenantId: this.tenantId, value, now: this.now });
  }

  get changes(): readonly JsonObject[] {
    return this.recordedChanges;
  }
}
