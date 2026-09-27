import { ServerResponse } from 'node:http';

import {
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  correlationIdHeader,
  internalErrorMessageKey,
  messageKeyOf,
  unauthenticatedMessageKey,
  validationMessageKey,
  type ErrorBody,
  type ValidationErrorBody,
} from '@partledger/contracts';
import type { DomainError } from '@partledger/domain';
import { z } from 'zod';

import { DomainFailure, RequestValidationFailure, UnauthenticatedFailure } from './failures';

/**
 * The one mapping from failures to HTTP (CLAUDE.md). The switch is exhaustive over the
 * `DomainError` union, so a new tag does not compile until it has a status here.
 */
export function httpStatusOf(error: DomainError): number {
  switch (error._tag) {
    case 'NotFound':
      return HttpStatus.NOT_FOUND;
    case 'Conflict':
      return HttpStatus.CONFLICT;
    case 'Invalid':
      return HttpStatus.BAD_REQUEST;
    case 'Unprocessable':
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case 'Forbidden':
      return HttpStatus.FORBIDDEN;
    case 'Unavailable':
      return HttpStatus.SERVICE_UNAVAILABLE;
    case 'StepUpRequired':
      // RFC 9470: re-authenticate at a higher level; the body's key tells it apart from the uniform 401.
      return HttpStatus.UNAUTHORIZED;
    default: {
      const unmapped: never = error;
      return unmapped;
    }
  }
}

export function domainErrorBody(error: DomainError): ErrorBody {
  return { error: error._tag, message: messageKeyOf({ tag: error._tag, reason: error.reason }), params: error.params };
}

export const unauthenticatedBody: ErrorBody = {
  error: 'Unauthenticated',
  message: unauthenticatedMessageKey,
  params: {},
};

const notFoundStatus: number = HttpStatus.NOT_FOUND;

const internalErrorBody: ErrorBody = { error: 'Internal', message: internalErrorMessageKey, params: {} };

export interface HttpErrorResponse {
  readonly status: number;
  readonly body: ErrorBody | ValidationErrorBody;
}

export function httpErrorResponseFor(exception: unknown): HttpErrorResponse {
  if (exception instanceof DomainFailure) {
    return { status: httpStatusOf(exception.error), body: domainErrorBody(exception.error) };
  }
  if (exception instanceof RequestValidationFailure) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { error: 'Invalid', message: validationMessageKey, issues: [...exception.issues] },
    };
  }
  if (exception instanceof UnauthenticatedFailure) {
    return { status: HttpStatus.UNAUTHORIZED, body: unauthenticatedBody };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === notFoundStatus) {
      return { status, body: domainErrorBody({ _tag: 'NotFound', reason: 'route', params: {} }) };
    }
    if (status >= 400 && status < 500) {
      return { status, body: domainErrorBody({ _tag: 'Invalid', reason: 'request', params: {} }) };
    }
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: internalErrorBody };
}

const causeWithCode = z.object({ name: z.string().optional(), code: z.string() });

/**
 * The log line for an unexpected failure. Query errors carry their bind values after
 * `params:` (Drizzle) and database errors may quote values in their message or detail, so the
 * line holds the correlation id, the error's class, the database error code, the message up to
 * any `params:` section and the stack frames, never the values.
 */
export function describeUnexpectedFailure(exception: unknown, correlationId: string | null): string {
  const correlation = `correlation ${correlationId ?? 'none'}`;
  if (!(exception instanceof Error)) {
    return `Unexpected failure (${correlation}): a thrown ${typeof exception}`;
  }
  const own = causeWithCode.safeParse(exception);
  const cause = causeWithCode.safeParse(exception.cause);
  // A database error's own message can quote the offending value, so only its code is logged.
  const [message = ''] = own.success ? [''] : exception.message.split(/\n?params:/);
  const code = own.success
    ? ` [${own.data.code}]`
    : cause.success
      ? ` [${cause.data.name ?? 'cause'} ${cause.data.code}]`
      : '';
  const frames = (exception.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  return [`Unexpected failure (${correlation}): ${exception.constructor.name}${code}: ${message}`, ...frames].join(
    '\n',
  );
}

/** Maps every exception that reaches Nest to a status and a body of message keys, never prose. */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('DomainErrorFilter');

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = httpErrorResponseFor(exception);
    const response = host.switchToHttp().getResponse<unknown>();
    if (status >= 500) {
      const correlationId = response instanceof ServerResponse ? response.getHeader(correlationIdHeader) : undefined;
      this.logger.error(describeUnexpectedFailure(exception, typeof correlationId === 'string' ? correlationId : null));
    }
    this.adapterHost.httpAdapter.reply(response, body, status);
  }
}
