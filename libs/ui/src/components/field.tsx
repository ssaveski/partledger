import { Field as BaseField } from '@base-ui/react/field';
import type { ComponentProps } from 'react';

import { cn, type WithClassName } from '../lib/cn';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-primary', className)} {...props} />;
}

export function Field({ className, ...props }: WithClassName<ComponentProps<typeof BaseField.Root>>) {
  return <BaseField.Root className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export function FieldLabel({ className, ...props }: WithClassName<ComponentProps<typeof BaseField.Label>>) {
  return <BaseField.Label className={cn('text-sm font-medium text-primary', className)} {...props} />;
}

export function FieldDescription({ className, ...props }: WithClassName<ComponentProps<typeof BaseField.Description>>) {
  return <BaseField.Description className={cn('text-sm text-muted', className)} {...props} />;
}

export function FieldError({ className, ...props }: WithClassName<ComponentProps<typeof BaseField.Error>>) {
  return <BaseField.Error className={cn('text-sm font-medium text-danger', className)} {...props} />;
}
