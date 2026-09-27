import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { formatMessage, staffAlertsSchema, type OperationalAlertKind } from '@partledger/contracts';
import { insertTenant } from '@partledger/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { raiseOperationalAlert } from '../src/alerts/operational-alerts';
import { TenantTransactions } from '../src/db/tenant-transaction';
import { JobQueue } from '../src/jobs/enqueue';
import { JobItemFailedError, JobRunner, type DeliveredJob } from '../src/jobs/job-runner';
import { JobScheduler } from '../src/jobs/job-scheduler';
import { readLocalInbox } from '../src/notifications/local-email.adapter';
import { recordNotification } from '../src/notifications/notification.service';
import { maximumSendAttempts } from '../src/notifications/send-notification.job';
import { rfqAmendedTemplate } from '../src/notifications/templates/index';
import { startApiHarness, type ApiHarness, type IssuedToken } from './support/api-harness';
import { jobsTestCatalogTables } from './support/jobs-test-module';
import {
  notificationsTestRegistry,
  ObservedEmailPort,
  syntheticRfqContent,
  testRecipientDirectory,
} from './support/notifications-test-module';

const staffOrigin = 'http://127.0.0.1:5173';
const portalOrigin = 'http://127.0.0.1:5174';
const deliveryJobName = 'notifications.deliverOperationalAlerts';
const deliverySchedule = 'notifications.operationalAlertDelivery';

const notificationRows = z.array(
  z.object({
    id: z.uuid(),
    tenant_id: z.uuid(),
    channel: z.string(),
    template: z.string(),
    recipient_kind: z.string(),
    recipient_id: z.uuid(),
    params: z.record(z.string(), z.unknown()),
    operational_alert_id: z.uuid().nullable(),
    status: z.enum(['pending', 'sent', 'failed']),
    attempts: z.number(),
    failure: z.string().nullable(),
  }),
);
const jobRows = z.array(z.object({ id: z.uuid(), name: z.string(), data: z.unknown() }));
const alertRows = z.array(
  z.object({ id: z.uuid(), kind: z.string(), key: z.string(), params: z.unknown(), notified_at: z.date().nullable() }),
);
const addedRecipient = z.object({ alertRecipientId: z.uuid() });
const amended = z.object({ notificationIds: z.array(z.uuid()) });
const flagged = z.object({ notificationId: z.uuid() });

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function eventually<Value>(
  read: () => Promise<Value>,
  done: (value: Value) => boolean,
  timeoutMilliseconds = 30_000,
): Promise<Value> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await pause(200);
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.cause === undefined ? error.message : `${error.message}: ${describeError(error.cause)}`;
}

