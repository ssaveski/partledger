import { isJsonObject, jsonValueOf, type JsonObject } from '@partledger/chain';

import { checkedAuditObject, type AuditPayload, type CheckedAuditObject, type Commitment } from './audit-payload';
import type { AuditDatabase } from './audit-writer';
import { commitValue } from './commitments';

/**
 * The audit record of one command. Every successful command appends exactly one entry
 * (R26), written by the executor inside the command's transaction; the handler adds the
 * changes it made (a transition, a seal) and commits any personal or free-text value it
 * wants that entry to cover.
 */
export class CommandAudit {
  private readonly recordedChanges: CheckedAuditObject[] = [];

  constructor(
    private readonly database: AuditDatabase,
    private readonly tenantId: string,
    private readonly now: Date,
  ) {}

  /** Adds a change to this command's entry; free text must be committed first (see audit-payload.ts). */
  record<const Change extends JsonObject>(change: AuditPayload<Change>): void {
    const value = jsonValueOf(change);
    if (!isJsonObject(value)) {
      throw new TypeError('An audit change is an object');
    }
    this.recordedChanges.push(checkedAuditObject(value));
  }

  /** Stores a personal or free-text value in the commitment store and returns its commitment. */
  commit(value: string): Promise<Commitment> {
    return commitValue(this.database, { tenantId: this.tenantId, value, now: this.now });
  }

  get changes(): readonly CheckedAuditObject[] {
    return this.recordedChanges;
  }
}
