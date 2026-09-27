import { zodResolver } from '@hookform/resolvers/zod';
import {
  noQuoteReasons,
  portalResponseQuery,
  type PortalResponse,
  type ResponseLine,
} from '@partledger/contracts/portal';
import {
  Button,
  Checkbox,
  cn,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Mono,
  raisedSurface,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Textarea,
  useTranslate,
} from '@partledger/ui';
import { CircleCheckIcon, CircleDotIcon, ClockIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldError as FormFieldError,
  type FieldPathByValue,
  type UseFormRegisterReturn,
} from 'react-hook-form';

import { useApiQuery, useConnection } from '../api/connection';
import { useDocumentTitle } from '../shell/document-title';
import { formatInstantIn, formatInstantUtc } from '../shell/format';
import { countKey } from '../shell/plural';
import { QueryView } from '../shell/query-view';
import { usePortalSession } from '../shell/session-layout';
import { ChangedLineNotice, LineFacts, LineTitle, quantityLabel } from './line-parts';
import {
  answerKinds,
  lineAnswer,
  quoteCurrencies,
  responseFormSchema,
  responseFormValues,
  type ResponseFormValues,
} from './respond-form';

/** How long typing pauses before the draft saves. */
const autosaveDelayMs = 1_000;

type DraftStatus =
  { readonly kind: 'none' } | { readonly kind: 'unsaved' } | { readonly kind: 'saved'; readonly at: string };

export function RespondScreen() {
  const query = useApiQuery(portalResponseQuery, {});
  return (
    <QueryView query={query} titleKey="pl.portal.respond.title" loadingKey="pl.portal.respond.loading">
      {(response) => <ResponseForm response={response} />}
    </QueryView>
  );
}

/**
 * Answers line by line (R18): a quote with a unit price per quantity break, a no-quote with its
 * reason, or an alternate part. Drafts save themselves; submitting checks every line and records
 * who submitted and that they may (R20). In the fixture preview saving and submitting are
 * simulated; U18 replaces them with the draft and submit commands.
 */
