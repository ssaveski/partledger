import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ComponentProps } from 'react';

import { cn, type WithClassName } from '../lib/cn';

export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export function TooltipContent({ className, ...props }: WithClassName<ComponentProps<typeof BaseTooltip.Popup>>) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={6} className="z-50">
        <BaseTooltip.Popup
          className={cn(
            'rounded-md border border-line bg-surface-overlay px-2 py-1 text-xs text-primary shadow-md',
            className,
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}
