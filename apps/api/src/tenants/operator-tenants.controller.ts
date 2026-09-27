import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Body, Controller, HttpCode, Inject, NotFoundException, Post, Req, Res } from '@nestjs/common';
import { correlationIdHeader, provisionTenantInputSchema, type ProvisionTenantOutput } from '@partledger/contracts';
import { domainError } from '@partledger/domain';

import { DomainFailure, RequestValidationFailure, UnauthenticatedFailure } from '../http/failures';
import { entryAdapterOf } from '../listeners/listeners';
import { OperatorAuthenticator } from '../listeners/operator.listener';
import { clock, type Clock } from '../time/clock';
import { TenantProvisioning } from './tenant-provisioning';

/**
 * `POST /api/v1/operator/tenants`, on the operator listener only (KTD30): a signed-in operator
 * provisions a tenant. Elsewhere the route does not exist.
 */
@Controller('operator')
export class OperatorTenantsController {
  constructor(
    @Inject(OperatorAuthenticator) private readonly operators: OperatorAuthenticator,
    @Inject(TenantProvisioning) private readonly provisioning: TenantProvisioning,
    @Inject(clock) private readonly time: Clock,
  ) {}

  @Post('tenants')
  @HttpCode(201)
  async provision(
    @Body() body: unknown,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<ProvisionTenantOutput> {
    if (entryAdapterOf(request) !== 'operator') {
      throw new NotFoundException();
    }
    const correlationId = randomUUID();
    response.setHeader(correlationIdHeader, correlationId);
    response.setHeader('cache-control', 'no-store');
    const operator = await this.operators.authenticate(request.headers.authorization, this.time.now());
    if (!operator.ok) {
      throw operator.error === 'unavailable'
        ? new DomainFailure(domainError('Unavailable', 'dependencyUnavailable'))
        : new UnauthenticatedFailure();
    }
    const input = provisionTenantInputSchema.safeParse(body);
    if (!input.success) {
      throw new RequestValidationFailure(
        input.error.issues.map((issue) => ({
          path: issue.path.filter((segment) => typeof segment !== 'symbol'),
          code: issue.code,
        })),
      );
    }
    const provisioned = await this.provisioning.provision(input.data, {
      operatorId: operator.value.operatorId,
      correlationId,
    });
    if (!provisioned.ok) {
      throw new DomainFailure(provisioned.error);
    }
    return provisioned.value;
  }
}
