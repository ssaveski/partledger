import { z } from 'zod';

import { fetchWithin, jsonBodyOf, type RegisterClient, type RegisterClientOptions } from './identity-registers';
import type { RegisterAnswer } from './identity-standing';

/** The EU VAT register's REST API (VIES). */
export const viesDefaultBaseUrl = 'https://ec.europa.eu/taxation_customs/vies/rest-api';

/** The member state or VIES itself could not answer; anything else not valid is not registered. */
const unreachableErrors: ReadonlySet<string> = new Set([
  'SERVICE_UNAVAILABLE',
  'MS_UNAVAILABLE',
  'TIMEOUT',
  'MS_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'IP_BLOCKED',
]);

/** VIES hides the name for some member states and answers `---`. */
const hiddenName = /^-*$/;

const viesAnswerSchema = z.object({
  isValid: z.boolean(),
  name: z.string().nullish(),
  userError: z.string().nullish(),
});

/**
 * Asks VIES whether a VAT id is registered and under what name
 * (`GET /ms/{prefix}/vat/{number}`). The id's two-letter prefix is the member state.
 */
export class ViesClient implements RegisterClient {
  constructor(private readonly options: RegisterClientOptions) {}

  async check(vatId: string): Promise<RegisterAnswer> {
    const prefix = vatId.slice(0, 2);
    const number = vatId.slice(2);
    const response = await fetchWithin(
      this.options,
      `${this.options.baseUrl}/ms/${encodeURIComponent(prefix)}/vat/${encodeURIComponent(number)}`,
      { accept: 'application/json' },
    );
    if (response?.ok !== true) {
      return { kind: 'unreachable' };
    }
    const answer = viesAnswerSchema.safeParse(await jsonBodyOf(response));
    if (!answer.success) {
      return { kind: 'unreachable' };
    }
    const { isValid, name, userError } = answer.data;
    if (isValid) {
      const registeredName = name?.trim() ?? '';
      return { kind: 'found', registeredName: hiddenName.test(registeredName) ? null : registeredName };
    }
    return userError !== null && userError !== undefined && unreachableErrors.has(userError)
      ? { kind: 'unreachable' }
      : { kind: 'notFound' };
  }
}
