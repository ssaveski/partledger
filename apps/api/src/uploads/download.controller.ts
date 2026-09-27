import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';

import { Controller, Get, Inject, Logger, Param, Req, Res } from '@nestjs/common';
import { correlationIdHeader } from '@partledger/contracts';

import { DomainFailure, UnauthenticatedFailure } from '../http/failures';
import { UploadDownloads } from './upload-downloads';

/** A file name any HTTP client can read: ASCII letters, digits, dots, hyphens, underscores and spaces. */
function asciiFallback(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._ -]/g, '_');
}

/**
 * `attachment`, so a browser saves the file instead of rendering it, with the uploader's name
 * as RFC 6266 and RFC 8187 spell it; the name comes from the upload, never from the request.
 */
export function contentDisposition(fileName: string): string {
  return `attachment; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * `GET /api/v1/uploads/<id>/download` (KTD22): streams a clean file with headers that keep a
 * browser from rendering or sniffing it. Refusals go through the error filter like any other.
 */
@Controller('uploads')
export class DownloadController {
  private readonly logger = new Logger('UploadDownloads');

  constructor(@Inject(UploadDownloads) private readonly downloads: UploadDownloads) {}

  @Get(':uploadId/download')
  async download(
    @Param('uploadId') uploadId: string,
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const correlationId = randomUUID();
    response.setHeader(correlationIdHeader, correlationId);
    response.setHeader('cache-control', 'no-store');
    const outcome = await this.downloads.open(request, uploadId, correlationId);
    if (outcome.kind === 'unauthenticated') {
      throw new UnauthenticatedFailure();
    }
    if (outcome.kind === 'failure') {
      throw new DomainFailure(outcome.error);
    }
    const { file } = outcome;
    response.statusCode = 200;
    response.setHeader('content-type', file.mediaType);
    response.setHeader('content-length', String(file.sizeBytes));
    response.setHeader('content-disposition', contentDisposition(file.fileName));
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-security-policy', "sandbox; default-src 'none'");
    response.setHeader('cross-origin-resource-policy', 'same-origin');
    response.setHeader('referrer-policy', 'no-referrer');
    try {
      await pipeline(file.body, response);
    } catch {
      this.logger.warn(`A download stopped before it finished; correlation ${correlationId}`);
    }
  }
}
