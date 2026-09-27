import { pluralMessageKey } from '@partledger/contracts';
import type { schema } from '@partledger/db';
import { z } from 'zod';

import { auditTokenPattern } from '../../audit/audit-payload';

/**
 * Notification templates (KTD33). A template names its channel, who it is for, the values it
 * carries and the link it opens; its text lives in the message catalogue under
 * `pl.notifications.<email|inApp>.<name>.*`. Values are declared only through `templateField`:
 * identifiers, counts and codes, never free text. So a notification cannot carry RFQ content
 * (prices, part numbers, line descriptions) or personal data, whatever its caller passes.
 */

export type NotificationChannel = (typeof schema.notificationChannels)[number];

export type RecipientKind = (typeof schema.notificationRecipientKinds)[number];

export const templateNamePattern = /^[a-z][a-zA-Z0-9]{0,99}$/;

const templateFields = new WeakSet<z.ZodType>();

function declaredField<Schema extends z.ZodType>(schema: Schema): Schema {
  templateFields.add(schema);
  return schema;
}

/** The only values a template may carry. */
export const templateField = {
  id: () => declaredField(z.uuid()),
  count: () => declaredField(z.number().int().min(0)),
  code: () => declaredField(z.string().max(100).regex(auditTokenPattern)),
  oneOf: <const Values extends readonly [string, ...string[]]>(values: Values) => declaredField(z.enum(values)),
};

export type TemplateShape = Readonly<Record<string, z.ZodType>>;

/** Which app a link opens, and the path inside it; the origin comes from configuration. */
export interface LinkTarget {
  readonly app: 'staff' | 'portal';
  readonly path: string;
}

export interface NotificationTemplate<
  Name extends string = string,
  Shape extends TemplateShape = TemplateShape,
  Audience extends RecipientKind = RecipientKind,
> {
  readonly name: Name;
  readonly channel: NotificationChannel;
  /** The kinds of recipient it may be sent to; the email's footer says why each received it. */
  readonly audiences: readonly Audience[];
  readonly params: z.ZodObject<Shape>;
  /** The param that chooses the plural form of the body or description (`.zero`, `.one`, `.other`). */
  readonly countParam: string | null;
  /** Params whose value names a message: `<prefix>.<value>` is translated before it is filled in. */
  readonly keyParams: Readonly<Record<string, string>>;
  /** What the notification opens. Every email carries a link; an in-app alert may have none. */
  link(params: z.output<z.ZodObject<Shape>>): LinkTarget | null;
}

export type TemplateParams<Template extends NotificationTemplate> = z.output<Template['params']>;

export class InvalidTemplateError extends Error {
  constructor(name: string, problem: string) {
    super(`Notification template ${name}: ${problem}`);
    this.name = 'InvalidTemplateError';
  }
}

/** A path inside an app: slash-separated segments of letters, digits and hyphens. */
const linkPathPattern = /^\/(?:[a-zA-Z0-9-]+(?:\/[a-zA-Z0-9-]+)*)?$/;

export function defineTemplate<
  const Name extends string,
  const Shape extends TemplateShape,
  const Audience extends RecipientKind,
>(template: {
  readonly name: Name;
  readonly channel: NotificationChannel;
  readonly audiences: readonly [Audience, ...Audience[]];
  readonly params: Shape;
  readonly countParam?: keyof Shape & string;
  readonly keyParams?: Readonly<Partial<Record<keyof Shape & string, string>>>;
  readonly link: (params: z.output<z.ZodObject<Shape>>) => LinkTarget | null;
}): NotificationTemplate<Name, Shape, Audience> {
  if (!templateNamePattern.test(template.name)) {
    throw new InvalidTemplateError(template.name, 'the name is not camelCase');
  }
  if (template.channel === 'inApp' && template.audiences.some((audience) => audience !== 'person')) {
    throw new InvalidTemplateError(template.name, 'in-app notifications are for people only');
  }
  for (const [field, schema] of Object.entries(template.params)) {
    if (!templateFields.has(schema)) {
      throw new InvalidTemplateError(template.name, `param ${field} is not built with templateField`);
    }
  }
  const keyParams: Record<string, string> = {};
  for (const [field, prefix] of Object.entries(template.keyParams ?? {})) {
    if (typeof prefix === 'string') {
      keyParams[field] = prefix;
    }
  }
  const params = z.strictObject(template.params);
  return {
    name: template.name,
    channel: template.channel,
    audiences: template.audiences,
    params,
    countParam: template.countParam ?? null,
    keyParams,
    link(values) {
      const target = template.link(values);
      if (target !== null && !linkPathPattern.test(target.path)) {
        throw new InvalidTemplateError(template.name, 'its link is not a path of the app');
      }
      if (target === null && template.channel === 'email') {
        throw new InvalidTemplateError(template.name, 'an email must carry a link');
      }
      return target;
    },
  };
}

/** The key of a template's body or description, in its plural form when it has a count. */
export function countedMessageKey(
  template: NotificationTemplate,
  baseKey: string,
  params: Readonly<Record<string, unknown>>,
): string {
  const count = template.countParam === null ? undefined : params[template.countParam];
  return typeof count === 'number' ? pluralMessageKey(baseKey, count) : baseKey;
}

/** The messages that key params name, such as `pl.notifications.templateName.rfqAmended`. */
export function keyParamsOf(
  template: NotificationTemplate,
  params: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [field, prefix] of Object.entries(template.keyParams)) {
    const value = params[field];
    if (typeof value === 'string') {
      keys[field] = `${prefix}.${value}`;
    }
  }
  return keys;
}
