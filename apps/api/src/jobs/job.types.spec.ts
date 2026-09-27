import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineJob, defineSchedule, InvalidJobDeclarationError, jobField } from './job.types';

describe('job declarations', () => {
  it('accept a payload built only from identifiers, enumerations, counts and hashes', () => {
    const job = defineJob({
      name: 'fixtures.sendReminder',
      description: 'A synthetic job.',
      payload: {
        rfqId: jobField.id(),
        supplierIds: jobField.ids(50),
        channel: jobField.oneOf(['email', 'inApp']),
        attempt: jobField.count(),
        contentHash: jobField.hash(),
      },
    });
    expect(
      job.payload.parse({
        rfqId: '2c9a7e14-8f6b-4d2a-b5c3-9e1f0a7d6b02',
        supplierIds: ['5e3b9c2d-1a4f-4e8b-8c7d-3f2a1b0c9d03'],
        channel: 'email',
        attempt: 1,
        contentHash: 'a'.repeat(64),
      }),
    ).toBeDefined();
  });

  it('refuse a payload field that could carry free text or personal data', () => {
    expect(() =>
      defineJob({
        name: 'fixtures.sendReminder',
        description: 'A synthetic job.',
        payload: { contactName: z.string() },
      }),
    ).toThrow(InvalidJobDeclarationError);
    expect(() =>
      defineJob({ name: 'fixtures.sendReminder', description: 'A synthetic job.', payload: { rfqId: z.uuid() } }),
    ).toThrow(/rfqId is not built with jobField/);
  });

  it('refuse a payload value outside its declared fields', () => {
    const job = defineJob({
      name: 'fixtures.sendReminder',
      description: 'A synthetic job.',
      payload: { rfqId: jobField.id() },
    });
    expect(() =>
      job.payload.parse({ rfqId: '2c9a7e14-8f6b-4d2a-b5c3-9e1f0a7d6b02', note: 'Synthetic text' }),
    ).toThrow();
    expect(() => job.payload.parse({ rfqId: 'Synthetic Supplier Ltd' })).toThrow();
  });

  it('refuse a job name that is not <module>.<action>', () => {
    expect(() => defineJob({ name: 'send reminder', description: 'A synthetic job.', payload: {} })).toThrow(
      InvalidJobDeclarationError,
    );
  });

  it('refuse a schedule whose payload does not match its job', () => {
    const job = defineJob({
      name: 'fixtures.sendReminder',
      description: 'A synthetic job.',
      payload: { rfqId: jobField.id() },
    });
    expect(() =>
      defineSchedule({ name: 'fixtures.nightly', job, cron: '0 3 * * *', payload: { rfqId: 'not an id' } }),
    ).toThrow();
  });
});
