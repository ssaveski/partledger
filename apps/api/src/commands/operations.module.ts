import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DomainErrorFilter } from '../http/domain-error.filter';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PrincipalResolver } from '../principals/principal-resolver';
import { roleDirectory, type RoleDirectory } from '../principals/role-directory';
import { clock, type Clock } from '../time/clock';
import type { OperationRegistry } from './handlers';
import { OperationExecutor } from './operation-executor';
import { OperationGatewayController } from './operation-gateway.controller';
import { generateRoutes, operationRoutes } from './route-generator';

export interface OperationsOptions {
  readonly registry: OperationRegistry;
  readonly roleDirectory: RoleDirectory;
  readonly clock: Clock;
}

@Module({})
export class OperationsModule {
  static register(options: OperationsOptions): DynamicModule {
    const handlers = [
      ...options.registry.commands.map((registration) => registration.handler),
      ...options.registry.queries.map((registration) => registration.handler),
    ];
    return {
      module: OperationsModule,
      controllers: [OperationGatewayController],
      providers: [
        // Building the routes checks the registry rules; a registry that breaks one refuses the boot.
        { provide: operationRoutes, useFactory: () => generateRoutes(options.registry) },
        { provide: roleDirectory, useValue: options.roleDirectory },
        { provide: clock, useValue: options.clock },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
        PrincipalResolver,
        IdempotencyService,
        OperationExecutor,
        ...handlers,
      ],
    };
  }
}
