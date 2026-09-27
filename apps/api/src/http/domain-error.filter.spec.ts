import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ExpressAdapter } from '@nestjs/platform-express';
import { domainErrorTags, errorBodySchema, validationErrorBodySchema } from '@partledger/contracts';
import { domainError, type DomainError } from '@partledger/domain';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeUnexpectedFailure,
  DomainErrorFilter,
  domainErrorBody,
  httpErrorResponseFor,
  httpStatusOf,
} from './domain-error.filter';
import { DomainFailure, RequestValidationFailure, UnauthenticatedFailure } from './failures';

describe('the domain error filter', () => {
  it('maps every tag to a client error status', () => {
    const onePerTag: readonly DomainError[] = [
      domainError('NotFound', 'resource'),
      domainError('Conflict', 'versionMismatch'),
      domainError('Invalid', 'request'),
      domainError('Unprocessable', 'idempotencyKeyReused'),
      domainError('Forbidden', 'notPermitted'),
      domainError('Unavailable', 'dependencyUnavailable'),
      domainError('StepUpRequired', 'recentAuthentication'),
    ];
    expect(onePerTag.map((error) => error._tag)).toEqual(domainErrorTags);
    const statuses = Object.fromEntries(onePerTag.map((error) => [error._tag, httpStatusOf(error)]));
    expect(statuses).toEqual({
      NotFound: 404,
      Conflict: 409,
      Invalid: 400,
      Unprocessable: 422,
      Forbidden: 403,
      Unavailable: 503,
      StepUpRequired: 401,
    });
  });

  it('answers a domain failure with its message key and params, never prose', () => {
    const response = httpErrorResponseFor(
      new DomainFailure(domainError('Conflict', 'versionMismatch', { expectedVersion: 1, actualVersion: 2 })),
    );
    expect(response).toEqual({
      status: 409,
      body: {
        error: 'Conflict',
        message: 'pl.error.conflict.versionMismatch',
        params: { expectedVersion: 1, actualVersion: 2 },
      },
    });
    expect(errorBodySchema.parse(response.body)).toEqual(response.body);
  });

  it('answers a validation failure with paths and codes', () => {
    const response = httpErrorResponseFor(new RequestValidationFailure([{ path: ['title'], code: 'too_small' }]));
    expect(response.status).toBe(400);
    expect(validationErrorBodySchema.parse(response.body)).toEqual({
      error: 'Invalid',
      message: 'pl.error.invalid.request',
      issues: [{ path: ['title'], code: 'too_small' }],
    });
  });

  it('answers every refused credential with the same 401 body', () => {
    expect(httpErrorResponseFor(new UnauthenticatedFailure())).toEqual({
      status: 401,
      body: { error: 'Unauthenticated', message: 'pl.error.unauthenticated.credential', params: {} },
    });
  });

  it('answers an unknown route and a malformed request with message keys', () => {
    expect(httpErrorResponseFor(new NotFoundException())).toEqual({
      status: 404,
      body: domainErrorBody(domainError('NotFound', 'route')),
    });
    expect(httpErrorResponseFor(new BadRequestException('Unexpected token in JSON'))).toEqual({
      status: 400,
      body: domainErrorBody(domainError('Invalid', 'request')),
    });
  });

  it('answers an unexpected exception with a 500 that reveals nothing', () => {
    expect(httpErrorResponseFor(new Error('connection string with a password'))).toEqual({
      status: 500,
      body: { error: 'Internal', message: 'pl.error.internal.unexpected', params: {} },
    });
  });
});

describe('the log line of an unexpected failure', () => {
  const personalValue = 'buyer.person@example.test';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function queryError(): DrizzleQueryError {
    const cause = Object.assign(new Error(`invalid input syntax for type uuid: "${personalValue}"`), {
      code: '22P02',
    });
    return new DrizzleQueryError(
      'select id from notes where owner = $1 and title = $2',
      [personalValue, 'Line\nparams: two'],
      cause,
    );
  }

  it('never passes a failed query params to the logger, and names the correlation id and error code', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const httpAdapter = new ExpressAdapter();
    const replied = vi.spyOn(httpAdapter, 'reply').mockImplementation(() => undefined);
    const adapterHost = new HttpAdapterHost();
    adapterHost.httpAdapter = httpAdapter;
    const response = new ServerResponse(new IncomingMessage(new Socket()));
    response.setHeader('x-correlation-id', '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d');

    new DomainErrorFilter(adapterHost).catch(queryError(), new ExecutionContextHost([{}, response]));

    expect(replied).toHaveBeenCalledWith(
      response,
      { error: 'Internal', message: 'pl.error.internal.unexpected', params: {} },
      500,
    );
    expect(logged).toHaveBeenCalledTimes(1);
    const line = logged.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    expect(line).not.toContain(personalValue);
    expect(line).not.toContain('params:');
    expect(line).toContain('correlation 6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d');
    expect(line).toContain('DrizzleQueryError [Error 22P02]: Failed query: select id from notes where owner = $1');
    expect(line).toMatch(/\n\s+at /);
  });

  it('logs only the code of a database error, whose message may quote a value', () => {
    const databaseError = Object.assign(new Error(`duplicate key value (${personalValue})`), { code: '23505' });
    const line = describeUnexpectedFailure(databaseError, null);
    expect(line).not.toContain(personalValue);
    expect(line).toContain('Error [23505]');
  });

  it('answers a declared Unavailable failure with 503 without logging it as unexpected', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const httpAdapter = new ExpressAdapter();
    const replied = vi.spyOn(httpAdapter, 'reply').mockImplementation(() => undefined);
    const adapterHost = new HttpAdapterHost();
    adapterHost.httpAdapter = httpAdapter;
    const response = new ServerResponse(new IncomingMessage(new Socket()));

    new DomainErrorFilter(adapterHost).catch(
      new DomainFailure(domainError('Unavailable', 'dependencyUnavailable')),
      new ExecutionContextHost([{}, response]),
    );

    expect(replied).toHaveBeenCalledWith(
      response,
      { error: 'Unavailable', message: 'pl.error.unavailable.dependencyUnavailable', params: {} },
      503,
    );
    expect(logged).not.toHaveBeenCalled();
  });

  it('logs only the type of a thrown value that is not an error', () => {
    expect(describeUnexpectedFailure(personalValue, null)).toBe(
      'Unexpected failure (correlation none): a thrown string',
    );
  });
});
