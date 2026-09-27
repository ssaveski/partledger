import type { AiProcessingRegion } from '@partledger/contracts';
import { domainError, failure, success, type DomainErrorOf, type Result } from '@partledger/domain';

/**
 * The per-tenant region restriction (R30, KTD3). It is off unless the tenant turns it on; when
 * on, AI calls must be processed in the tenant's own region. The local development adapter
 * sends nothing anywhere, so it is always allowed.
 */

export interface TenantAiRegion {
  readonly region: 'ca' | 'eu';
  readonly regionRestricted: boolean;
}

export type AiRegionNotAllowed = DomainErrorOf<{
  readonly tag: 'Unprocessable';
  readonly reason: 'aiRegionNotAllowed';
}>;

export function checkRegionPolicy(
  tenant: TenantAiRegion,
  processingRegion: AiProcessingRegion,
): Result<void, AiRegionNotAllowed> {
  if (!tenant.regionRestricted || processingRegion === 'local' || processingRegion === tenant.region) {
    return success(undefined);
  }
  return failure(domainError('Unprocessable', 'aiRegionNotAllowed', { tenantRegion: tenant.region, processingRegion }));
}
