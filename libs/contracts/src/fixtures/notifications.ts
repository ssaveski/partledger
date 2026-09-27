import type { z } from 'zod';

import { fixtureQuery, type FixtureHandler } from '../client/fixture-adapter';
import { staffAlertsQuery } from '../notifications/operations';
import { fixtureId } from './rfqs';

type AlertsOutput = z.input<typeof staffAlertsQuery.output>;

/** Synthetic alerts for the staff shell: one operational alert of the tenant and one notification for the reader. */
export const alertFixtureOutput: AlertsOutput = {
  alerts: [
    {
      alertId: fixtureId(7001),
      source: 'operational',
      titleKey: 'pl.notifications.alert.chainVerificationFailed.title',
      descriptionKey: 'pl.notifications.alert.chainVerificationFailed.description',
      params: { firstFailingSeq: 1187 },
      raisedAt: '2026-09-26T03:17:42.000Z',
      path: null,
    },
    {
      alertId: fixtureId(7002),
      source: 'notification',
      titleKey: 'pl.notifications.inApp.evidenceExpiring.title',
      descriptionKey: 'pl.notifications.inApp.evidenceExpiring.description',
      params: { daysLeft: 21 },
      raisedAt: '2026-09-25T08:05:00.000Z',
      path: null,
    },
  ],
};

export const notificationFixtureHandlers: readonly FixtureHandler[] = [
  fixtureQuery(staffAlertsQuery, () => ({ kind: 'output', output: alertFixtureOutput })),
];
