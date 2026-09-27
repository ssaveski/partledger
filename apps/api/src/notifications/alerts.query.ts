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
import { alertTemplates, templateNamed } from './templates/index';
import { messageParamsOf } from './templates/render';
import { countedMessageKey, keyParamsOf } from './templates/template';

const alertRows = z.array(
  z.object({
    id: z.uuid(),
    kind: z.string(),
    params: z.unknown(),
    raised_at: z.coerce.date(),
  }),
);

const dayMilliseconds = 86_400_000;

/**
 * The staff shell's alerts: the tenant's operational alerts and the reader's in-app
 * notifications from the last 30 days, newest first. A row whose kind, template or params this
 * build cannot read is shown with the unreadable alert's wording, never left out.
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
      alerts.push({
        alertId: row.id,
        source: 'operational',
        ...describeOperational(row.kind, row.params),
        raisedAt: row.raised_at.toISOString(),
      });
    }
    for (const row of personal) {
      alerts.push({
        alertId: row.id,
        source: 'notification',
        ...describeInApp(row.kind, row.params),
        raisedAt: row.raised_at.toISOString(),
      });
    }
    alerts.sort((left, right) => right.raisedAt.localeCompare(left.raisedAt));
    return success({ alerts: alerts.slice(0, staffAlertLimit) });
  }
}

type Description = Pick<StaffAlert, 'titleKey' | 'descriptionKey' | 'params' | 'keyParams' | 'path'>;

const unreadable: Description = {
  titleKey: 'pl.notifications.alert.unreadable.title',
  descriptionKey: 'pl.notifications.alert.unreadable.description',
  params: {},
  keyParams: {},
  path: null,
};

function describeOperational(kind: string, params: unknown): Description {
  const knownKind = operationalAlertKindSchema.safeParse(kind);
  if (!knownKind.success) {
    return unreadable;
  }
  const template = alertTemplates[knownKind.data];
  const parsed = template.params.safeParse(params);
  if (!parsed.success) {
    return unreadable;
  }
  const base = `pl.notifications.alert.${knownKind.data}`;
  return {
    titleKey: `${base}.title`,
    descriptionKey: countedMessageKey(template, `${base}.description`, parsed.data),
    params: messageParamsOf(parsed.data),
    keyParams: keyParamsOf(template, parsed.data),
    path: null,
  };
}

function describeInApp(name: string, params: unknown): Description {
  const template = templateNamed(name);
  const parsed = template?.params.safeParse(params);
  if (template?.channel !== 'inApp' || parsed?.success !== true) {
    return unreadable;
  }
  const base = `pl.notifications.inApp.${template.name}`;
  const target = template.link(parsed.data);
  return {
    titleKey: `${base}.title`,
    descriptionKey: countedMessageKey(template, `${base}.description`, parsed.data),
    params: messageParamsOf(parsed.data),
    keyParams: keyParamsOf(template, parsed.data),
    path: target?.app === 'staff' ? target.path : null,
  };
}
