import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentProps } from 'react';

import { cn, focusRing, type WithClassName } from '../lib/cn';

export function Tabs({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.Root>>) {
  return <BaseTabs.Root className={cn('flex flex-col gap-3', className)} {...props} />;
}

export function TabsList({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.List>>) {
  return <BaseTabs.List className={cn('flex gap-1 border-b border-line', className)} {...props} />;
}

// Forced colours would paint every tab's underline the same system colour, so the underline
// switches to system colours there: Canvas (invisible) on unselected tabs, Highlight on the selected one.
export function Tab({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.Tab>>) {
  return (
    <BaseTabs.Tab
      className={cn(
        '-mb-px cursor-pointer rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted',
        'hover:text-primary data-active:border-accent data-active:text-primary',
        'forced-colors:border-b-[Canvas] forced-colors:data-active:border-b-[Highlight]',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: WithClassName<ComponentProps<typeof BaseTabs.Panel>>) {
  return <BaseTabs.Panel className={cn('text-sm text-primary', focusRing, className)} {...props} />;
}
