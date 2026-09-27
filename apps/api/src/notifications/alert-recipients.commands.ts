import { Injectable } from '@nestjs/common';
import { addAlertRecipientCommand, removeAlertRecipientCommand, type InputOf } from '@partledger/contracts';
import { refuse, success } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { auditId } from '../audit/audit-payload';
import type { CommandContext, CommandHandler, HandlerResult } from '../commands/handlers';

const idRows = z.array(z.object({ id: z.uuid() }));

/**
 * Adds an address to the tenant's alert recipients (KTD41). The address is personal data, so
 * the command's audit entry carries it only as a commitment (KTD17).
 */
@Injectable()
export class AddAlertRecipientHandler implements CommandHandler<typeof addAlertRecipientCommand> {
  async execute(
    input: InputOf<typeof addAlertRecipientCommand>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof addAlertRecipientCommand>> {
    const result = await context.database.execute(
      sql`insert into alert_recipients (tenant_id, email_address, added_at)
          values (${context.principal.tenantId}, ${input.emailAddress}, ${context.now.toISOString()}::timestamptz)
          on conflict (tenant_id, email_address) where removed_at is null do nothing
          returning id`,
    );
    const [added] = idRows.parse(result.rows);
    if (added === undefined) {
      return refuse('Conflict', 'alreadyExists');
    }
    context.audit.record({
      alertRecipientId: auditId(added.id),
      emailAddress: await context.audit.commit(input.emailAddress),
    });
    return success({ alertRecipientId: added.id });
  }
}

/** Stops sending the tenant's operational alerts to a recipient; notifications already recorded for it fail at send time. */
@Injectable()
export class RemoveAlertRecipientHandler implements CommandHandler<typeof removeAlertRecipientCommand> {
  async execute(
    input: InputOf<typeof removeAlertRecipientCommand>,
    context: CommandContext,
  ): Promise<HandlerResult<typeof removeAlertRecipientCommand>> {
    const result = await context.database.execute(
      sql`update alert_recipients set removed_at = ${context.now.toISOString()}::timestamptz
           where id = ${input.alertRecipientId} and removed_at is null
           returning id`,
    );
    const [removed] = idRows.parse(result.rows);
    if (removed === undefined) {
      return refuse('NotFound', 'resource');
    }
    context.audit.record({ alertRecipientId: auditId(removed.id) });
    return success({ alertRecipientId: removed.id });
  }
}
