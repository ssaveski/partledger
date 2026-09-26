import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { useTranslate } from '../i18n/translation';
import { cn, overlaySurface, type WithClassName } from '../lib/cn';
import { buttonVariants } from './button';

export const Dialog = BaseDialog.Root;

export function DialogTrigger({ className, ...props }: WithClassName<ComponentProps<typeof BaseDialog.Trigger>>) {
  return <BaseDialog.Trigger className={cn(buttonVariants({ variant: 'secondary' }), className)} {...props} />;
}

export function DialogContent({
  className,
  children,
  ...props
}: WithClassName<ComponentProps<typeof BaseDialog.Popup>>) {
  const translate = useTranslate();
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-surface/80" />
      <BaseDialog.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
          'rounded-lg border border-line p-6 text-primary shadow-xl outline-hidden',
          overlaySurface,
          className,
        )}
        {...props}
      >
        {children}
        <BaseDialog.Close
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'absolute top-3 right-3')}
          aria-label={translate('pl.ui.dialog.close')}
        >
          <XIcon aria-hidden />
        </BaseDialog.Close>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: WithClassName<ComponentProps<typeof BaseDialog.Title>>) {
  return <BaseDialog.Title className={cn('pr-8 text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseDialog.Description>>) {
  return <BaseDialog.Description className={cn('text-sm text-muted', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2', className)} {...props} />;
}

export function DialogClose({ className, ...props }: WithClassName<ComponentProps<typeof BaseDialog.Close>>) {
  return <BaseDialog.Close className={cn(buttonVariants({ variant: 'secondary' }), className)} {...props} />;
}
