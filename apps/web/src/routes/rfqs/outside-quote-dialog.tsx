import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  focusRing,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useTranslate,
} from '@partledger/ui';
import { useId, type RefObject } from 'react';
import { Controller, useForm, type FieldError as FormFieldError, type UseFormRegisterReturn } from 'react-hook-form';

import type { OutsideQuoteTarget } from './comparison-grid';
import {
  emptyOutsideQuote,
  outsideQuoteDocumentTypes,
  outsideQuoteFormSchema,
  type OutsideQuote,
  type OutsideQuoteInput,
} from './outside-quote';

/**
 * Records a quote a supplier sent outside the portal before the deadline (R42). The quote is
 * marked buyer-recorded wherever it appears, and its document goes through the upload pipeline.
 */
export function OutsideQuoteDialog({
  target,
  currencies,
  deadlineDate,
  returnFocusTo,
  onRecorded,
  onClose,
}: {
  target: OutsideQuoteTarget | null;
  currencies: readonly [string, ...string[]];
  deadlineDate: string;
  /** Set once a quote is recorded, since the button that opened the dialog is then gone; else focus returns to it. */
  returnFocusTo: RefObject<HTMLElement | null>;
  onRecorded: (target: OutsideQuoteTarget, quote: OutsideQuote) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto"
        finalFocus={() => returnFocusTo.current ?? true}
      >
        {target === null ? null : (
          <>
            <DialogTitle>{translate('pl.rfqs.outsideQuote.title')}</DialogTitle>
            <DialogDescription>
              {translate('pl.rfqs.outsideQuote.description', {
                supplier: target.supplier.name,
                line: target.line.lineNumber,
                part: target.line.partNumber,
              })}
            </DialogDescription>
            <OutsideQuoteForm
              target={target}
              currencies={currencies}
              deadlineDate={deadlineDate}
              onRecorded={onRecorded}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OutsideQuoteForm({
  target,
  currencies,
  deadlineDate,
  onRecorded,
}: {
  target: OutsideQuoteTarget;
  currencies: readonly [string, ...string[]];
  deadlineDate: string;
  onRecorded: (target: OutsideQuoteTarget, quote: OutsideQuote) => void;
}) {
  const translate = useTranslate();
  const form = useForm<OutsideQuoteInput, unknown, OutsideQuote>({
    defaultValues: emptyOutsideQuote(currencies[0]),
    resolver: zodResolver(outsideQuoteFormSchema(currencies, deadlineDate)),
    shouldFocusError: true,
  });
  const errors = form.formState.errors;
  const currencyItems = currencies.map((currency) => ({ value: currency, label: currency }));
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit((quote) => {
          onRecorded(target, quote);
        })(event);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          labelKey="pl.rfqs.outsideQuote.unitPrice"
          registration={form.register('unitPrice')}
          error={errors.unitPrice}
          inputMode="decimal"
          required
        />
        <Controller
          control={form.control}
          name="currency"
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.error !== undefined}>
              <Select
                items={currencyItems}
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value ?? '');
                }}
              >
                <FieldLabel>{translate('pl.rfqs.outsideQuote.currency')}</FieldLabel>
                <SelectTrigger ref={field.ref} onBlur={field.onBlur} />
                <SelectContent>
                  {currencyItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorMessage error={fieldState.error} />
            </Field>
          )}
        />
        <TextField
          labelKey="pl.rfqs.outsideQuote.minimumOrderQuantity"
          registration={form.register('minimumOrderQuantity')}
          error={errors.minimumOrderQuantity}
          inputMode="numeric"
          required
        />
        <TextField
          labelKey="pl.rfqs.outsideQuote.oneOffCosts"
          registration={form.register('oneOffCosts')}
          error={errors.oneOffCosts}
          inputMode="decimal"
        />
        <TextField
          labelKey="pl.rfqs.outsideQuote.leadTimeDays"
          registration={form.register('leadTimeDays')}
          error={errors.leadTimeDays}
          inputMode="numeric"
          required
        />
        <TextField
          labelKey="pl.rfqs.outsideQuote.validUntil"
          registration={form.register('validUntil')}
          error={errors.validUntil}
          type="date"
          required
        />
        <TextField
          labelKey="pl.rfqs.outsideQuote.receivedOn"
          descriptionKey="pl.rfqs.outsideQuote.receivedOnHint"
          registration={form.register('receivedOn')}
          error={errors.receivedOn}
          type="date"
          required
        />
        <Controller
          control={form.control}
          name="document"
          render={({ field, fieldState }) => (
            <DocumentField
              name={field.name}
              inputRef={field.ref}
              error={fieldState.error}
              onBlur={field.onBlur}
              onFileChosen={(file) => {
                field.onChange(file === undefined ? null : { name: file.name, type: file.type, size: file.size });
              }}
            />
          )}
        />
      </div>
      <p className="text-sm text-muted">{translate('pl.rfqs.outsideQuote.markerNotice')}</p>
      <DialogFooter>
        <DialogClose>{translate('pl.rfqs.outsideQuote.cancel')}</DialogClose>
        <Button type="submit">{translate('pl.rfqs.outsideQuote.submit')}</Button>
      </DialogFooter>
    </form>
  );
}

function ErrorMessage({ error }: { error: FormFieldError | undefined }) {
  const translate = useTranslate();
  if (error?.message === undefined) {
    return null;
  }
  return <FieldError match>{translate(error.message)}</FieldError>;
}

function TextField({
  labelKey,
  descriptionKey,
  registration,
  error,
  type = 'text',
  inputMode,
  required = false,
}: {
  labelKey: string;
  descriptionKey?: string;
  registration: UseFormRegisterReturn;
  error: FormFieldError | undefined;
  type?: 'text' | 'date';
  inputMode?: 'decimal' | 'numeric';
  required?: boolean;
}) {
  const translate = useTranslate();
  return (
    <Field invalid={error !== undefined}>
      <FieldLabel>{translate(labelKey)}</FieldLabel>
      <Input type={type} inputMode={inputMode} required={required} {...registration} />
      {descriptionKey === undefined ? null : <FieldDescription>{translate(descriptionKey)}</FieldDescription>}
      <ErrorMessage error={error} />
    </Field>
  );
}

function DocumentField({
  name,
  inputRef,
  error,
  onBlur,
  onFileChosen,
}: {
  name: string;
  inputRef: (element: HTMLInputElement | null) => void;
  error: FormFieldError | undefined;
  onBlur: () => void;
  onFileChosen: (file: File | undefined) => void;
}) {
  const translate = useTranslate();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <label htmlFor={inputId} className="text-sm font-medium text-primary">
        {translate('pl.rfqs.outsideQuote.document')}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        name={name}
        type="file"
        required
        accept={outsideQuoteDocumentTypes.join(',')}
        aria-describedby={error === undefined ? hintId : `${errorId} ${hintId}`}
        aria-invalid={error === undefined ? undefined : true}
        onBlur={onBlur}
        onChange={(event) => {
          onFileChosen(event.currentTarget.files?.[0]);
        }}
        className={cn(
          'rounded-md text-sm text-primary file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary',
          focusRing,
        )}
      />
      <p id={hintId} className="text-sm text-muted">
        {translate('pl.rfqs.outsideQuote.documentHint')}
      </p>
      {error?.message === undefined ? null : (
        <p id={errorId} className="text-sm font-medium text-danger">
          {translate(error.message)}
        </p>
      )}
    </div>
  );
}
