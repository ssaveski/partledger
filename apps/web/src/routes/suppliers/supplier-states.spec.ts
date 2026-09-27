import { englishCatalogue } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { evidenceStates } from '../rfqs/comparison-states';
import { evidenceNotAssessedState, evidenceStateOf } from './supplier-states';

describe('the evidence state of a supplier', () => {
  it('reads as not assessed while the evidence vault has not assessed the supplier', () => {
    expect(evidenceStateOf(null)).toBe(evidenceNotAssessedState);
    expect(Object.hasOwn(englishCatalogue, evidenceNotAssessedState.labelKey)).toBe(true);
  });

  it('reads as the assessed status once there is one', () => {
    expect(evidenceStateOf('expiring')).toBe(evidenceStates.expiring);
  });
});