function ResponseForm({ response }: { response: PortalResponse }) {
  const translate = useTranslate();
  const session = usePortalSession();
  const { kind } = useConnection();
  useDocumentTitle('pl.portal.respond.documentTitle', { reference: response.reference });
  const form = useForm<ResponseFormValues>({
    defaultValues: responseFormValues(response.lines, response.currency),
    resolver: zodResolver(responseFormSchema(response.lines)),
    // Focus follows the page order rather than the order fields registered in; see onInvalid below.
    shouldFocusError: false,
  });
  const formElement = useRef<HTMLFormElement>(null);
  const values = useWatch({ control: form.control, name: 'lines' });
  const answered = response.lines.filter((line, index) => {
    const lineValues = values[index];
    return lineValues !== undefined && lineAnswer(lineValues, line.quantityBreaks) !== null;
  }).length;
  const previewWrites = kind === 'fixture';
  const canSave = previewWrites && response.allowedTransitions.includes('saveDraft');
  const canSubmit = previewWrites && response.allowedTransitions.includes('submit');
  const submitBlocked = response.blockingReasons.find((reason) => reason.transition === 'submit');
  const [draft, setDraft] = useState<DraftStatus>(
    response.draftSavedAt === null ? { kind: 'none' } : { kind: 'saved', at: response.draftSavedAt },
  );
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const submittedMessage = useRef<HTMLParagraphElement>(null);
  const submitReasonId = useId();

  useEffect(() => {
    let timer: number | undefined;
    const subscription = form.watch((_values, { name }) => {
      // The declaration and attestation belong to the submission, not to the draft.
      if (name === undefined || !name.startsWith('lines.')) {
        return;
      }
      setDraft({ kind: 'unsaved' });
      window.clearTimeout(timer);
      if (canSave) {
        timer = window.setTimeout(() => {
          setDraft({ kind: 'saved', at: new Date().toISOString() });
        }, autosaveDelayMs);
      }
    });
    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [form, canSave]);

  useEffect(() => {
    if (submittedAt !== null) {
      submittedMessage.current?.focus();
    }
  }, [submittedAt]);

  return (
    <>
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          {translate('pl.portal.respond.title')}
          <span className="block text-base font-normal text-muted">
            {translate('pl.portal.respond.subtitle', { reference: response.reference, title: response.title })}
          </span>
        </h1>
        <p className="max-w-prose text-sm text-muted">
          {translate(countKey('pl.portal.respond.intro', response.lines.length), {
            count: response.lines.length,
            buyer: response.buyerName,
          })}
        </p>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm [&_dd]:font-medium [&_dt]:text-muted">
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.respond.deadline')}</dt>
            <dd className="flex flex-col">
              <time dateTime={response.deadline}>{formatInstantIn(response.deadline, session.timeZone)}</time>
              <Mono className="font-normal text-muted">
                {translate('pl.portal.format.utc', { instant: formatInstantUtc(response.deadline) })}
              </Mono>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.respond.lastSubmitted')}</dt>
            <dd>
              {submittedAt !== null
                ? formatInstantIn(submittedAt, session.timeZone)
                : response.lastSubmittedAt === null
                  ? translate('pl.portal.respond.neverSubmitted')
                  : formatInstantIn(response.lastSubmittedAt, session.timeZone)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.respond.progress')}</dt>
            <dd>
              {translate(countKey('pl.portal.respond.answeredCount', response.lines.length), {
                answered,
                total: response.lines.length,
              })}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.respond.draft')}</dt>
            <dd>
              <DraftIndicator status={draft} timeZone={session.timeZone} />
            </dd>
          </div>
        </dl>
        <p className="max-w-prose text-sm text-muted">
          {translate('pl.portal.respond.deadlineRule', { timeZone: session.timeZone })}
        </p>
      </div>
      <form
        ref={formElement}
        noValidate
        className="flex flex-col gap-4"
        aria-labelledby="respond-form-heading"
        onSubmit={(event) => {
          setSubmittedAt(null);
          void form.handleSubmit(
            () => {
              setSubmittedAt(new Date().toISOString());
              setDraft({ kind: 'saved', at: new Date().toISOString() });
            },
            () => {
              // After the errors render, the first invalid control in the page takes focus.
              window.requestAnimationFrame(() => {
                formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
              });
            },
          )(event);
        }}
      >
        <h2 id="respond-form-heading" className="text-lg font-semibold">
          {translate('pl.portal.respond.linesTitle')}
        </h2>
        {response.lines.map((line, index) => (
          <LineFieldset
            key={line.lineId}
            index={index}
            line={line}
            control={form.control}
            // Submitting answers the current version of every line, which resolves a change.
            changed={submittedAt === null && line.changed !== null}
            timeZone={session.timeZone}
            currency={response.currency}
          />
        ))}
        <section
          aria-labelledby="declaration-heading"
          className={cn('flex flex-col gap-4 rounded-lg border border-line p-4', raisedSurface)}
        >
          <h2 id="declaration-heading" className="text-lg font-semibold">
            {translate('pl.portal.respond.declaration.title')}
          </h2>
          <p className="max-w-prose text-sm text-muted">{translate('pl.portal.respond.declaration.description')}</p>
          <TextField
            labelKey="pl.portal.respond.declaration.name"
            descriptionKey="pl.portal.respond.declaration.nameHint"
            registration={form.register('declaredName')}
            error={form.formState.errors.declaredName}
            autoComplete="name"
          />
          <Controller
            control={form.control}
            name="attestation"
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.error !== undefined}>
                <FieldLabel className="flex items-start gap-2 font-normal">
                  <Checkbox
                    ref={field.ref}
                    className="mt-0.5"
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                    }}
                    onBlur={field.onBlur}
                  />
                  {translate('pl.portal.respond.declaration.attestation', { supplier: session.supplierName })}
                </FieldLabel>
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!canSubmit}
              focusableWhenDisabled
              aria-describedby={canSubmit ? undefined : submitReasonId}
            >
              {translate('pl.portal.respond.submit')}
            </Button>
            {canSubmit ? null : (
              <p id={submitReasonId} className="text-sm text-muted">
                {submitBlocked === undefined
                  ? translate('pl.portal.respond.submitUnavailable')
                  : translate(submitBlocked.message)}
              </p>
            )}
          </div>
          <p
            ref={submittedMessage}
            role="status"
            tabIndex={-1}
            className="text-sm font-medium text-success outline-hidden"
          >
            {submittedAt === null ? null : translate('pl.portal.respond.submittedPreview')}
          </p>
        </section>
      </form>
    </>
  );
}

