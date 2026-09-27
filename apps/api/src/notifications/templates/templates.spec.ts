import { randomUUID } from 'node:crypto';

import { englishCatalogue, formatMessage, operationalAlertKinds } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { alertTemplates, notificationTemplates, rfqAmendedTemplate } from './index';
import { messageParamsOf, renderEmail } from './render';
import { defineTemplate, InvalidTemplateError, templateField, type NotificationTemplate } from './template';

const origins = { staff: 'https://app.example', portal: 'https://suppliers.example' };

/** A value for every declared param, as a template would receive it. */
function sampleParams(template: NotificationTemplate): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(template.params.shape)) {
    values[name] = schema instanceof z.ZodUUID ? randomUUID() : schema instanceof z.ZodNumber ? 3 : 'sampleCode';
  }
  return template.params.parse(values);
}

describe('notification templates', () => {
  it('have every message their channel needs, and fill every placeholder from their params', () => {
    for (const template of notificationTemplates) {
      const params = sampleParams(template);
      if (template.channel === 'email') {
        const rendered = renderEmail(template, params, { tenantName: 'Synthetic Tenant', origins });
        expect(rendered.subject, template.name).not.toMatch(/[{}]/);
        expect(rendered.text, template.name).not.toMatch(/[{}]/);
      } else {
        for (const part of ['title', 'description']) {
          const key = `pl.notifications.inApp.${template.name}.${part}`;
          expect(() => formatMessage(key, messageParamsOf(params)), key).not.toThrow();
        }
      }
    }
  });

  it('give every operational alert kind an email template and in-app wording', () => {
    for (const kind of operationalAlertKinds) {
      expect(alertTemplates[kind].audience).toBe('alertRecipient');
      for (const part of ['title', 'description']) {
        expect(Object.hasOwn(englishCatalogue, `pl.notifications.alert.${kind}.${part}`), `${kind}.${part}`).toBe(true);
      }
    }
  });

  it('render a supplier email as the link, the reason for it and the tenant, and nothing more', () => {
    const rfqId = randomUUID();
    const rendered = renderEmail(
      rfqAmendedTemplate,
      { rfqId, version: 3 },
      { tenantName: 'Synthetic Tenant', origins },
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
        audience: 'supplierContact',
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
        audience: 'supplierContact',
        params: {},
        link: () => null,
      }),
    ).toThrow(/for people only/);
    const linkless = defineTemplate({
      name: 'linkless',
      channel: 'email',
      audience: 'alertRecipient',
      params: {},
      link: () => null,
    });
    expect(() => linkless.link({})).toThrow(/must carry a link/);
    const offsite = defineTemplate({
      name: 'offsite',
      channel: 'email',
      audience: 'alertRecipient',
      params: {},
      link: () => ({ app: 'staff', path: '//elsewhere.example/phish' }),
    });
    expect(() => offsite.link({})).toThrow(/not a path/);
  });
});
