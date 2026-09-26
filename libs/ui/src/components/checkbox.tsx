import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { CheckIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn, focusRing, type WithClassName } from '../lib/cn';

export function Checkbox({ className, ...props }: WithClassName<ComponentProps<typeof BaseCheckbox.Root>>) {
  return (
    <BaseCheckbox.Root
      className={cn(
        'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-line-strong bg-surface-raised',
        'data-checked:border-accent data-checked:bg-accent data-checked:text-on-accent',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center">
        <CheckIcon className="size-3.5" strokeWidth={3} aria-hidden />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export function Switch({ className, ...props }: WithClassName<ComponentProps<typeof BaseSwitch.Root>>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-sunken p-0.5 transition-colors',
        'data-checked:border-accent data-checked:bg-accent',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'block size-3.5 rounded-full border border-line-strong bg-muted transition-transform',
          'data-checked:translate-x-4 data-checked:border-on-accent data-checked:bg-on-accent',
        )}
      />
    </BaseSwitch.Root>
  );
}
