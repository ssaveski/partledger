import { formatMessage, type MessageParams } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { winnerOptionLabel } from './award-decisions';

const translate = (key: string, params?: MessageParams) => formatMessage(key, params);

const option = {
  supplierId: '00000000-0000-4000-8000-000000002004',
  name: 'Arbor Fasteners',
  total: { amount: '2100.00', currency: 'CAD' },
  lowest: false,
  alternatePart: null,
  buyerRecorded: false,
};

describe('winner option labels', () => {
  it('name the supplier and its total, and say when it is the lowest', () => {
    expect(winnerOptionLabel(translate, option)).toBe('Arbor Fasteners, $2,100.00');
    expect(winnerOptionLabel(translate, { ...option, lowest: true })).toBe('Arbor Fasteners, $2,100.00 (lowest total)');
  });

  it('name an alternate part and a quote recorded by a buyer', () => {
    expect(winnerOptionLabel(translate, { ...option, alternatePart: 'PN-31006-N2' })).toBe(
      'Arbor Fasteners, $2,100.00, alternate part PN-31006-N2',
    );
    expect(winnerOptionLabel(translate, { ...option, buyerRecorded: true })).toBe(
      'Arbor Fasteners, $2,100.00, recorded by a buyer',
    );
  });
});