/**
 * Whether the answers typed so far are kept. It reports the draft only; a changed line keeps its
 * own indicator until the response is submitted again.
 */
function DraftIndicator({ status, timeZone }: { status: DraftStatus; timeZone: string }) {
  const translate = useTranslate();
  let icon: ReactNode;
  let text: string;
  switch (status.kind) {
    case 'none':
      icon = <CircleDotIcon aria-hidden className="size-4 text-muted" />;
      text = translate('pl.portal.respond.draftNone');
      break;
    case 'unsaved':
      icon = <ClockIcon aria-hidden className="size-4 text-warning" />;
      text = translate('pl.portal.respond.draftUnsaved');
      break;
    case 'saved':
      icon = <CircleCheckIcon aria-hidden className="size-4 text-success" />;
      text = translate('pl.portal.respond.draftSaved', { savedAt: formatInstantIn(status.at, timeZone) });
      break;
  }
  return (
    <span role="status" data-testid="draft-status" className="flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  );
}

function LineFieldset({
  index,
  line,
  control,
  changed,
  timeZone,
  currency,
}: {
  index: number;
  line: ResponseLine;
  control: Control<ResponseFormValues>;
  changed: boolean;
  timeZone: string;
  currency: string;
}) {
  const translate = useTranslate();
  const changeId = useId();
  const kind = useWatch({ control, name: `lines.${index}.kind` });
  const noQuoteReason = useWatch({ control, name: `lines.${index}.noQuoteReason` });
  const kindItems = answerKinds.map((value) => ({ value, label: translate(`pl.portal.answer.kind.${value}`) }));
  const reasonItems = noQuoteReasons.map((value) => ({
    value,
    label: translate(`pl.portal.noQuoteReason.${value}`),
  }));
  const currencies = quoteCurrencies.some((code) => code === currency)
    ? quoteCurrencies
    : [currency, ...quoteCurrencies];
  const currencyItems = currencies.map((code) => ({ value: code, label: code }));
  const priced = kind === 'quote' || kind === 'alternate';
  return (
    <fieldset
      aria-describedby={changed ? changeId : undefined}
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-4',
        changed ? 'border-warning' : 'border-line',
        raisedSurface,
      )}
    >
      <legend className="float-left w-full text-sm font-semibold">
        <LineTitle line={line} />
      </legend>
      <LineFacts line={line} requiredBy={line.requiredBy} />
      {changed ? <ChangedLineNotice id={changeId} change={line.changed} timeZone={timeZone} canResubmit /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name={`lines.${index}.kind`}
          labelKey="pl.portal.respond.field.answer"
          placeholderKey="pl.portal.respond.field.answerPlaceholder"
          items={kindItems}
        />
        {priced ? (
          <SelectField
            control={control}
            name={`lines.${index}.currency`}
            labelKey="pl.portal.respond.field.currency"
            items={currencyItems}
          />
        ) : null}
      </div>
      {kind === 'alternate' ? (
        <Controller
          control={control}
          name={`lines.${index}.specification`}
          render={({ field, fieldState }) => (
            <Field invalid={fieldState.error !== undefined}>
              <FieldLabel>{translate('pl.portal.respond.field.specification')}</FieldLabel>
              <Textarea required {...field} />
              <FieldDescription>{translate('pl.portal.respond.field.specificationHint')}</FieldDescription>
              <FormError error={fieldState.error} />
            </Field>
          )}
        />
      ) : null}
      {priced ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {line.quantityBreaks.map((quantity, breakIndex) => (
              <Controller
                key={quantity}
                control={control}
                name={`lines.${index}.unitPrices.${breakIndex}`}
                render={({ field, fieldState }) => (
                  <Field invalid={fieldState.error !== undefined}>
                    <FieldLabel>
                      {translate('pl.portal.respond.field.unitPrice', {
                        quantity: quantityLabel(translate, quantity, line.unit),
                      })}
                    </FieldLabel>
                    <Input inputMode="decimal" required {...field} />
                    <FormError error={fieldState.error} />
                  </Field>
                )}
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInputField
              control={control}
              name={`lines.${index}.minimumOrderQuantity`}
              labelKey="pl.portal.respond.field.minimumOrderQuantity"
              inputMode="numeric"
            />
            <TextInputField
              control={control}
              name={`lines.${index}.leadTimeDays`}
              labelKey="pl.portal.respond.field.leadTimeDays"
              inputMode="numeric"
            />
            <TextInputField
              control={control}
              name={`lines.${index}.oneOffCosts`}
              labelKey="pl.portal.respond.field.oneOffCosts"
              descriptionKey="pl.portal.respond.field.oneOffCostsHint"
              inputMode="decimal"
            />
            <TextInputField
              control={control}
              name={`lines.${index}.validUntil`}
              labelKey="pl.portal.respond.field.validUntil"
              type="date"
            />
          </div>
        </>
      ) : null}
      {kind === 'noQuote' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name={`lines.${index}.noQuoteReason`}
            labelKey="pl.portal.respond.field.noQuoteReason"
            placeholderKey="pl.portal.respond.field.noQuoteReasonPlaceholder"
            items={reasonItems}
          />
          <Controller
            control={control}
            name={`lines.${index}.noQuoteNote`}
            render={({ field, fieldState }) => (
              <Field invalid={fieldState.error !== undefined}>
                <FieldLabel>
                  {translate(
                    noQuoteReason === 'other'
                      ? 'pl.portal.respond.field.noQuoteNoteRequired'
                      : 'pl.portal.respond.field.noQuoteNote',
                  )}
                </FieldLabel>
                <Textarea required={noQuoteReason === 'other'} {...field} />
                <FormError error={fieldState.error} />
              </Field>
            )}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

function SelectField({
  control,
  name,
  labelKey,
  placeholderKey,
  items,
}: {
  control: Control<ResponseFormValues>;
  name: FieldPathByValue<ResponseFormValues, string>;
  labelKey: string;
  placeholderKey?: string;
  items: readonly { value: string; label: string }[];
}) {
  const translate = useTranslate();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field invalid={fieldState.error !== undefined}>
          <Select
            items={items}
            value={field.value === '' ? null : field.value}
            onValueChange={(value) => {
              field.onChange(value ?? '');
            }}
          >
            <FieldLabel>{translate(labelKey)}</FieldLabel>
            <SelectTrigger
              ref={field.ref}
              onBlur={field.onBlur}
              placeholder={placeholderKey === undefined ? undefined : translate(placeholderKey)}
            />
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
  );
}

/** A text input bound to one field of the form, showing that field's error. */
function TextInputField({
  control,
  name,
  labelKey,
  descriptionKey,
  type = 'text',
  inputMode,
}: {
  control: Control<ResponseFormValues>;
  name: FieldPathByValue<ResponseFormValues, string>;
  labelKey: string;
  descriptionKey?: string;
  type?: 'text' | 'date';
  inputMode?: 'decimal' | 'numeric';
}) {
  const translate = useTranslate();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field invalid={fieldState.error !== undefined}>
          <FieldLabel>{translate(labelKey)}</FieldLabel>
          <Input type={type} inputMode={inputMode} required {...field} />
          {descriptionKey === undefined ? null : <FieldDescription>{translate(descriptionKey)}</FieldDescription>}
          <FormError error={fieldState.error} />
        </Field>
      )}
    />
  );
}

function TextField({
  labelKey,
  descriptionKey,
  registration,
  error,
  autoComplete,
}: {
  labelKey: string;
  descriptionKey: string;
  registration: UseFormRegisterReturn;
  error: FormFieldError | undefined;
  autoComplete: string;
}) {
  const translate = useTranslate();
  return (
    <Field invalid={error !== undefined} className="max-w-md">
      <FieldLabel>{translate(labelKey)}</FieldLabel>
      <Input required autoComplete={autoComplete} {...registration} />
      <FieldDescription>{translate(descriptionKey)}</FieldDescription>
      <FormError error={error} />
    </Field>
  );
}

function FormError({ error }: { error: FormFieldError | undefined }) {
  const translate = useTranslate();
  if (error?.message === undefined) {
    return null;
  }
  return <FieldError match>{translate(error.message)}</FieldError>;
}
