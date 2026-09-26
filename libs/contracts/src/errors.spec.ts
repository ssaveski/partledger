import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  allErrorCodes,
  errorCode,
  internalErrorMessageKey,
  isErrorCode,
  messageKeyOf,
  unauthenticatedMessageKey,
  validationErrorBodySchema,
} from './errors';
import { englishCatalogue } from './i18n/catalogue';
import { lifecycleRead } from './lifecycle';

describe('the domain error vocabulary', () => {
  it('has an English message for every tag and reason', () => {
    const missing = allErrorCodes.map(messageKeyOf).filter((key) => !(key in englishCatalogue));
    expect(missing).toEqual([]);
  });

  it('has an English message for the uniform 401 and for unexpected failures', () => {
    expect(englishCatalogue[unauthenticatedMessageKey]).toBeDefined();
    expect(englishCatalogue[internalErrorMessageKey]).toBeDefined();
  });

  it('builds message keys from the tag and the reason', () => {
    expect(messageKeyOf(errorCode('Conflict', 'versionMismatch'))).toBe('pl.error.conflict.versionMismatch');
    expect(messageKeyOf(errorCode('StepUpRequired', 'recentAuthentication'))).toBe(
      'pl.error.stepUpRequired.recentAuthentication',
    );
  });

  it('recognises only reasons listed under their own tag', () => {
    expect(isErrorCode({ tag: 'Conflict', reason: 'versionMismatch' })).toBe(true);
    expect(isErrorCode({ tag: 'NotFound', reason: 'versionMismatch' })).toBe(false);
    expect(isErrorCode({ tag: 'Teapot', reason: 'resource' })).toBe(false);
  });

  it('describes a validation failure by path and code without the values sent', () => {
    const body = {
      error: 'Invalid',
      message: 'pl.error.invalid.request',
      issues: [{ path: ['title'], code: 'too_small' }],
    };
    expect(validationErrorBodySchema.parse(body)).toEqual(body);
    expect(() =>
      validationErrorBodySchema.parse({ ...body, issues: [{ path: ['title'], code: 'x', received: 'a' }] }),
    ).toThrow();
  });
});

describe('the lifecycle read helper', () => {
  const noteRead = lifecycleRead(z.object({ id: z.uuid() }), ['publish', 'cancel']);

  it('adds allowed transitions and blocking reasons as message keys', () => {
    const read = {
      id: '0b5e8f1e-6a4f-4a55-9a3c-6f2b8f1d2c3a',
      allowedTransitions: ['cancel'],
      blockingReasons: [{ transition: 'publish', message: 'pl.error.conflict.transitionNotAllowed', params: {} }],
    };
    expect(noteRead.parse(read)).toEqual(read);
  });

  it('refuses a transition outside the aggregate table and a reason that is not a message key', () => {
    expect(() =>
      noteRead.parse({ id: '0b5e8f1e-6a4f-4a55-9a3c-6f2b8f1d2c3a', allowedTransitions: ['seal'], blockingReasons: [] }),
    ).toThrow();
    expect(() =>
      noteRead.parse({
        id: '0b5e8f1e-6a4f-4a55-9a3c-6f2b8f1d2c3a',
        allowedTransitions: [],
        blockingReasons: [{ transition: 'publish', message: 'Not yet', params: {} }],
      }),
    ).toThrow();
  });
});
