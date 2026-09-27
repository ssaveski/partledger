import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProvisionTenantOutput, provisionTenantInputSchema, TenantRegion } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { refuse, success, type DomainErrorOf, type Result } from '@partledger/domain';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import { appendAuditEntry } from '../audit/audit-writer';
import { auditId, auditToken } from '../audit/audit-payload';
import { commitValue } from '../audit/commitments';
import { TenantTransactions, tenantIdSchema } from '../db/tenant-transaction';
import { CommandJobs, JobQueue } from '../jobs/enqueue';
import { enqueueTenantEnrolment } from '../jobs/tenant-enrollment.job';
import type { PlatformOperatorPrincipal } from '../principals/principal';
import { clock, type Clock } from '../time/clock';
import { identityOrganizations, type IdentityOrganizations } from './identity-organizations';
import { membershipStore } from './membership-store';

const { directoryEntries, tenants } = schema;

export const cellRegion = Symbol('CellRegion');

export type ProvisionTenantRequest = z.output<typeof provisionTenantInputSchema>;

export interface ProvisioningOperator {
  readonly operatorId: string;
  readonly correlationId: string;
}

type ProvisioningFailure = DomainErrorOf<
  | { readonly tag: 'Conflict'; readonly reason: 'alreadyExists' }
  | { readonly tag: 'Unavailable'; readonly reason: 'dependencyUnavailable' }
  | { readonly tag: 'Unprocessable'; readonly reason: 'regionNotServed' }
>;

/**
 * Provisions a tenant (R1, R3, KTD20): the only operator action that needs no break-glass
 * grant. It creates the tenant's Keycloak organization, with a `tenant_id` attribute naming the
 * tenant, and its first administrator's account in that organization only; then, in one
 * transaction whose `app.tenant_id` is the new tenant, the tenant row pinned to this region,
 * its directory entry, the administrator's membership and role, the enrolment in the scheduled
 * jobs and the genesis of the tenant's audit chain, acted by the operator. If that transaction
 * does not commit, the organization and the account are removed again.
 */
@Injectable()
export class TenantProvisioning {
  private readonly logger = new Logger('TenantProvisioning');

  constructor(
    @Inject(TenantTransactions) private readonly transactions: TenantTransactions,
    @Inject(identityOrganizations) private readonly organizations: IdentityOrganizations,
    @Inject(JobQueue) private readonly jobQueue: JobQueue,
    @Inject(clock) private readonly time: Clock,
    @Inject(cellRegion) private readonly region: TenantRegion,
  ) {}

  async provision(
    request: ProvisionTenantRequest,
    operator: ProvisioningOperator,
  ): Promise<Result<ProvisionTenantOutput, ProvisioningFailure>> {
    if (request.region !== this.region) {
      return refuse('Unprocessable', 'regionNotServed');
    }
    const tenantId = randomUUID();
    if (await this.slugTaken(tenantId, request.slug)) {
      return refuse('Conflict', 'alreadyExists');
    }
    const leftover = await this.clearLeftoverOrganization(request.slug);
    if (!leftover.ok) {
      return leftover;
    }
    const organization = await this.organizations.createOrganization({
      alias: request.slug,
      name: request.displayName,
      tenantId,
    });
    if (!organization.ok) {
      return organization.error === 'already_exists'
        ? refuse('Conflict', 'alreadyExists')
        : refuse('Unavailable', 'dependencyUnavailable');
    }
    const organizationId = organization.value;
    const admin = await this.organizations.createMember(organizationId, request.firstAdmin);
    if (!admin.ok) {
      await this.organizations.deleteOrganization(organizationId);
      return admin.error === 'already_exists'
        ? refuse('Conflict', 'alreadyExists')
        : refuse('Unavailable', 'dependencyUnavailable');
    }
    const firstAdminUserId = admin.value.userId;
    const adminCreated = admin.value.created;
    try {
      const enrolmentJobId = await this.record(request, operator, { tenantId, organizationId, firstAdminUserId });
      return success({ tenantId, organizationId, firstAdminUserId, enrolmentJobId });
    } catch (error) {
      this.logger.warn('A tenant was not provisioned; its organization and first administrator are removed again');
      if (adminCreated) {
        await this.organizations.deleteUser(firstAdminUserId);
      }
      await this.organizations.deleteOrganization(organizationId);
      throw error;
    }
  }

