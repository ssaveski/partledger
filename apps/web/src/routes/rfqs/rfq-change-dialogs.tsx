import type { RfqDetail } from '@partledger/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  DialogClose,
  DialogFooter,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  useTranslate,
} from '@partledger/ui';
import type { RefObject } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { formatDate, formatInstantUtc } from '../../shell/format';
import { FormDialog, FormError, TextAreaField, TextField } from '../../shell/form-dialog';
import {
  amendFormFor,
  amendFormSchema,
  emptyExtendForm,
  extendFormSchema,
  type AmendForm,
  type AmendFormInput,
  type ExtendForm,
  type ExtendFormInput,
} from './rfq-changes';
import { utcDateOf } from './rfq-form-fields';

/** Extends the deadline for every supplier, with a recorded reason (R16). */
export function ExtendDeadlineDialog({
  detail,
  open,
  returnFocusTo,
  onExtended,
  onClose,
}: {
  detail: RfqDetail;
  open: boolean;
  returnFocusTo: RefObject<HTMLElement | null>;
  onExtended: (form: ExtendForm) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <FormDialog
      open={open}
      title={translate('pl.rfqs.extend.title')}
      description={translate('pl.rfqs.extend.description', {
        reference: detail.reference,
        deadline: formatInstantUtc(detail.deadline),
      })}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <ExtendFormFields detail={detail} onExtended={onExtended} />
    </FormDialog>
  );
}

function ExtendFormFields({ detail, onExtended }: { detail: RfqDetail; onExtended: (form: ExtendForm) => void }) {
  const translate = useTranslate();
  const form = useForm<ExtendFormInput, unknown, ExtendForm>({
    defaultValues: emptyExtendForm(detail),
    resolver: zodResolver(extendFormSchema(detail, new Date().toISOString())),
    shouldFocusError: true,
  });
  const errors = form.formState.errors;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit(onExtended)(event);
      }}
    >
      <TextField
        label={translate('pl.rfqs.extend.deadline')}
        description={translate('pl.rfqs.extend.deadlineHint')}
        registration={form.register('deadline')}
        error={errors.deadline}
        type="datetime-local"
        required
      />
      <TextAreaField
        label={translate('pl.rfqs.extend.reason')}
        description={translate('pl.rfqs.extend.reasonHint')}
        registration={form.register('reason')}
        error={errors.reason}
        required
      />
      <DialogFooter>
        <DialogClose>{translate('pl.rfqs.extend.cancel')}</DialogClose>
        <Button type="submit">{translate('pl.rfqs.extend.submit')}</Button>
      </DialogFooter>
    </form>
  );
}

/** Changes one line and creates the next version; answers to it become stale (R16). */
export function AmendDialog({
  detail,
  open,
  returnFocusTo,
  onAmended,
  onClose,
}: {
  detail: RfqDetail;
  open: boolean;
  returnFocusTo: RefObject<HTMLElement | null>;
  onAmended: (form: AmendForm) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <FormDialog
      open={open}
      title={translate('pl.rfqs.amend.title')}
      description={translate('pl.rfqs.amend.description', {
        reference: detail.reference,
        version: detail.version + 1,
      })}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      <AmendFormFields detail={detail} onAmended={onAmended} />
    </FormDialog>
  );
}

function AmendFormFields({ detail, onAmended }: { detail: RfqDetail; onAmended: (form: AmendForm) => void }) {
  const translate = useTranslate();
  const form = useForm<AmendFormInput, unknown, AmendForm>({
    defaultValues: amendFormFor(detail.lines[0]),
    resolver: zodResolver(amendFormSchema(detail)),
    shouldFocusError: true,
  });
  const errors = form.formState.errors;
  const items = detail.lines.map((line) => ({
    value: line.lineId,
    label: translate('pl.rfqs.amend.lineOption', {
      line: line.lineNumber,
      part: line.partNumber,
      revision: line.revision,
    }),
  }));
  const deadlineParams = { date: formatDate(utcDateOf(detail.deadline)) };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit(onAmended)(event);
      }}
    >
      <Controller
        control={form.control}
        name="lineId"
        render={({ field, fieldState }) => (
          <Field invalid={fieldState.error !== undefined}>
            <Select
              items={items}
              value={field.value}
              onValueChange={(value) => {
                const line = detail.lines.find((candidate) => candidate.lineId === value);
                form.reset(amendFormFor(line));
              }}
            >
              <FieldLabel>{translate('pl.rfqs.amend.line')}</FieldLabel>
              <SelectTrigger ref={field.ref} onBlur={field.onBlur} />
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormError error={fieldState.error} />
          </Field>
        )}
      />
      <TextField
        label={translate('pl.rfqs.amend.quantity')}
        registration={form.register('quantity')}
        error={errors.quantity}
        inputMode="numeric"
        required
      />
      <TextField
        label={translate('pl.rfqs.amend.requiredBy')}
        description={translate('pl.rfqs.amend.requiredByHint', deadlineParams)}
        registration={form.register('requiredBy')}
        error={errors.requiredBy}
        errorParams={deadlineParams}
        type="date"
        required
      />
      <p className="text-sm text-muted">{translate('pl.rfqs.amend.staleNotice')}</p>
      <DialogFooter>
        <DialogClose>{translate('pl.rfqs.amend.cancel')}</DialogClose>
        <Button type="submit">{translate('pl.rfqs.amend.submit')}</Button>
      </DialogFooter>
    </form>
  );
}
