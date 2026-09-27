import { Injectable } from '@nestjs/common';
import {
  operationalAlertKindSchema,
  staffAlertLimit,
  staffAlertWindowDays,
  type InputOf,
  type StaffAlert,
  staffAlertsQuery,
} from '@partledger/contracts';
import { refuse, success } from '@partledger/domain';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { HandlerResult, OperationContext, QueryHandler } from '../commands/handlers';
import { templateNamed } from './templates/index';
import { messageParamsOf } from './templates/render';

const alertRows = z.array(
  z.object({
    id: z.uuid(),
    kind: z.string(),
    params: z.record(z.string(), z.unknown()),
    raised_at: z.coerce.date(),
  }),
);

const dayMilliseconds = 86_400_000;

/**
 * The staff shell's alerts: the tenant's operational alerts and the reader's in-app
 * notifications from the last 30 days, newest first. Rows of a kind or template this build does
 * not know are left out rather than shown without text.
 */
@Injectable()
export class StaffAlertsHandler implements QueryHandler<typeof staffAlertsQuery> {
  async execute(
    _input: InputOf<typeof staffAlertsQuery>,
    context: OperationContext,
  ): Promise<HandlerResult<typeof staffAlertsQuery>> {
    const { principal, database } = context;
    if (principal.type !== 'person') {
      return refuse('Forbidden', 'notPermitted');
    }
    const since = new Date(context.now.getTime() - staffAlertWindowDays * dayMilliseconds).toISOString();
    const operational = alertRows.parse(
      (
        await database.execute(
          sql`select id, kind, params, raised_at from operational_alerts
               where raised_at >= ${since}::timestamptz
               order by raised_at desc, id limit ${staffAlertLimit}`,
        )
      ).rows,
    );
    const personal = alertRows.parse(
      (
        await database.execute(
          sql`select id, template as kind, params, created_at as raised_at from notifications
               where channel = 'inApp' and recipient_kind = 'person' and recipient_id = ${principal.userId}
                 and created_at >= ${since}::timestamptz
               order by created_at desc, id limit ${staffAlertLimit}`,
        )
      ).rows,
    );
    const alerts: StaffAlert[] = [];
    for (const row of operational) {
      const kind = operationalAlertKindSchema.safeParse(row.kind);
      if (kind.success) {
        alerts.push({
          alertId: row.id,
          source: 'operational',
          titleKey: `pl.notifications.alert.${kind.data}.title`,
          descriptionKey: `pl.notifications.alert.${kind.data}.description`,
          params: messageParamsOf(row.params),
          raisedAt: row.raised_at.toISOString(),
          path: null,
        });
      }
    }
    for (const row of personal) {
      const template = templateNamed(row.kind);
      const params = template?.params.safeParse(row.params);
      if (template?.channel === 'inApp' && params?.success === true) {
        const target = template.link(params.data);
        alerts.push({
          alertId: row.id,
          source: 'notification',
          titleKey: `pl.notifications.inApp.${template.name}.title`,
          descriptionKey: `pl.notifications.inApp.${template.name}.description`,
          params: messageParamsOf(params.data),
          raisedAt: row.raised_at.toISOString(),
          path: target?.app === 'staff' ? target.path : null,
        });
      }
    }
    alerts.sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
    return success({ alerts: alerts.slice(0, staffAlertLimit) });
  }
}
