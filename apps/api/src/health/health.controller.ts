import { Controller, Get } from '@nestjs/common';
import { healthResponseSchema, type HealthResponse } from '@partledger/contracts';

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return healthResponseSchema.parse({ status: 'ok' });
  }
}
