import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Base UI accepts a className function of state; the wrappers here take plain class names only. */
export type WithClassName<Props> = Omit<Props, 'className'> & { className?: string };

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}

// The ring is hidden in forced-colours mode, where `outline-hidden` turns into a
// visible system-coloured outline instead (KTD27).
export const focusRing =
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
