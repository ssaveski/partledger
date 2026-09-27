import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { emailPort, type EmailPort } from './email.port';
import { LocalEmailAdapter } from './local-email.adapter';
import {
  operatorFallback,
  recipientDirectory,
  storedRecipientDirectory,
  type OperatorFallback,
  type RecipientDirectory,
} from './recipient-directory';
import { linkOrigins, type LinkOrigins } from './templates/render';

export interface NotificationsOptions {
  readonly config: Pick<
    AppConfig,
    | 'EMAIL_ADAPTER'
    | 'EMAIL_LOCAL_INBOX_DIRECTORY'
    | 'EMAIL_FROM_ADDRESS'
    | 'STAFF_APP_ORIGIN'
    | 'PORTAL_APP_ORIGIN'
    | 'OPERATIONAL_ALERT_FALLBACK_EMAIL'
  >;
  /** Tests replace the adapter to make sends fail, and the directory to reach recipients of later units. */
  readonly emailPort?: EmailPort | undefined;
  readonly recipientDirectory?: RecipientDirectory | undefined;
}

/** One entry per configurable adapter; U24 adds the production provider's. */
const adapters: Readonly<
  Record<NonNullable<AppConfig['EMAIL_ADAPTER']>, (config: NotificationsOptions['config']) => EmailPort>
> = {
  local: (config) => new LocalEmailAdapter(config.EMAIL_LOCAL_INBOX_DIRECTORY, config.EMAIL_FROM_ADDRESS),
};

function adapterFor(config: NotificationsOptions['config']): EmailPort {
  // The configuration refuses an unset or local adapter in production.
  return adapters[config.EMAIL_ADAPTER ?? 'local'](config);
}

/** The email port, the recipient directory and the link origins the notification jobs use (KTD33, KTD36). */
@Module({})
export class NotificationsModule {
  static register(options: NotificationsOptions): DynamicModule {
    const origins: LinkOrigins = { staff: options.config.STAFF_APP_ORIGIN, portal: options.config.PORTAL_APP_ORIGIN };
    const fallback: OperatorFallback = { address: options.config.OPERATIONAL_ALERT_FALLBACK_EMAIL ?? null };
    return {
      module: NotificationsModule,
      global: true,
      providers: [
        { provide: emailPort, useValue: options.emailPort ?? adapterFor(options.config) },
        { provide: recipientDirectory, useValue: options.recipientDirectory ?? storedRecipientDirectory },
        { provide: linkOrigins, useValue: origins },
        { provide: operatorFallback, useValue: fallback },
      ],
      exports: [emailPort, recipientDirectory, linkOrigins, operatorFallback],
    };
  }
}
