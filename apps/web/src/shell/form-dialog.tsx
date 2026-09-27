import type { MessageParams } from '@partledger/contracts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  useTranslate,
} from '@partledger/ui';
import type { ReactNode, RefObject } from 'react';
import type { FieldError as FormFieldError, UseFormRegisterReturn } from 'react-hook-form';

/**
 * A dialog holding one form. When the form succeeds, the control that opened the dialog may be
 * gone (the row it belonged to changed), so focus goes to `returnFocusTo` if set, else back to it.
 */
export function FormDialog({
  open,
  title,
  description,
  returnFocusTo,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  returnFocusTo: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto"
        finalFocus={() => returnFocusTo.current ?? true}
      >
        {open ? (
          <>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
            {children}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** A field error whose message is a key; `params` fill the placeholders any of the form's keys use. */
export function FormError({ error, params }: { error: FormFieldError | undefined; params?: MessageParams }) {
  const translate = useTranslate();
  if (error?.message === undefined) {
    return null;
  }
  return <FieldError match>{translate(error.message, params)}</FieldError>;
}

export function TextField({
  label,
  description,
  registration,
  error,
  errorParams,
  type = 'text',
  inputMode,
  required = false,
}: {
  label: string;
  description?: string;
  registration: UseFormRegisterReturn;
  error: FormFieldError | undefined;
  errorParams?: MessageParams;
  type?: 'text' | 'date' | 'datetime-local';
  inputMode?: 'decimal' | 'numeric';
  required?: boolean;
}) {
  return (
    <Field invalid={error !== undefined}>
      <FieldLabel>{label}</FieldLabel>
      <Input type={type} inputMode={inputMode} required={required} {...registration} />
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FormError error={error} params={errorParams} />
    </Field>
  );
}

export function TextAreaField({
  label,
  description,
  registration,
  error,
  errorParams,
  required = false,
}: {
  label: string;
  description?: string;
  registration: UseFormRegisterReturn;
  error: FormFieldError | undefined;
  errorParams?: MessageParams;
  required?: boolean;
}) {
  return (
    <Field invalid={error !== undefined}>
      <FieldLabel>{label}</FieldLabel>
      <Textarea required={required} {...registration} />
      {description === undefined ? null : <FieldDescription>{description}</FieldDescription>}
      <FormError error={error} params={errorParams} />
    </Field>
  );
}
