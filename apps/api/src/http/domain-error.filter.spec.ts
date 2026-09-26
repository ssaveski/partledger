import { BadRequestException, NotFoundException } from '@nestjs/common';
import { domainErrorTags, errorBodySchema, validationErrorBodySchema } from '@partledger/contracts';
import { domainError, type DomainError } from '@partledger/domain';
import { describe, expect, it } from 'vitest';

import { domainErrorBody, httpErrorResponseFor, httpStatusOf } from './domain-error.filter';
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
