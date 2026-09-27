import { randomUUID } from 'node:crypto';

import { englishCatalogue, formatMessage, operationalAlertKinds } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  alertTemplates,
  evidenceExpiringTemplate,
  notificationTemplates,
  rfqAmendedTemplate,
  templateNames,
} from './index';
import { messageParamsOf, renderEmail } from './render';
import {
  countedMessageKey,
  defineTemplate,
  InvalidTemplateError,
  templateField,
  type NotificationTemplate,
} from './template';

const origins = { staff: 'https://app.example', portal: 'https://suppliers.example' };

/** A value for every declared param, as a template would receive it. */
function sampleParams(template: NotificationTemplate): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(template.params.shape)) {
    values[name] =
      schema instanceof z.ZodUUID
        ? randomUUID()
        : schema instanceof z.ZodNumber
          ? 3
          : schema instanceof z.ZodEnum
            ? schema.options[0]
            : 'sampleCode';
  }
  return template.params.parse(values);
}

describe('notification templates', () => {
  it('have every message their channel needs, and fill every placeholder from their params', () => {
    for (const template of notificationTemplates) {
      const params = sampleParams(template);
      if (template.channel === 'email') {
        for (const recipientKind of template.audiences) {
          const rendered = renderEmail(template, params, { tenantName: 'Synthetic Tenant', origins, recipientKind });
          expect(rendered.subject, template.name).not.toMatch(/[{}]/);
          expect(rendered.text, template.name).not.toMatch(/[{}]/);
        }
      } else {
        for (const part of ['title', 'description']) {
          const key = `pl.notifications.inApp.${template.name}.${part}`;
          const counted = countedMessageKey(template, key, params);
          expect(() => formatMessage(counted, messageParamsOf(params)), counted).not.toThrow();
        }
      }
    }
  });

  it('give every operational alert kind an email template and in-app wording', () => {
    for (const kind of operationalAlertKinds) {
      expect(alertTemplates[kind].audiences).toEqual(['alertRecipient', 'operator']);
      const params = sampleParams(alertTemplates[kind]);
      for (const part of ['title', 'description']) {
        const key = countedMessageKey(alertTemplates[kind], `pl.notifications.alert.${kind}.${part}`, params);
        expect(Object.hasOwn(englishCatalogue, key), key).toBe(true);
      }
    }
  });

  it('render a supplier email as the link, the reason for it and the tenant, and nothing more', () => {
    const rfqId = randomUUID();
    const rendered = renderEmail(
      rfqAmendedTemplate,
      { rfqId, version: 3 },
      { tenantName: 'Synthetic Tenant', origins, recipientKind: 'supplierContact' },
    );
    expect(rendered.subject).toBe('Synthetic Tenant changed a request for quotation');
    expect(rendered.text).toBe(
      [
        'Hello,',
        '',
        'Synthetic Tenant published version 3 of a request for quotation that your company was invited to. Answers on lines that changed must be submitted again before the deadline.',
        '',
        `Review the request: https://suppliers.example/rfqs/${rfqId}`,
        '',
        'You received this email because you are a contact of a supplier that Synthetic Tenant works with. The link opens the Partledger supplier portal. For your security this email never contains prices, part numbers or line details.',
        '',
        'Partledger',
        '',
      ].join('\n'),
    );
  });

  it('refuse a param that is not an identifier, count or code', () => {
    expect(() =>
      defineTemplate({
        name: 'freeText',
        channel: 'email',
        audiences: ['supplierContact'],
        params: { lineDescription: z.string() },
        link: () => ({ app: 'portal', path: '/' }),
      }),
    ).toThrow(InvalidTemplateError);
    expect(() => rfqAmendedTemplate.params.parse({ rfqId: randomUUID(), version: 1, unitPrice: 12.5 })).toThrow();
    expect(() => templateField.code().parse('PN-48213-A')).toThrow();
  });

  it('refuse an in-app template for anyone but a person, and an email without a link', () => {
    expect(() =>
      defineTemplate({
        name: 'portalAlert',
        channel: 'inApp',
        audiences: ['supplierContact'],
        params: {},
        link: () => null,
      }),
    ).toThrow(/for people only/);
    const linkless = defineTemplate({
      name: 'linkless',
      channel: 'email',
      audiences: ['alertRecipient'],
      params: {},
      link: () => null,
    });
    expect(() => linkless.link({})).toThrow(/must carry a link/);
    const offsite = defineTemplate({
      name: 'offsite',
      channel: 'email',
      audiences: ['alertRecipient'],
      params: {},
      link: () => ({ app: 'staff', path: '//elsewhere.example/phish' }),
    });
    expect(() => offsite.link({})).toThrow(/not a path/);
  });

  it('names every template and recipient kind, so an alert about a failed email can say which failed', () => {
    expect([...templateNames].sort()).toEqual(notificationTemplates.map((template) => template.name).sort());
    for (const name of templateNames) {
      expect(Object.hasOwn(englishCatalogue, `pl.notifications.templateName.${name}`), name).toBe(true);
    }
    for (const kind of ['person', 'supplierContact', 'alertRecipient', 'operator']) {
      expect(Object.hasOwn(englishCatalogue, `pl.notifications.recipientKind.${kind}`), kind).toBe(true);
      expect(Object.hasOwn(englishCatalogue, `pl.notifications.email.footer.${kind}`), kind).toBe(true);
    }
  });

  it('tells the recipients of a failed email which email failed, for whom, after how many attempts, and what to check', () => {
    const rendered = renderEmail(
      alertTemplates.notificationDeliveryFailed,
      { notificationId: randomUUID(), template: 'rfqAmended', recipientKind: 'supplierContact', attempts: 4 },
      { tenantName: 'Synthetic Tenant', origins, recipientKind: 'alertRecipient' },
    );
    expect(rendered.text).toContain(
      'could not deliver the notice of a changed request for quotation to a supplier contact after 4 attempts',
    );
    expect(rendered.text).toContain("Check that the recipient's email address is correct");
  });

  it('chooses the plural form of a counted message by its count', () => {
    const description = (daysLeft: number) =>
      countedMessageKey(evidenceExpiringTemplate, 'pl.notifications.inApp.evidenceExpiring.description', { daysLeft });
    expect(formatMessage(description(0), { daysLeft: 0 })).toBe('A supplier document expires today.');
    expect(formatMessage(description(1), { daysLeft: 1 })).toBe('A supplier document expires in 1 day.');
    expect(formatMessage(description(21), { daysLeft: 21 })).toBe('A supplier document expires in 21 days.');
  });

  it('links expiring evidence to evidence review in the staff app', () => {
    expect(evidenceExpiringTemplate.link({ evidenceId: randomUUID(), supplierId: randomUUID(), daysLeft: 3 })).toEqual({
      app: 'staff',
      path: '/evidence',
    });
  });
});
