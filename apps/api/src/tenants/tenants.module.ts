import { Module, type DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../config/env.schema';
import { clock, type Clock } from '../time/clock';
import { DirectoryController, regionUrls } from '../directory/directory.controller';
import { OperatorAuthenticator } from '../listeners/operator.listener';
import { identityOrganizations, type IdentityOrganizations } from './identity-organizations';
import { KeycloakOrganizations } from './keycloak-organizations';
import { OperatorTenantsController } from './operator-tenants.controller';
import { cellRegion, TenantProvisioning } from './tenant-provisioning';

export interface TenantsOptions {
  readonly config: AppConfig;
  readonly clock: Clock;
  /** Tests without Keycloak replace it; production always uses Keycloak. */
  readonly identityOrganizations?: IdentityOrganizations;
}

/** Tenant provisioning on the operator listener, the directory, and the organizations port. */
@Module({})
export class TenantsModule {
  static register({ config, clock: time, identityOrganizations: override }: TenantsOptions): DynamicModule {
    return {
      module: TenantsModule,
      global: true,
      controllers: [OperatorTenantsController, DirectoryController],
      providers: [
        {
          provide: identityOrganizations,
          useValue:
            override ??
            new KeycloakOrganizations({
              issuer: config.KEYCLOAK_ISSUER,
              clientId: config.KEYCLOAK_ADMIN_CLIENT_ID,
              clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
            }),
        },
        {
          provide: OperatorAuthenticator,
          useValue: new OperatorAuthenticator({
            issuer: config.OPERATOR_KEYCLOAK_ISSUER,
            clientId: config.OPERATOR_KEYCLOAK_CLIENT_ID,
            audience: config.OPERATOR_KEYCLOAK_AUDIENCE,
          }),
        },
        { provide: cellRegion, useValue: config.CELL_REGION },
        { provide: clock, useValue: time },
        { provide: regionUrls, useValue: config.DIRECTORY_REGION_URLS },
        TenantProvisioning,
      ],
      exports: [identityOrganizations],
    };
  }
}
