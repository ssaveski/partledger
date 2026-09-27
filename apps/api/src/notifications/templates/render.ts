import { formatMessage, type MessageParams } from '@partledger/contracts';

import type { LinkTarget, NotificationTemplate, TemplateParams } from './template';

/** The origins links open, from configuration: the staff app and the supplier portal (KTD30). */
export interface LinkOrigins {
  readonly staff: string;
  readonly portal: string;
}

export const linkOrigins = Symbol('LinkOrigins');

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
}

export function linkUrl(target: LinkTarget, origins: LinkOrigins): string {
  return new URL(target.path, origins[target.app]).toString();
}

/**
 * Renders an email from the template's message keys (KTD33). The text is the catalogue's
 * wording filled with the template's declared values, the tenant's name and the link; nothing
 * else reaches it, so it can never quote an RFQ's prices, part numbers or line descriptions.
 */
export function renderEmail<Template extends NotificationTemplate>(
  template: Template,
  params: TemplateParams<Template>,
  context: { readonly tenantName: string; readonly origins: LinkOrigins },
): RenderedEmail {
  const values: MessageParams = { ...messageParamsOf(params), tenantName: context.tenantName };
  const keyOf = (part: string) => `pl.notifications.email.${template.name}.${part}`;
  const target = template.link(params);
  const lines = [formatMessage('pl.notifications.email.greeting'), '', formatMessage(keyOf('body'), values)];
  if (target !== null) {
    lines.push(
      '',
      formatMessage('pl.notifications.email.link', {
        action: formatMessage(keyOf('action'), values),
        url: linkUrl(target, context.origins),
      }),
    );
  }
  lines.push(
    '',
    formatMessage(`pl.notifications.email.footer.${template.audience}`, values),
    '',
    formatMessage('pl.notifications.email.signature'),
  );
  return { subject: formatMessage(keyOf('subject'), values), text: `${lines.join('\n')}\n` };
}

/** Template values as message params: every declared value is an identifier, a count or a code. */
export function messageParamsOf(values: Readonly<Record<string, unknown>>): MessageParams {
  const params: MessageParams = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' || typeof value === 'number') {
      params[name] = value;
    }
  }
  return params;
}