describe('notifications', () => {
  let harness: ApiHarness;
  let inbox: string;
  let email: ObservedEmailPort;
  const contacts = new Map<string, string>();
  let buyerA: IssuedToken;
  let qualityA: IssuedToken;
  let adminA: IssuedToken;
  let adminB: IssuedToken;
  let runner: JobRunner;
  let transactions: TenantTransactions;
  let queue: JobQueue;
  const logged: string[] = [];

  beforeAll(async () => {
    inbox = await mkdtemp(join(tmpdir(), 'partledger-inbox-'));
    email = new ObservedEmailPort(inbox);
    harness = await startApiHarness({
      process: {
        registry: notificationsTestRegistry,
        workers: false,
        emailPort: email,
        recipientDirectory: testRecipientDirectory(contacts),
      },
    });
    // A worker's boot-time catalog check expects the backup role to read every table.
    const migrator = await harness.database.connect('pl_migrator');
    await migrator.query('grant select on internal_test_notes to pl_backup');
    await migrator.end();
    buyerA = await harness.issue('staff_session', harness.tenantA, { roles: ['buyer'] });
    qualityA = await harness.issue('staff_session', harness.tenantA, { roles: ['quality_engineer'] });
    adminA = await harness.issue('staff_session', harness.tenantA, { roles: ['tenant_admin'] });
    adminB = await harness.issue('staff_session', harness.tenantB, { roles: ['tenant_admin'] });
    runner = harness.api.app.get(JobRunner);
    transactions = harness.api.app.get(TenantTransactions);
    queue = harness.api.app.get(JobQueue);
  });

  afterAll(async () => {
    await harness.close();
    await rm(inbox, { recursive: true, force: true });
  });

  beforeEach(() => {
    email.failingAddresses.clear();
    email.throwingAddresses.clear();
    email.delayMilliseconds = 0;
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logged.push(String(message));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function newContact(): { readonly id: string; readonly address: string } {
    const id = randomUUID();
    const address = `contact-${id.slice(0, 8)}@supplier.example`;
    contacts.set(id, address);
    return { id, address };
  }

  function amendRfq(contactIds: readonly string[], options: { readonly refuseAfterRecording?: boolean } = {}) {
    return harness.command(
      'staff',
      'notificationsTest.amendRfq',
      {
        rfqId: randomUUID(),
        version: 2,
        contactIds,
        ...syntheticRfqContent,
        refuseAfterRecording: options.refuseAfterRecording ?? false,
      },
      { token: buyerA.token },
    );
  }

  async function addRecipient(token: string, address: string): Promise<string> {
    const response = await harness.command(
      'staff',
      'notifications.addAlertRecipient',
      { emailAddress: address },
      { token },
    );
    expect(response.status).toBe(200);
    return addedRecipient.parse(response.body).alertRecipientId;
  }

  async function notificationsWhere(clause: string, values: unknown[]) {
    const result = await harness.superuser.query(
      `select id, tenant_id, channel, template, recipient_kind, recipient_id, params, operational_alert_id, status,
              attempts, failure
         from notifications where ${clause} order by created_at, id`,
      values,
    );
    return notificationRows.parse(result.rows);
  }

  async function notification(id: string) {
    const [row] = await notificationsWhere('id = $1', [id]);
    if (row === undefined) {
      throw new Error(`No notification ${id}`);
    }
    return row;
  }

  async function sendJobsFor(notificationId: string): Promise<DeliveredJob[]> {
    const result = await harness.superuser.query(
      `select id, name, data from pl_jobs.job
        where name = 'notifications.send' and data -> 'payload' ->> 'notificationId' = $1`,
      [notificationId],
    );
    return jobRows.parse(result.rows);
  }

  async function sendJobFor(notificationId: string): Promise<DeliveredJob> {
    const [job, ...others] = await sendJobsFor(notificationId);
    if (job === undefined || others.length > 0) {
      throw new Error(`Expected one send job for ${notificationId}`);
    }
    return job;
  }

  function deliveryJob(tenantId: string): DeliveredJob {
    return {
      id: randomUUID(),
      name: deliveryJobName,
      data: { tenantId, cause: 'schedule', source: deliverySchedule, payload: {} },
    };
  }

  async function raiseAlert(tenantId: string, kind: OperationalAlertKind, params: Record<string, number | string>) {
    const key = `test:${randomUUID()}`;
    await transactions.run(tenantId, (database) =>
      raiseOperationalAlert(database, { tenantId, kind, key, params, raisedByJobId: null, now: harness.clock.now() }),
    );
    const result = await harness.superuser.query(
      'select id, kind, key, params, notified_at from operational_alerts where tenant_id = $1 and key = $2',
      [tenantId, key],
    );
    const [alert] = alertRows.parse(result.rows);
    if (alert === undefined) {
      throw new Error('The alert was not raised');
    }
    return alert;
  }

  async function alertById(id: string) {
    const result = await harness.superuser.query(
      'select id, kind, key, params, notified_at from operational_alerts where id = $1',
      [id],
    );
    return alertRows.parse(result.rows)[0];
  }

  async function inboxFor(address: string) {
    return (await readLocalInbox(inbox)).filter((message) => message.to === address);
  }

  describe('the outbox', () => {
    it("sends a committed command's supplier email through a worker, with the link and no prices, part numbers or line descriptions", async () => {
      const contact = newContact();
      const response = await amendRfq([contact.id]);
      expect(response.status).toBe(200);
      const [notificationId] = amended.parse(response.body).notificationIds;
      if (notificationId === undefined) {
        throw new Error('One notification expected');
      }
      const recorded = await notification(notificationId);
      expect(recorded).toMatchObject({
        channel: 'email',
        template: 'rfqAmended',
        recipient_kind: 'supplierContact',
        recipient_id: contact.id,
        status: 'pending',
      });
      const rfqId = z.uuid().parse(recorded.params.rfqId);
      expect(recorded.params).toEqual({ rfqId, version: 2 });

      const worker = await harness.startAnotherApi({
        registry: notificationsTestRegistry,
        workers: true,
        // The harness created its notes table after the first API booted.
        catalogTables: jobsTestCatalogTables.filter((access) => access.table === 'internal_test_notes'),
        emailPort: email,
        recipientDirectory: testRecipientDirectory(contacts),
      });
      try {
        await eventually(
          () => notification(notificationId),
          (current) => current.status === 'sent',
        );
      } finally {
        await worker.close();
      }
      expect(await notification(notificationId)).toMatchObject({ status: 'sent', attempts: 1, failure: null });

      const [message, ...others] = await inboxFor(contact.address);
      expect(others).toEqual([]);
      expect(message).toMatchObject({
        to: contact.address,
        subject: 'Synthetic tenant-a changed a request for quotation',
        idempotencyKey: notificationId,
      });
      const text = message?.text ?? '';
      expect(text).toContain(`Review the request: ${portalOrigin}/rfqs/${rfqId}`);
      expect(text).toContain('published version 2 of a request for quotation');
      for (const content of [
        syntheticRfqContent.partNumber,
        syntheticRfqContent.description,
        syntheticRfqContent.unitPrice,
        '1250',
        '1,250',
      ]) {
        expect(text).not.toContain(content);
        expect(message?.subject).not.toContain(content);
      }
    });

    it('never sends a notification recorded by a command that rolls back', async () => {
      const contact = newContact();
      const sendJobsBefore = await harness.count(`select 1 from pl_jobs.job where name = 'notifications.send'`);
      const response = await amendRfq([contact.id], { refuseAfterRecording: true });
      expect(response.status).toBe(409);
      expect(await notificationsWhere('recipient_id = $1', [contact.id])).toEqual([]);
      expect(await harness.count(`select 1 from pl_jobs.job where name = 'notifications.send'`)).toBe(sendJobsBefore);
      expect(email.attempts.filter((message) => message.to === contact.address)).toEqual([]);
      expect(await inboxFor(contact.address)).toEqual([]);
    });

    it('refuses to record a value that is not an identifier, count or code, such as a price or a part number', async () => {
      const contact = newContact();
      const smuggled = [
        { rfqId: randomUUID(), version: 2, unitPrice: 1250.75 },
        { rfqId: randomUUID(), version: 2, partNumber: syntheticRfqContent.partNumber },
        { rfqId: syntheticRfqContent.description, version: 2 },
      ];
      for (const params of smuggled) {
        let refusal = '';
        try {
          await transactions.run(harness.tenantA, (database) =>
            recordNotification(
              {
                principal: { tenantId: harness.tenantA },
                database,
                now: harness.clock.now(),
                jobs: {
                  enqueue: (declaration, payload) =>
                    queue.enqueue(
                      database,
                      declaration,
                      { tenantId: harness.tenantA, cause: 'schedule', source: 'notificationsTest.smuggle' },
                      payload,
                    ),
                },
              },
              rfqAmendedTemplate,
              { kind: 'supplierContact', id: contact.id },
              params,
            ),
          );
        } catch (error) {
          refusal = describeError(error);
        }
        expect(refusal).toMatch(/unrecognized_keys|Unrecognized key|Invalid UUID|invalid_format/);
      }
      expect(await notificationsWhere('recipient_id = $1', [contact.id])).toEqual([]);
    });

    it('sends a notification once when its job is delivered twice at the same time', async () => {
      const contact = newContact();
      const response = await amendRfq([contact.id]);
      const [notificationId] = amended.parse(response.body).notificationIds;
      if (notificationId === undefined) {
        throw new Error('One notification expected');
      }
      const job = await sendJobFor(notificationId);
      email.delayMilliseconds = 300;
      const [first, second] = await Promise.all([runner.run(job), runner.run(job)]);
      expect([...first.applied, ...second.applied]).toEqual([`notification:${notificationId}`]);
      expect(email.attemptsFor(notificationId)).toBe(1);
      expect(await inboxFor(contact.address)).toHaveLength(1);

      // A redelivery after the send finds the notification sent and sends nothing.
      await runner.run({ ...job, id: randomUUID() });
      expect(email.attemptsFor(notificationId)).toBe(1);
      expect(await notification(notificationId)).toMatchObject({ status: 'sent', attempts: 1 });
    });

    it('retries a failed send and, after the last attempt, marks it failed and records a failure alert', async () => {
      const contact = newContact();
      email.failingAddresses.add(contact.address);
      const response = await amendRfq([contact.id]);
      const [notificationId] = amended.parse(response.body).notificationIds;
      if (notificationId === undefined) {
        throw new Error('One notification expected');
      }
      const job = await sendJobFor(notificationId);
      for (let attempt = 1; attempt < maximumSendAttempts; attempt += 1) {
        let failure: unknown;
        try {
          await runner.run(job);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(JobItemFailedError);
        expect(failure instanceof JobItemFailedError ? failure.failure : '').toBe('Unavailable.dependencyUnavailable');
        expect(await notification(notificationId)).toMatchObject({ status: 'pending', attempts: 0 });
      }
      expect(
        await harness.count(`select 1 from operational_alerts where key = $1`, [`notification:${notificationId}`]),
      ).toBe(0);

      expect(await runner.run(job)).toEqual({ applied: [`notification:${notificationId}`], skipped: [] });
      expect(email.attemptsFor(notificationId)).toBe(maximumSendAttempts);
      expect(await notification(notificationId)).toMatchObject({
        status: 'failed',
        attempts: maximumSendAttempts,
        failure: 'emailUnavailable',
      });
      const alerts = alertRows.parse(
        (
          await harness.superuser.query(
            'select id, kind, key, params, notified_at from operational_alerts where tenant_id = $1 and key = $2',
            [harness.tenantA, `notification:${notificationId}`],
          )
        ).rows,
      );
      expect(alerts).toMatchObject([
        {
          kind: 'notificationDeliveryFailed',
          params: { notificationId, template: 'rfqAmended', attempts: maximumSendAttempts },
          notified_at: null,
        },
      ]);
      expect(await inboxFor(contact.address)).toEqual([]);

      // A later redelivery finds the notification failed and tries nothing more.
      await runner.run({ ...job, id: randomUUID() });
      expect(email.attemptsFor(notificationId)).toBe(maximumSendAttempts);
    });

    it('counts an email port that throws as a failed attempt and keeps the address out of the logs', async () => {
      const contact = newContact();
      email.throwingAddresses.add(contact.address);
      logged.length = 0;
      const response = await amendRfq([contact.id]);
      const [notificationId] = amended.parse(response.body).notificationIds;
      if (notificationId === undefined) {
        throw new Error('One notification expected');
      }
      await expect(runner.run(await sendJobFor(notificationId))).rejects.toThrow(JobItemFailedError);
      expect(email.attemptsFor(notificationId)).toBe(1);
      expect(await notification(notificationId)).toMatchObject({ status: 'pending' });
      expect(logged.some((line) => line.includes('email port threw'))).toBe(true);
      expect(logged.filter((line) => line.includes(contact.address))).toEqual([]);
    });

    it('keeps a sent or failed notification from ever changing again', async () => {
      const contact = newContact();
      const response = await amendRfq([contact.id]);
      const [notificationId] = amended.parse(response.body).notificationIds;
      if (notificationId === undefined) {
        throw new Error('One notification expected');
      }
      await runner.run(await sendJobFor(notificationId));
      let refusal = '';
      try {
        await transactions.run(harness.tenantA, (database) =>
          database.execute(
            sql`update notifications set status = 'pending', sent_at = null where id = ${notificationId}`,
          ),
        );
      } catch (error) {
        refusal = describeError(error);
      }
      expect(refusal).toMatch(/pl\.notifications\.final/);
      expect(await notification(notificationId)).toMatchObject({ status: 'sent' });
    });
  });

  describe('operational alerts', () => {
    it('delivers a failed chain check to the configured recipient by email, linking to the staff app', async () => {
      const opsAddress = `ops-${randomUUID().slice(0, 8)}@tenant-a.example`;
      const recipientId = await addRecipient(adminA.token, opsAddress);
      const alert = await raiseAlert(harness.tenantA, 'chainVerificationFailed', {
        firstFailingSeq: 42,
        reason: 'entryHashMismatch',
      });

      const delivery = await runner.run(deliveryJob(harness.tenantA));
      expect(delivery.applied).toContain(`alert:${alert.id}`);
      expect((await alertById(alert.id))?.notified_at).toBeInstanceOf(Date);
      const [recorded, ...others] = await notificationsWhere('operational_alert_id = $1', [alert.id]);
      expect(others).toEqual([]);
      expect(recorded).toMatchObject({
        channel: 'email',
        template: 'alertChainVerificationFailed',
        recipient_kind: 'alertRecipient',
        recipient_id: recipientId,
        params: { firstFailingSeq: 42 },
        status: 'pending',
      });
      if (recorded === undefined) {
        throw new Error('One notification expected');
      }
      const job = await sendJobFor(recorded.id);
      expect(job.data).toMatchObject({ tenantId: harness.tenantA, cause: 'schedule', source: deliverySchedule });

      await runner.run(job);
      const [message] = await inboxFor(opsAddress);
      expect(message).toMatchObject({
        to: opsAddress,
        subject: 'Partledger alert for Synthetic tenant-a: the audit trail check failed',
      });
      expect(message?.text).toContain('failed at entry 42');
      expect(message?.text).toContain(`Open Partledger: ${staffOrigin}/`);
      expect(await notification(recorded.id)).toMatchObject({ status: 'sent', attempts: 1 });
    });

    it("takes a chain that fails its nightly check all the way to an email in the recipient's inbox", async () => {
      const tenantId = await insertTenant(harness.superuser, `tenant-${randomUUID().slice(0, 8)}`);
      const admin = await harness.issue('staff_session', tenantId, { roles: ['tenant_admin'] });
      const address = `ops-${randomUUID().slice(0, 8)}@tenant-new.example`;
      await addRecipient(admin.token, address);
      await harness.superuser.query('begin');
      try {
        await harness.superuser.query('alter table audit_entries disable trigger audit_entries_refuse_update_delete');
        await harness.superuser.query(
          `update audit_entries set payload = jsonb_set(payload, '{data,tampered}', 'true')
            where tenant_id = $1 and seq = 1`,
          [tenantId],
        );
        await harness.superuser.query(
          'alter table audit_entries enable always trigger audit_entries_refuse_update_delete',
        );
        await harness.superuser.query('commit');
      } catch (error) {
        await harness.superuser.query('rollback');
        throw error;
      }
      const nightly = 'audit.nightlyChainVerification';
      await runner.run({
        id: randomUUID(),
        name: 'audit.verifyChain',
        data: { tenantId, cause: 'schedule', source: nightly, payload: {} },
      });
      await runner.run(deliveryJob(tenantId));
      const [recorded] = await notificationsWhere('tenant_id = $1', [tenantId]);
      if (recorded === undefined) {
        throw new Error('One notification expected');
      }
      await runner.run(await sendJobFor(recorded.id));
      const [message, ...others] = await inboxFor(address);
      expect(others).toEqual([]);
      expect(message?.subject).toBe(
        `Partledger alert for Synthetic ${await tenantSlug(tenantId)}: the audit trail check failed`,
      );
      expect(message?.text).toContain('failed at entry 1.');
    });

    it('schedules the delivery of operational alerts every five minutes for every enrolled tenant', async () => {
      const tenantId = await insertTenant(harness.superuser, `tenant-${randomUUID().slice(0, 8)}`);
      await harness.api.app.get(JobScheduler).enrollTenant(tenantId);
      const result = await harness.superuser.query(
        `select name, key, cron, timezone, data from pl_jobs.schedule where data ->> 'tenantId' = $1 and name = $2`,
        [tenantId, deliveryJobName],
      );
      expect(result.rows).toEqual([
        {
          name: deliveryJobName,
          key: `${deliverySchedule}/${tenantId}`,
          cron: '*/5 * * * *',
          timezone: 'UTC',
          data: { tenantId, cause: 'schedule', source: deliverySchedule, payload: {} },
        },
      ]);
    });

    it('delivers each alert once to each recipient, however often and however concurrently its delivery runs', async () => {
      const addresses = [0, 1].map(() => `ops-${randomUUID().slice(0, 8)}@tenant-a.example`);
      for (const address of addresses) {
        await addRecipient(adminA.token, address);
      }
      const alert = await raiseAlert(harness.tenantA, 'scannerUnavailable', {});
      await Promise.all([runner.run(deliveryJob(harness.tenantA)), runner.run(deliveryJob(harness.tenantA))]);
      await runner.run(deliveryJob(harness.tenantA));

      const recorded = await notificationsWhere('operational_alert_id = $1', [alert.id]);
      const activeRecipients = await harness.count(
        'select 1 from alert_recipients where tenant_id = $1 and removed_at is null',
        [harness.tenantA],
      );
      expect(recorded).toHaveLength(activeRecipients);
      for (const row of recorded) {
        const jobs = await sendJobsFor(row.id);
        expect(jobs).toHaveLength(1);
        const [job] = jobs;
        if (job !== undefined) {
          await Promise.all([runner.run(job), runner.run({ ...job, id: randomUUID() })]);
        }
        expect(email.attemptsFor(row.id)).toBe(1);
      }
      for (const address of addresses) {
        expect((await inboxFor(address)).map((message) => message.subject)).toContain(
          'Partledger alert for Synthetic tenant-a: uploaded files cannot be scanned',
        );
      }

      let refusal = '';
      try {
        await transactions.run(harness.tenantA, (database) =>
          database.execute(sql`update operational_alerts set notified_at = now() where id = ${alert.id}`),
        );
      } catch (error) {
        refusal = describeError(error);
      }
      expect(refusal).toMatch(/pl\.notifications\.final/);
    });

    it('keeps an alert undelivered while the tenant has no recipient, and delivers it once one is configured', async () => {
      const tenantId = await insertTenant(harness.superuser, `tenant-${randomUUID().slice(0, 8)}`);
      const admin = await harness.issue('staff_session', tenantId, { roles: ['tenant_admin'] });
      const alert = await raiseAlert(tenantId, 'dropMissed', {});
      logged.length = 0;
      expect(await runner.run(deliveryJob(tenantId))).toEqual({ applied: [], skipped: [] });
      expect((await alertById(alert.id))?.notified_at).toBeNull();
      expect(logged.some((line) => line.includes(tenantId) && line.includes('no alert recipients'))).toBe(true);

      const address = `ops-${randomUUID().slice(0, 8)}@tenant-new.example`;
      await addRecipient(admin.token, address);
      expect((await runner.run(deliveryJob(tenantId))).applied).toEqual([`alert:${alert.id}`]);
      const [recorded] = await notificationsWhere('operational_alert_id = $1', [alert.id]);
      if (recorded === undefined) {
        throw new Error('One notification expected');
      }
      await runner.run(await sendJobFor(recorded.id));
      expect((await inboxFor(address)).map((message) => message.subject)).toEqual([
        `Partledger alert for Synthetic ${await tenantSlug(tenantId)}: an ERP export did not arrive`,
      ]);
    });

    it("delivers a failed email's alert to the recipients, and raises no further alert when that email fails too", async () => {
      const tenantId = await insertTenant(harness.superuser, `tenant-${randomUUID().slice(0, 8)}`);
      const admin = await harness.issue('staff_session', tenantId, { roles: ['tenant_admin'] });
      const address = `ops-${randomUUID().slice(0, 8)}@tenant-new.example`;
      await addRecipient(admin.token, address);
      const failed = await raiseAlert(tenantId, 'notificationDeliveryFailed', {
        notificationId: randomUUID(),
        template: 'rfqAmended',
        attempts: maximumSendAttempts,
      });
      email.failingAddresses.add(address);
      await runner.run(deliveryJob(tenantId));
      const [recorded] = await notificationsWhere('operational_alert_id = $1', [failed.id]);
      if (recorded === undefined) {
        throw new Error('One notification expected');
      }
      expect(recorded.params).toEqual({ attempts: maximumSendAttempts });
      const job = await sendJobFor(recorded.id);
      for (let attempt = 1; attempt <= maximumSendAttempts; attempt += 1) {
        try {
          await runner.run(job);
        } catch (error) {
          expect(error).toBeInstanceOf(JobItemFailedError);
        }
      }
      expect(await notification(recorded.id)).toMatchObject({ status: 'failed', failure: 'emailUnavailable' });
      expect(await harness.count('select 1 from operational_alerts where tenant_id = $1', [tenantId])).toBe(1);
    });

    it('tells the recipients how many attempts a failed email had', async () => {
      const tenantId = await insertTenant(harness.superuser, `tenant-${randomUUID().slice(0, 8)}`);
      const admin = await harness.issue('staff_session', tenantId, { roles: ['tenant_admin'] });
      const address = `ops-${randomUUID().slice(0, 8)}@tenant-new.example`;
      await addRecipient(admin.token, address);
      const failed = await raiseAlert(tenantId, 'notificationDeliveryFailed', {
        notificationId: randomUUID(),
        template: 'rfqAmended',
        attempts: maximumSendAttempts,
      });
      await runner.run(deliveryJob(tenantId));
      const [recorded] = await notificationsWhere('operational_alert_id = $1', [failed.id]);
      if (recorded === undefined) {
        throw new Error('One notification expected');
      }
      await runner.run(await sendJobFor(recorded.id));
      const [message] = await inboxFor(address);
      expect(message?.subject).toBe(
        `Partledger alert for Synthetic ${await tenantSlug(tenantId)}: an email could not be delivered`,
      );
      expect(message?.text).toContain(`after ${maximumSendAttempts} attempts`);
    });

    it('keeps alert recipient addresses out of the outbox, job payloads and audit entries', async () => {
      const address = `ops-${randomUUID().slice(0, 8)}@tenant-a.example`;
      await addRecipient(adminA.token, address);
      const alert = await raiseAlert(harness.tenantA, 'dropMissed', {});
      await runner.run(deliveryJob(harness.tenantA));
      for (const row of await notificationsWhere('operational_alert_id = $1', [alert.id])) {
        await runner.run(await sendJobFor(row.id));
      }
      expect(await inboxFor(address)).toHaveLength(1);
      const pattern = `%${address}%`;
      expect(await harness.count('select 1 from notifications where params::text like $1', [pattern])).toBe(0);
      expect(await harness.count('select 1 from pl_jobs.job where data::text like $1', [pattern])).toBe(0);
      expect(
        await harness.count(
          `select 1 from audit_entries
            where payload::text like $1 or convert_from(canonical, 'UTF8') like $1 or acted_under::text like $1`,
          [pattern],
        ),
      ).toBe(0);
      expect(logged.filter((line) => line.includes(address))).toEqual([]);
    });
  });

  describe('the staff shell', () => {
    it("lists the tenant's operational alerts and the reader's own in-app notifications, newest first", async () => {
      const alert = await raiseAlert(harness.tenantA, 'chainVerificationFailed', { firstFailingSeq: 7, reason: 'x' });
      harness.clock.advance(1_000);
      const evidenceId = randomUUID();
      const response = await harness.command(
        'staff',
        'notificationsTest.flagExpiringEvidence',
        { evidenceId, daysLeft: 21, personId: buyerA.subjectId },
        { token: qualityA.token },
      );
      expect(response.status).toBe(200);
      const { notificationId } = flagged.parse(response.body);
      expect(await notification(notificationId)).toMatchObject({ channel: 'inApp', status: 'sent', attempts: 0 });
      expect(await sendJobsFor(notificationId)).toEqual([]);

      const read = await harness.query('staff', 'notifications.alerts', {}, buyerA.token);
      expect(read.status).toBe(200);
      const { alerts } = staffAlertsSchema.parse(read.body);
      const [newest] = alerts;
      expect(newest).toMatchObject({
        alertId: notificationId,
        source: 'notification',
        titleKey: 'pl.notifications.inApp.evidenceExpiring.title',
        params: { evidenceId, daysLeft: 21 },
        path: null,
      });
      const operational = alerts.find((candidate) => candidate.alertId === alert.id);
      expect(operational).toMatchObject({
        source: 'operational',
        titleKey: 'pl.notifications.alert.chainVerificationFailed.title',
        params: { firstFailingSeq: 7, reason: 'x' },
      });
      for (const shown of alerts) {
        expect(() => formatMessage(shown.titleKey, shown.params)).not.toThrow();
        expect(() => formatMessage(shown.descriptionKey, shown.params)).not.toThrow();
      }
      expect(alerts.map((shown) => shown.raisedAt)).toEqual(
        [...alerts.map((shown) => shown.raisedAt)].sort((left, right) => right.localeCompare(left)),
      );

      const otherReader = await harness.query('staff', 'notifications.alerts', {}, qualityA.token);
      const otherAlerts = staffAlertsSchema.parse(otherReader.body).alerts;
      expect(otherAlerts.some((shown) => shown.alertId === notificationId)).toBe(false);
      expect(otherAlerts.some((shown) => shown.alertId === alert.id)).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it("never shows, delivers or sends one tenant's alerts and notifications to another", async () => {
      const addressB = `ops-${randomUUID().slice(0, 8)}@tenant-b.example`;
      const recipientB = await addRecipient(adminB.token, addressB);
      const alertA = await raiseAlert(harness.tenantA, 'scannerUnavailable', {});

      await runner.run(deliveryJob(harness.tenantB));
      expect((await alertById(alertA.id))?.notified_at).toBeNull();
      expect(await notificationsWhere('recipient_id = $1', [recipientB])).toEqual([]);

      const readerB = await harness.issue('staff_session', harness.tenantB, { roles: ['auditor'] });
      const readB = await harness.query('staff', 'notifications.alerts', {}, readerB.token);
      expect(readB.status).toBe(200);
      expect(staffAlertsSchema.parse(readB.body).alerts.some((shown) => shown.alertId === alertA.id)).toBe(false);

      const contact = newContact();
      const [notificationA] = amended.parse((await amendRfq([contact.id])).body).notificationIds;
      if (notificationA === undefined) {
        throw new Error('One notification expected');
      }
      const jobA = await sendJobFor(notificationA);
      const envelopeA = z.record(z.string(), z.unknown()).parse(jobA.data);
      await runner.run({ id: randomUUID(), name: jobA.name, data: { ...envelopeA, tenantId: harness.tenantB } });
      expect(email.attemptsFor(notificationA)).toBe(0);
      expect(await notification(notificationA)).toMatchObject({ status: 'pending' });

      const removal = await harness.command(
        'staff',
        'notifications.removeAlertRecipient',
        { alertRecipientId: recipientB },
        { token: adminA.token },
      );
      expect(removal.status).toBe(404);
      expect(
        await harness.count('select 1 from alert_recipients where id = $1 and removed_at is null', [recipientB]),
      ).toBe(1);
    });
  });

  describe('alert recipients', () => {
    it('lets a tenant admin add and remove a recipient, auditing the address only as a commitment', async () => {
      const address = `Ops-${randomUUID().slice(0, 8)}@Tenant-A.example`;
      const recipientId = await addRecipient(adminA.token, address);
      const duplicate = await harness.command(
        'staff',
        'notifications.addAlertRecipient',
        { emailAddress: address.toLowerCase() },
        { token: adminA.token },
      );
      expect(duplicate.status).toBe(409);
      expect(
        await harness.count('select 1 from alert_recipients where id = $1 and email_address = $2', [
          recipientId,
          address.toLowerCase(),
        ]),
      ).toBe(1);
      const entries = await harness.superuser.query(
        `select payload from audit_entries where tenant_id = $1 and payload ->> 'event' = 'notifications.addAlertRecipient'
          and payload -> 'data' -> 'output' ->> 'alertRecipientId' = $2`,
        [harness.tenantA, recipientId],
      );
      expect(entries.rows).toHaveLength(1);
      expect(JSON.stringify(entries.rows)).not.toContain(address.toLowerCase());
      expect(JSON.stringify(entries.rows)).toContain('"commitment"');

      const removal = await harness.command(
        'staff',
        'notifications.removeAlertRecipient',
        { alertRecipientId: recipientId },
        { token: adminA.token },
      );
      expect(removal.status).toBe(200);
      const again = await harness.command(
        'staff',
        'notifications.removeAlertRecipient',
        { alertRecipientId: recipientId },
        { token: adminA.token },
      );
      expect(again.status).toBe(404);
    });

    it('refuses recipient changes to anyone but a tenant admin', async () => {
      const response = await harness.command(
        'staff',
        'notifications.addAlertRecipient',
        { emailAddress: 'someone@tenant-a.example' },
        { token: buyerA.token },
      );
      expect(response.status).toBe(403);
    });
  });

  async function tenantSlug(tenantId: string): Promise<string> {
    const result = await harness.superuser.query('select slug from tenants where id = $1', [tenantId]);
    return z.tuple([z.object({ slug: z.string() })]).parse(result.rows)[0].slug;
  }
});
