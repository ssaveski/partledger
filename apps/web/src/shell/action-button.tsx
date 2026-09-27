import { Button, useTranslate, type ButtonProps } from '@partledger/ui';
import { useId, type ReactNode } from 'react';

import type { ActionAvailability } from './action-availability';

/**
 * An action that stays focusable when unavailable and is described by its reason, so a keyboard
 * or screen-reader user learns why it is disabled. A hidden action renders nothing.
 */
export function ActionButton({
  availability,
  onAction,
  children,
  variant = 'secondary',
  size,
  describedBy,
  reasonId: sharedReasonId,
  reasonHidden = false,
}: {
  availability: ActionAvailability;
  onAction: () => void;
  children: ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** Further descriptions, such as the state of the row the action belongs to. */
  describedBy?: string;
  /** The id of a reason the screen shows once for several actions; the button then shows none of its own. */
  reasonId?: string;
  /** Keeps the reason for assistive technology only, where the surroundings already show it (a grid row). */
  reasonHidden?: boolean;
}) {
  const translate = useTranslate();
  const ownReasonId = useId();
  if (availability.kind === 'hidden') {
    return null;
  }
  const available = availability.kind === 'available';
  const reason =
    availability.kind === 'blocked'
      ? translate(availability.messageKey, availability.params)
      : availability.kind === 'notYetAvailable'
        ? translate(availability.messageKey)
        : null;
  const reasonId = sharedReasonId ?? ownReasonId;
  const descriptions = [reason === null ? null : reasonId, describedBy ?? null].filter((id) => id !== null);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        variant={variant}
        size={size}
        disabled={!available}
        focusableWhenDisabled
        aria-describedby={descriptions.length === 0 ? undefined : descriptions.join(' ')}
        onClick={available ? onAction : undefined}
      >
        {children}
      </Button>
      {reason === null || sharedReasonId !== undefined ? null : (
        <span id={reasonId} className={reasonHidden ? 'sr-only' : 'text-sm text-muted'}>
          {reason}
        </span>
      )}
    </span>
  );
}