  /**
   * An organization with this alias whose tenant never committed is what an interrupted
   * provisioning leaves behind (the process stopped between Keycloak and the commit). It is
   * removed with its first administrator's account, so the slug can be provisioned again; an
   * organization whose tenant exists is a conflict.
   */
  private async clearLeftoverOrganization(slug: string): Promise<Result<void, ProvisioningFailure>> {
    const found = await this.organizations.findOrganization(slug);
    if (!found.ok) {
      return refuse('Unavailable', 'dependencyUnavailable');
    }
    if (found.value === null) {
      return success(undefined);
    }
    const { id, tenantId } = found.value;
    const parsedTenant = tenantIdSchema.safeParse(tenantId);
    if (parsedTenant.success && (await this.tenantExists(parsedTenant.data))) {
      return refuse('Conflict', 'alreadyExists');
    }
    this.logger.warn(
      'An organization left by an interrupted provisioning is removed before the slug is provisioned again',
    );
    const removed = await this.organizations.deleteOrganizationAndMembers(id);
    return removed.ok ? success(undefined) : refuse('Unavailable', 'dependencyUnavailable');
  }

  private tenantExists(tenantId: string): Promise<boolean> {
    return this.transactions.run(
      tenantId,
      async (database) => (await membershipStore.tenantOf(database, tenantId)) !== undefined,
    );
  }

  /** The directory is global, so it can tell whether the slug is taken before anything is created. */
  private async slugTaken(tenantId: string, slug: string): Promise<boolean> {
    return this.transactions.run(tenantId, async (database) => {
      const rows = await database
        .select({ slug: directoryEntries.slug })
        .from(directoryEntries)
        .where(eq(directoryEntries.slug, slug));
      return rows.length > 0;
    });
  }

  private record(
    request: ProvisionTenantRequest,
    operator: ProvisioningOperator,
    created: { readonly tenantId: string; readonly organizationId: string; readonly firstAdminUserId: string },
  ): Promise<string> {
    const { tenantId, organizationId, firstAdminUserId } = created;
    const now = this.time.now();
    const principal: PlatformOperatorPrincipal = {
      type: 'platform_operator',
      tenantId,
      operatorId: operator.operatorId,
      actedUnder: { grant: 'operator_sign_in' },
      adapter: 'operator',
      correlationId: operator.correlationId,
    };
    return this.transactions.run(tenantId, async (database) => {
      await database.insert(tenants).values({
        id: tenantId,
        slug: request.slug,
        displayName: request.displayName,
        region: request.region,
        enabledPacks: request.enabledPacks,
        supplierListSource: request.supplierListSource,
        aiProvider: request.aiPolicy.provider,
        aiKeyReference: request.aiPolicy.keyReference,
        aiRegionRestricted: request.aiPolicy.regionRestricted,
        baseCurrency: request.baseCurrency,
        identityOrganizationId: organizationId,
        createdAt: now,
      });
      await database.insert(directoryEntries).values({ slug: request.slug, region: request.region });
      const membershipId = await membershipStore.insertMember(database, {
        tenantId,
        userId: firstAdminUserId,
        email: request.firstAdmin.email,
        displayName: request.firstAdmin.displayName,
        invitedAt: now,
      });
      await membershipStore.grantRole(database, {
        tenantId,
        membershipId,
        role: 'tenant_admin',
        grantedAt: now,
      });
      const jobs = new CommandJobs(this.jobQueue, database, principal, 'tenants.provision');
      const enrolmentJobId = await enqueueTenantEnrolment({ database, jobs }, tenantId);
      const commit = (value: string) => commitValue(database, { tenantId, value, now });
      await appendAuditEntry(
        database,
        {
          tenantId,
          actor: {
            type: 'platform_operator',
            id: operator.operatorId,
            actedUnder: principal.actedUnder,
            adapter: 'operator',
            correlationId: operator.correlationId,
          },
          event: auditToken('tenants.provision'),
          data: {
            output: { tenantId: auditId(tenantId), firstAdminUserId: auditId(firstAdminUserId) },
            changes: [
              {
                slug: await commit(request.slug),
                displayName: await commit(request.displayName),
                region: auditToken(request.region),
                enabledPacks: request.enabledPacks.map((pack) => auditToken(pack)),
                supplierListSource: auditToken(request.supplierListSource),
                aiProvider: auditToken(request.aiPolicy.provider),
                aiRegionRestricted: request.aiPolicy.regionRestricted,
                baseCurrency: auditToken(request.baseCurrency.toLowerCase()),
                enrolmentJobId: auditId(enrolmentJobId),
                firstAdmin: {
                  member: auditId(firstAdminUserId),
                  email: await commit(request.firstAdmin.email),
                  displayName: await commit(request.firstAdmin.displayName),
                  grantedRole: auditToken('tenant_admin'),
                },
              },
            ],
          },
        },
        this.time,
      );
      return enrolmentJobId;
    });
  }
}
