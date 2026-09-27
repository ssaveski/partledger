import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { AuditDatabase } from '../audit/audit-writer';
import type { RecipientKind } from './templates/template';

export interface NotificationRecipient {
  readonly kind: RecipientKind;
  readonly id: string;
}

/**
 * Where a recipient's email address comes from, read at send time inside the send job's tenant
 * transaction. Addresses are personal data: the outbox, job payloads, audit entries and logs
 * carry the recipient's kind and id only (KTD16, R39).
 */
export interface RecipientDirectory {
  /** The address to send to, or `null` when the recipient no longer exists or has none. */
  emailAddressOf(database: AuditDatabase, recipient: NotificationRecipient): Promise<string | null>;
}

export const recipientDirectory = Symbol('RecipientDirectory');

const addressRows = z.array(z.object({ email_address: z.string() }));

/**
 * The shipped directory. It knows the tenant's alert recipients; people (U8) and supplier
 * contacts (U10) join it when their tables exist, and until then have no address.
 */
export const storedRecipientDirectory: RecipientDirectory = {
  async emailAddressOf(database, recipient) {
    if (recipient.kind !== 'alertRecipient') {
      return null;
    }
    const result = await database.execute(
      sql`select email_address from alert_recipients where id = ${recipient.id} and removed_at is null`,
    );
    return addressRows.parse(result.rows)[0]?.email_address ?? null;
  },
};
