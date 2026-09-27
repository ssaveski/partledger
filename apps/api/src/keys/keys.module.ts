import { readFileSync } from 'node:fs';

import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { keyService, type KeyService } from './key-service.port';
import { LocalKeyAdapter } from './local-key.adapter';
import { mutualTlsTransport, OvhKmsAdapter } from './ovh-kms.adapter';

export interface KeysOptions {
  readonly config: Pick<
    AppConfig,
    | 'KEY_SERVICE_ADAPTER'
    | 'LOCAL_KEY_SERVICE_KEY'
    | 'OVH_KMS_ENDPOINT'
    | 'OVH_KMS_ID'
    | 'OVH_KMS_ENCRYPTION_KEY_ID'
    | 'OVH_KMS_SIGNING_KEY_ID'
    | 'OVH_KMS_CLIENT_CERTIFICATE_FILE'
    | 'OVH_KMS_CLIENT_KEY_FILE'
  >;
  /** Tests replace the adapter; production always uses the configured one. */
  readonly keyService?: KeyService | undefined;
}

function adapterFor(config: KeysOptions['config']): KeyService {
  // The configuration refuses an unset or local adapter in production, and a partial KMS configuration.
  if (config.KEY_SERVICE_ADAPTER !== 'ovh_kms') {
    return new LocalKeyAdapter(config.LOCAL_KEY_SERVICE_KEY);
  }
  const { OVH_KMS_ENDPOINT, OVH_KMS_ID, OVH_KMS_ENCRYPTION_KEY_ID, OVH_KMS_SIGNING_KEY_ID } = config;
  const { OVH_KMS_CLIENT_CERTIFICATE_FILE, OVH_KMS_CLIENT_KEY_FILE } = config;
  if (
    OVH_KMS_ENDPOINT === undefined ||
    OVH_KMS_ID === undefined ||
    OVH_KMS_ENCRYPTION_KEY_ID === undefined ||
    OVH_KMS_SIGNING_KEY_ID === undefined ||
    OVH_KMS_CLIENT_CERTIFICATE_FILE === undefined ||
    OVH_KMS_CLIENT_KEY_FILE === undefined
  ) {
    throw new Error('The OVHcloud KMS adapter needs every OVH_KMS_ setting');
  }
  return new OvhKmsAdapter({
    kmsId: OVH_KMS_ID,
    encryptionKeyId: OVH_KMS_ENCRYPTION_KEY_ID,
    signingKeyId: OVH_KMS_SIGNING_KEY_ID,
    transport: mutualTlsTransport({
      endpoint: OVH_KMS_ENDPOINT,
      certificate: readFileSync(OVH_KMS_CLIENT_CERTIFICATE_FILE, 'utf8'),
      privateKey: readFileSync(OVH_KMS_CLIENT_KEY_FILE, 'utf8'),
      timeoutMilliseconds: 10_000,
    }),
  });
}

/** The key service port (KTD36), for tenant AI keys now and checkpoint signing in U21. */
@Module({})
export class KeysModule {
  static register(options: KeysOptions): DynamicModule {
    return {
      module: KeysModule,
      global: true,
      providers: [{ provide: keyService, useValue: options.keyService ?? adapterFor(options.config) }],
      exports: [keyService],
    };
  }
}
