import { z } from 'zod';

import { fetchWithin, jsonBodyOf, type RegisterClient, type RegisterClientOptions } from './identity-registers';
import type { RegisterAnswer } from './identity-standing';

/** The LEI register's public API (GLEIF). */
export const gleifDefaultBaseUrl = 'https://api.gleif.org/api/v1';

const leiRecordSchema = z.object({
  data: z.object({
    attributes: z.object({
      entity: z.object({ legalName: z.object({ name: z.string().min(1) }) }),
    }),
  }),
});

/** Asks GLEIF for an LEI's record and the legal name it registers (`GET /lei-records/{lei}`). */
export class GleifClient implements RegisterClient {
  constructor(private readonly options: RegisterClientOptions) {}

  async check(lei: string): Promise<RegisterAnswer> {
    const response = await fetchWithin(this.options, `${this.options.baseUrl}/lei-records/${encodeURIComponent(lei)}`, {
      accept: 'application/vnd.api+json',
    });
    if (response === null) {
      return { kind: 'unreachable' };
    }
    if (response.status === 404) {
      return { kind: 'notFound' };
    }
    if (!response.ok) {
      return { kind: 'unreachable' };
    }
    const record = leiRecordSchema.safeParse(await jsonBodyOf(response));
    return record.success
      ? { kind: 'found', registeredName: record.data.data.attributes.entity.legalName.name }
      : { kind: 'unreachable' };
  }
}
