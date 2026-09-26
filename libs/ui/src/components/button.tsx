import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn, focusRing, type WithClassName } from '../lib/cn';

// Every variant keeps a border, transparent where unwanted, so forced-colours mode still draws the button's edge.
export const buttonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors select-none',
    'disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
  ],
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent text-on-accent hover:bg-accent-hover',
        secondary: 'border-line-strong bg-surface-raised text-primary hover:bg-surface-sunken',
        ghost: 'border-transparent bg-transparent text-primary hover:bg-surface-sunken',
        danger: 'border-transparent bg-danger text-on-state hover:bg-danger-hover',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = WithClassName<ComponentProps<typeof BaseButton>> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <BaseButton type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
