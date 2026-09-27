import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { GleifClient } from './gleif.client';
import { identityRegisters, registersOf, type IdentityRegisters } from './identity-registers';
import { ViesClient } from './vies.client';

export interface IdentityChecksOptions {
  readonly config: Pick<AppConfig, 'VIES_API_URL' | 'GLEIF_API_URL' | 'IDENTITY_CHECK_TIMEOUT_MILLISECONDS'>;
  /** Tests replace the registers; production asks VIES and GLEIF. */
  readonly registers?: IdentityRegisters | undefined;
}

/** The identity registers port the identity-check job asks (R10, KTD36). */
@Module({})
export class IdentityChecksModule {
  static register({ config, registers }: IdentityChecksOptions): DynamicModule {
    const timeoutMilliseconds = config.IDENTITY_CHECK_TIMEOUT_MILLISECONDS;
    return {
      module: IdentityChecksModule,
      global: true,
      providers: [
        {
          provide: identityRegisters,
          useValue:
            registers ??
            registersOf({
              vies: new ViesClient({ baseUrl: config.VIES_API_URL, timeoutMilliseconds }),
              lei: new GleifClient({ baseUrl: config.GLEIF_API_URL, timeoutMilliseconds }),
            }),
        },
      ],
      exports: [identityRegisters],
    };
  }
}
