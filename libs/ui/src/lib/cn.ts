import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Base UI accepts a className function of state; the wrappers here take plain class names only. */
export type WithClassName<Props> = Omit<Props, 'className'> & { className?: string };

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

// The ring is hidden in forced-colours mode, where `outline-hidden` turns into a
// visible system-coloured outline instead (KTD27). The offset takes the colour of the
// surface the control sits on, which raised surfaces set through `raisedSurface`.
export const focusRing =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-(color:--pl-ring-offset)';

export const raisedSurface = 'bg-surface-raised [--pl-ring-offset:var(--pl-surface-raised)]';

export const overlaySurface = 'bg-surface-overlay [--pl-ring-offset:var(--pl-surface-overlay)]';
