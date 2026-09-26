import { Select as BaseSelect } from '@base-ui/react/select';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { useTranslate } from '../i18n/translation';
import { cn, type WithClassName } from '../lib/cn';
import { controlClasses } from './input';

export const Select = BaseSelect.Root;

export function SelectTrigger({
  className,
  placeholder,
  ...props
}: WithClassName<ComponentProps<typeof BaseSelect.Trigger>> & { placeholder?: string }) {
  const translate = useTranslate();
  return (
    <BaseSelect.Trigger
      className={cn(controlClasses, 'flex h-9 cursor-pointer items-center justify-between gap-2 text-left', className)}
      {...props}
    >
      <BaseSelect.Value
        className="truncate data-placeholder:text-muted"
        placeholder={placeholder ?? translate('pl.ui.select.placeholder')}
      />
      <BaseSelect.Icon className="text-muted">
        <ChevronsUpDownIcon className="size-4" aria-hidden />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: WithClassName<ComponentProps<typeof BaseSelect.Popup>>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-hidden">
        <BaseSelect.Popup
          className={cn(
            'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-md border border-line bg-surface-overlay p-1 text-sm text-primary shadow-lg outline-hidden',
            className,
          )}
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

export function SelectItem({ className, children, ...props }: WithClassName<ComponentProps<typeof BaseSelect.Item>>) {
  return (
    <BaseSelect.Item
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 outline-hidden select-none',
        'data-highlighted:bg-surface-sunken data-disabled:cursor-not-allowed data-disabled:opacity-50',
        'forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText]',
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="text-accent">
        <CheckIcon className="size-4" aria-hidden />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
