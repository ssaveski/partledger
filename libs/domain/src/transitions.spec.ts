import { describe, expect, it } from 'vitest';

import { defineTransitions, transitionNames, transitionsFrom, transitionTarget } from './transitions';

const sampleLifecycle = defineTransitions({
  aggregate: 'sample',
  statuses: ['draft', 'open', 'closed', 'cancelled'],
  transitions: {
    open: { from: ['draft'], to: 'open' },
    close: { from: ['open'], to: 'closed' },
    cancel: { from: ['draft', 'open'], to: 'cancelled' },
  },
});

describe('transition tables', () => {
  it('lead a transition to its target only from the states it lists', () => {
    expect(transitionTarget(sampleLifecycle, 'cancel', 'open')).toBe('cancelled');
    expect(transitionTarget(sampleLifecycle, 'close', 'draft')).toBeNull();
    expect(transitionTarget(sampleLifecycle, 'open', 'cancelled')).toBeNull();
  });

  it('list the transitions allowed from a state in declaration order', () => {
    expect(transitionNames(sampleLifecycle)).toEqual(['open', 'close', 'cancel']);
    expect(transitionsFrom(sampleLifecycle, 'draft')).toEqual(['open', 'cancel']);
    expect(transitionsFrom(sampleLifecycle, 'closed')).toEqual([]);
  });

  it('reject an unknown state or transition at compile time', () => {
    // @ts-expect-error 'archived' is not a status of this lifecycle.
    expect(transitionTarget(sampleLifecycle, 'open', 'archived')).toBeNull();
    // @ts-expect-error 'reopen' is not a transition of this lifecycle.
    expect(() => transitionTarget(sampleLifecycle, 'reopen', 'closed')).toThrow();
  });
});
