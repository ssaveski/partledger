import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { correlationIdHeader, idempotencyKeyHeader, idempotentReplayHeader } from '@partledger/contracts';

import { DomainFailure, RequestValidationFailure, UnauthenticatedFailure } from '../http/failures';
import { entryAdapterOf } from '../listeners/listeners';
import { OperationExecutor, type Outcome } from './operation-executor';

/**
 * Serves every generated route: `POST commands/<name>` and `GET queries/<name>` under the
 * global `/api/v1` prefix. Nothing here decides access or status codes; the executor decides
 * the outcome and the error filter maps failures.
 */
@Controller()
export class OperationGatewayController {
  constructor(@Inject(OperationExecutor) private readonly executor: OperationExecutor) {}

  @Post('commands/:name')
  @HttpCode(200)
  async command(
    @Param('name') name: string,
    @Body() body: unknown,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const correlationId = startResponse(response);
    const outcome = await this.executor.executeCommand(name, {
      adapter: entryAdapterOf(request),
      authorization: request.headers.authorization,
      idempotencyKey: singleHeader(request.headers[idempotencyKeyHeader]),
      body,
      correlationId,
    });
    if (outcome.kind === 'success' && outcome.replayed) {
      response.setHeader(idempotentReplayHeader, 'true');
    }
    return outputOf(outcome);
  }

  @Get('queries/:name')
  async query(
    @Param('name') name: string,
    @Query('input') input: unknown,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const correlationId = startResponse(response);
    const outcome = await this.executor.executeQuery(name, {
      adapter: entryAdapterOf(request),
      authorization: request.headers.authorization,
      // A repeated or nested `input` parameter is not a JSON string and fails to parse.
      input: typeof input === 'string' || input === undefined ? input : '',
      correlationId,
    });
    return outputOf(outcome);
  }
}

function startResponse(response: ServerResponse): string {
  const correlationId = randomUUID();
  response.setHeader(correlationIdHeader, correlationId);
  response.setHeader('cache-control', 'no-store');
  return correlationId;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  // A repeated header is malformed; an empty value fails the key's schema.
  return Array.isArray(value) ? '' : value;
}

function outputOf(outcome: Outcome): unknown {
  switch (outcome.kind) {
    case 'success':
      return outcome.output;
    case 'failure':
      throw new DomainFailure(outcome.error);
    case 'invalid':
      throw new RequestValidationFailure(outcome.issues);
    case 'unauthenticated':
      throw new UnauthenticatedFailure();
  }
}
