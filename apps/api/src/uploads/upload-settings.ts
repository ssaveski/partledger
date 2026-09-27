import {
  csvMediaType,
  jpegMediaType,
  pdfMediaType,
  pngMediaType,
  xlsxMediaType,
  type UploadMediaType,
} from '@partledger/contracts';

import type { AppConfig } from '../config/env.schema';

/** How much may be uploaded (KTD21, KTD22): per supplier link over its lifetime, per tenant in any 24 hours. */
export interface UploadQuotas {
  readonly linkFiles: number;
  readonly linkBytes: number;
  readonly tenantDailyFiles: number;
  readonly tenantDailyBytes: number;
}

export const uploadQuotas = Symbol('UploadQuotas');

export function uploadQuotasFrom(config: AppConfig): UploadQuotas {
  return {
    linkFiles: config.UPLOAD_LINK_QUOTA_FILES,
    linkBytes: config.UPLOAD_LINK_QUOTA_BYTES,
    tenantDailyFiles: config.UPLOAD_TENANT_DAILY_QUOTA_FILES,
    tenantDailyBytes: config.UPLOAD_TENANT_DAILY_QUOTA_BYTES,
  };
}

/** How a media type appears in audit entries, which hold tokens only (KTD17). */
export const fileTypeTokens = {
  [pdfMediaType]: 'pdf',
  [pngMediaType]: 'png',
  [jpegMediaType]: 'jpeg',
  [xlsxMediaType]: 'xlsx',
  [csvMediaType]: 'csv',
} as const satisfies Record<UploadMediaType, string>;
