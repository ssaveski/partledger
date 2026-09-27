import { uploadAccess, uploadDownloadAccess, uploadPurposes, type AccessRule } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { matrixPrincipals, principalFor, type MatrixPrincipal } from '../../test/permissions/matrix';
import { isAllowed } from '../principals/authorize';

function allowed(rule: AccessRule): MatrixPrincipal[] {
  return matrixPrincipals.filter((principal) => isAllowed(rule, principalFor(principal)));
}

/**
 * Uploads and downloads are raw requests rather than registry operations, so their access
 * rules are pinned here the way apps/api/test/permissions pins every command and query.
 */
describe('upload and download access', () => {
  it('lets buyers, quality engineers and supplier links upload evidence', () => {
    expect(allowed(uploadAccess.evidence)).toEqual(['buyer', 'quality_engineer', 'supplier_token']);
  });

  it('lets only buyers and quality engineers upload import files', () => {
    expect(allowed(uploadAccess.import)).toEqual(['buyer', 'quality_engineer']);
  });

  it('never lets a tenant admin alone, a system principal, an AI agent or an operator upload', () => {
    for (const purpose of uploadPurposes) {
      for (const principal of [
        'tenant_admin',
        'person_without_roles',
        'system_job',
        'system_drop_credential',
        'ai_agent',
        'platform_operator',
      ] as const) {
        expect(isAllowed(uploadAccess[purpose], principalFor(principal))).toBe(false);
      }
    }
  });

  it('lets buyers, quality engineers and auditors download, and no supplier link', () => {
    expect(allowed(uploadDownloadAccess)).toEqual(['buyer', 'quality_engineer', 'auditor']);
  });
});
