import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { emailPort, type EmailPort } from './email.port';
import { LocalEmailAdapter } from './local-email.adapter';
import { recipientDirectory, storedRecipientDirectory, type RecipientDirectory } from './recipient-directory';
import { linkOrigins, type LinkOrigins } from './templates/render';

export interface NotificationsOptions {
  readonly config: Pick<
    AppConfig,
    'EMAIL_ADAPTER' | 'EMAIL_LOCAL_INBOX_DIRECTORY' | 'EMAIL_FROM_ADDRESS' | 'STAFF_APP_ORIGIN' | 'PORTAL_APP_ORIGIN'
  >;
  /** Tests replace the adapter to make sends fail, and the directory to reach recipients of later units. */
  readonly emailPort?: EmailPort | undefined;
  readonly recipientDirectory?: RecipientDirectory | undefined;
}

/** One entry per configurable adapter; U24 adds the production provider's. */
const adapters: Readonly<Record<AppConfig['EMAIL_ADAPTER'], (config: NotificationsOptions['config']) => EmailPort>> = {
  local: (config) => new LocalEmailAdapter(config.EMAIL_LOCAL_INBOX_DIRECTORY, config.EMAIL_FROM_ADDRESS),
};

function adapterFor(config: NotificationsOptions['config']): EmailPort {
  return adapters[config.EMAIL_ADAPTER](config);
}

/** The email port, the recipient directory and the link origins the notification jobs use (KTD33, KTD36). */
@Module({})
export class NotificationsModule {
  static register(options: NotificationsOptions): DynamicModule {
    const origins: LinkOrigins = { staff: options.config.STAFF_APP_ORIGIN, portal: options.config.PORTAL_APP_ORIGIN };
    return {
      module: NotificationsModule,
      global: true,
      providers: [
        { provide: emailPort, useValue: options.emailPort ?? adapterFor(options.config) },
        { provide: recipientDirectory, useValue: options.recipientDirectory ?? storedRecipientDirectory },
        { provide: linkOrigins, useValue: origins },
      ],
      exports: [emailPort, recipientDirectory, linkOrigins],
    };
  }
}
