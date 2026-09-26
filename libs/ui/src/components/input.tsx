import { Field as BaseField } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';

import { cn, focusRing, type WithClassName } from '../lib/cn';

export const controlClasses = cn(
  'w-full rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-primary placeholder:text-muted',
  'disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
  'aria-invalid:border-danger data-invalid:border-danger',
  focusRing,
);

export function Input({ className, ...props }: WithClassName<ComponentProps<typeof BaseInput>>) {
  return <BaseInput className={cn(controlClasses, 'h-9', className)} {...props} />;
}

/** A Field control rendered as a textarea, so a surrounding Field gives it its label, description and validity. */
export function Textarea({ className, ...props }: WithClassName<ComponentProps<typeof BaseField.Control>>) {
  return (
    <BaseField.Control render={<textarea />} className={cn(controlClasses, 'min-h-20 py-2', className)} {...props} />
  );
}
