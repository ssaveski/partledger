import { Separator as BaseSeparator } from '@base-ui/react/separator';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircleIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn, type WithClassName } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line-strong bg-surface-sunken text-primary',
        accent: 'border-transparent bg-accent text-on-accent',
        success: 'border-transparent bg-success text-on-state',
        warning: 'border-transparent bg-warning text-on-state',
        danger: 'border-transparent bg-danger text-on-state',
        info: 'border-transparent bg-info text-on-state',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-5 text-primary', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function Separator({ className, ...props }: WithClassName<ComponentProps<typeof BaseSeparator>>) {
  return (
    <BaseSeparator
      className={cn('shrink-0 bg-line data-[orientation=horizontal]:h-px data-[orientation=vertical]:w-px', className)}
      {...props}
    />
  );
}

/** Identifiers, prices and quantities: JetBrains Mono with tabular figures. */
export function Mono({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('font-mono text-[0.95em] tabular-nums', className)} {...props} />;
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div aria-hidden className={cn('rounded-md bg-surface-sunken motion-safe:animate-pulse', className)} {...props} />
  );
}

export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return <LoaderCircleIcon aria-hidden className={cn('size-5 motion-safe:animate-spin', className)} {...props} />;
}
