import type { EvidenceGap, ReviewDocument, ReviewQueue } from '@partledger/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  DialogClose,
  DialogFooter,
  Field,
  FieldDescription,
  FieldLabel,
  Textarea,
  useTranslate,
} from '@partledger/ui';
import { useId, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

import { formatDate } from '../../shell/format';
import { FormDialog, TextAreaField, TextField } from '../../shell/form-dialog';
import {
  deviationFormSchema,
  isRejectionReasonGiven,
  reasonMaxLength,
  type DeviationForm,
  type DeviationFormInput,
} from './evidence-review';

/** Rejecting tells the supplier why, so the action enables only once a reason is written. */
export function RejectDialog({
  document,
  returnFocusTo,
  onRejected,
  onClose,
}: {
  document: ReviewDocument | null;
  returnFocusTo: RefObject<HTMLElement | null>;
  onRejected: (document: ReviewDocument, reason: string) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  const type = document === null ? '' : translate(document.evidenceType.label);
  return (
    <FormDialog
      open={document !== null}
      title={translate('pl.evidence.reject.title', { type })}
      description={translate('pl.evidence.reject.description', { supplier: document?.supplier.name ?? '' })}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      {document === null ? null : <RejectForm document={document} onRejected={onRejected} />}
    </FormDialog>
  );
}

function RejectForm({
  document,
  onRejected,
}: {
  document: ReviewDocument;
  onRejected: (document: ReviewDocument, reason: string) => void;
}) {
  const translate = useTranslate();
  const [reason, setReason] = useState('');
  const missingId = useId();
  const given = isRejectionReasonGiven(reason);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (given) {
          onRejected(document, reason.trim());
        }
      }}
    >
      <Field>
        <FieldLabel>{translate('pl.evidence.reject.reason')}</FieldLabel>
        <Textarea
          required
          maxLength={reasonMaxLength}
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
        />
        <FieldDescription>{translate('pl.evidence.reject.reasonHint')}</FieldDescription>
      </Field>
      <DialogFooter className="flex-wrap items-center">
        {given ? null : (
          <p id={missingId} className="mr-auto text-sm text-muted">
            {translate('pl.evidence.reject.reasonRequired')}
          </p>
        )}
        <DialogClose>{translate('pl.evidence.reject.cancel')}</DialogClose>
        <Button
          type="submit"
          variant="danger"
          disabled={!given}
          focusableWhenDisabled
          aria-describedby={given ? undefined : missingId}
        >
          {translate('pl.evidence.reject.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A time-limited deviation with a reason covers one supplier's gap for one evidence type (R41). */
export function DeviationDialog({
  gap,
  limits,
  returnFocusTo,
  onRecorded,
  onClose,
}: {
  gap: EvidenceGap | null;
  limits: Pick<ReviewQueue, 'asOf' | 'maxDeviationUntil'>;
  returnFocusTo: RefObject<HTMLElement | null>;
  onRecorded: (gap: EvidenceGap, deviation: DeviationForm) => void;
  onClose: () => void;
}) {
  const translate = useTranslate();
  return (
    <FormDialog
      open={gap !== null}
      title={translate('pl.evidence.deviation.title')}
      description={
        gap === null
          ? ''
          : translate('pl.evidence.deviation.description', {
              type: translate(gap.evidenceType.label),
              supplier: gap.supplier.name,
            })
      }
      returnFocusTo={returnFocusTo}
      onClose={onClose}
    >
      {gap === null ? null : <DeviationFormFields gap={gap} limits={limits} onRecorded={onRecorded} />}
    </FormDialog>
  );
}

function DeviationFormFields({
  gap,
  limits,
  onRecorded,
}: {
  gap: EvidenceGap;
  limits: Pick<ReviewQueue, 'asOf' | 'maxDeviationUntil'>;
  onRecorded: (gap: EvidenceGap, deviation: DeviationForm) => void;
}) {
  const translate = useTranslate();
  const form = useForm<DeviationFormInput, unknown, DeviationForm>({
    defaultValues: { reason: '', expiresOn: '' },
    resolver: zodResolver(deviationFormSchema(limits)),
    shouldFocusError: true,
  });
  const errors = form.formState.errors;
  const params = { asOf: formatDate(limits.asOf), max: formatDate(limits.maxDeviationUntil) };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit((deviation) => {
          onRecorded(gap, deviation);
        })(event);
      }}
    >
      <TextAreaField
        label={translate('pl.evidence.deviation.reason')}
        description={translate('pl.evidence.deviation.reasonHint')}
        registration={form.register('reason')}
        error={errors.reason}
        errorParams={params}
        required
      />
      <TextField
        label={translate('pl.evidence.deviation.until')}
        description={translate('pl.evidence.deviation.untilHint', params)}
        registration={form.register('expiresOn')}
        error={errors.expiresOn}
        errorParams={params}
        type="date"
        required
      />
      <DialogFooter>
        <DialogClose>{translate('pl.evidence.deviation.cancel')}</DialogClose>
        <Button type="submit">{translate('pl.evidence.deviation.submit')}</Button>
      </DialogFooter>
    </form>
  );
}
