import { describe, expect, it } from 'vitest';

import { actionAvailability } from './action-availability';

const notYet = 'pl.rfqs.changes.notYetAvailable';

describe('an action on a lifecycle read', () => {
  it('is available when the read allows it and the preview can write', () => {
    const read = { allowedTransitions: ['amend'], blockingReasons: [] };
    expect(actionAvailability(read, 'amend', true, notYet)).toEqual({ kind: 'available' });
  });

  it('is shown unavailable with its reason against the API until the command exists', () => {
    const read = { allowedTransitions: ['amend'], blockingReasons: [] };
    expect(actionAvailability(read, 'amend', false, notYet)).toEqual({ kind: 'notYetAvailable', messageKey: notYet });
  });

  it("carries the server's reason, with its params, when the read blocks it", () => {
    const read = {
      allowedTransitions: ['cancel'],
      blockingReasons: [
        { transition: 'extendDeadline', message: 'pl.rfqs.blocked.answersSeen', params: { flag: true } },
      ],
    };
    expect(actionAvailability(read, 'extendDeadline', true, notYet)).toEqual({
      kind: 'blocked',
      messageKey: 'pl.rfqs.blocked.answersSeen',
      params: { flag: 'true' },
    });
  });

  it('is not offered when the read neither allows nor explains it', () => {
    const read = { allowedTransitions: ['cancel'], blockingReasons: [] };
    expect(actionAvailability(read, 'amend', true, notYet)).toEqual({ kind: 'hidden' });
  });
});
