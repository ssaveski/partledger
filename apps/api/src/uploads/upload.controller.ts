import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { correlationIdHeader } from '@partledger/contracts';

import { DomainFailure, RequestValidationFailure, UnauthenticatedFailure } from '../http/failures';
import { UploadPipeline } from './upload-pipeline';

/**
 * `POST /api/v1/uploads/<purpose>` (KTD22): the file is the raw request body, its media type
 * the `Content-Type`, and its name and the uploader's attestation travel in headers. On the
 * staff listener it needs the staff app's request header like any other change (KTD20). A
 * request refused before its body was read to the end closes its connection, so a client
 * still sending an oversized file is cut off instead of read to the end.
 */
@Controller('uploads')
export class UploadController {
  constructor(@Inject(UploadPipeline) private readonly pipeline: UploadPipeline) {}

  @Post(':purpose')
  @HttpCode(201)
  async upload(
    @Param('purpose') purpose: string,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<unknown> {
    const correlationId = randomUUID();
    response.setHeader(correlationIdHeader, correlationId);
    response.setHeader('cache-control', 'no-store');
    const outcome = await this.pipeline.receive(request, purpose, correlationId);
    if (outcome.kind === 'received') {
      return outcome.receipt;
    }
    if (outcome.kind !== 'failure' || outcome.closeConnection || !request.complete) {
      response.setHeader('connection', 'close');
    }
    switch (outcome.kind) {
      case 'failure':
        throw new DomainFailure(outcome.error);
      case 'invalid':
        throw new RequestValidationFailure(outcome.issues);
      case 'unauthenticated':
        throw new UnauthenticatedFailure();
    }
  }
}
