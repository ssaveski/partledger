import type { ComparisonLine, ComparisonSupplier, QuoteComparison } from '@partledger/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Mono,
  raisedSurface,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Textarea,
  useTranslate,
  cn,
} from '@partledger/ui';
import { useId, useRef, useState } from 'react';
import { Controller, useForm, useWatch, type Control, type UseFormRegister } from 'react-hook-form';

import { formatMoney, messageParams } from '../../shell/format';
import {
  awardFormSchema,
  emptyAwardForm,
  noAward,
  requiresJustification,
  winnerOptions,
  type AwardFormValues,
} from './award-form';

/**
 * A winner or no award for every line (R22). Nothing starts selected; choosing a winner that is
 * not the lowest total reveals a justification the form requires. Submitting only checks the
 * form here; the server re-runs the gate when Phase D wires the command.
 */
export function AwardDecisions({ comparison }: { comparison: QuoteComparison }) {
  const translate = useTranslate();
  const reasonId = useId();
  const lines = useRef(comparison.lines);
  lines.current = comparison.lines;
  const form = useForm<AwardFormValues>({
    defaultValues: emptyAwardForm(comparison.lines),
    // Reads the latest lines, so a recorded outside quote that changes the lowest total counts.
    resolver: (values, context, options) => zodResolver(awardFormSchema(lines.current))(values, context, options),
    shouldFocusError: true,
  });
  const decisions = useWatch({ control: form.control, name: 'decisions' });
  const [submitted, setSubmitted] = useState(false);
  const submitBlocked = comparison.blockingReasons.find((reason) => reason.transition === 'submitAward');
  const canSubmit = comparison.allowedTransitions.includes('submitAward');

  return (
    <section aria-labelledby="decisions-heading" className="flex flex-col gap-3">
      <h2 id="decisions-heading" className="text-lg font-semibold">
        {translate('pl.rfqs.award.title')}
      </h2>
      <p className="max-w-prose text-sm text-muted">{translate('pl.rfqs.award.description')}</p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          setSubmitted(false);
          void form.handleSubmit(() => {
            setSubmitted(true);
          })(event);
        }}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {comparison.lines.map((line, index) => (
            <LineDecision
              key={line.lineId}
              index={index}
              line={line}
              suppliers={comparison.suppliers}
              control={form.control}
              register={form.register}
              winner={decisions[index]?.winner ?? ''}
              justificationError={form.formState.errors.decisions?.[index]?.justification?.message}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!canSubmit}
            focusableWhenDisabled
            aria-describedby={canSubmit ? undefined : reasonId}
          >
            {translate('pl.rfqs.award.submit')}
          </Button>
          {canSubmit || submitBlocked === undefined ? null : (
            <p id={reasonId} className="text-sm text-muted">
              {translate(submitBlocked.message, messageParams(submitBlocked.params))}
            </p>
          )}
        </div>
        <p role="status" className="text-sm font-medium text-success">
          {submitted ? translate('pl.rfqs.award.submittedPreview') : null}
        </p>
      </form>
    </section>
  );
}

function LineDecision({
  index,
  line,
  suppliers,
  control,
  register,
  winner,
  justificationError,
}: {
  index: number;
  line: ComparisonLine;
  suppliers: readonly ComparisonSupplier[];
  control: Control<AwardFormValues>;
  register: UseFormRegister<AwardFormValues>;
  winner: string;
  justificationError: string | undefined;
}) {
  const translate = useTranslate();
  const options = winnerOptions(line, suppliers);
  const lowest = options.find((option) => option.lowest);
  const items = [
    ...options.map((option) => ({
      value: option.supplierId,
      label: translate(option.lowest ? 'pl.rfqs.award.optionLowest' : 'pl.rfqs.award.option', {
        supplier: option.name,
        total: formatMoney(option.total),
      }),
    })),
    { value: noAward, label: translate('pl.rfqs.award.noAward') },
  ];
  return (
    <fieldset className={cn('flex flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}>
      <legend className="float-left flex w-full flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        <span>{translate('pl.rfqs.comparison.lineLabel', { line: line.lineNumber })}</span>
        <Mono className="font-normal text-muted">
          {translate('pl.rfqs.comparison.partLabel', { part: line.partNumber, revision: line.revision })}
        </Mono>
        <span className="font-normal text-muted">{line.description}</span>
      </legend>
      <Controller
        control={control}
        name={`decisions.${index}.winner`}
        render={({ field, fieldState }) => (
          <Field invalid={fieldState.error !== undefined}>
            <Select
              items={items}
              value={field.value === '' ? null : field.value}
              onValueChange={(value) => {
                field.onChange(value ?? '');
              }}
            >
              <FieldLabel>{translate('pl.rfqs.award.winner')}</FieldLabel>
              <SelectTrigger
                ref={field.ref}
                onBlur={field.onBlur}
                placeholder={translate('pl.rfqs.award.chooseWinner')}
              />
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error?.message === undefined ? null : (
              <FieldError match>{translate(fieldState.error.message)}</FieldError>
            )}
          </Field>
        )}
      />
      {requiresJustification(line, winner) ? (
        <Field invalid={justificationError !== undefined}>
          <FieldLabel>{translate('pl.rfqs.award.justification')}</FieldLabel>
          <FieldDescription>
            {lowest === undefined
              ? translate('pl.rfqs.award.justificationHint')
              : translate('pl.rfqs.award.justificationHintLowest', {
                  supplier: lowest.name,
                  total: formatMoney(lowest.total),
                })}
          </FieldDescription>
          <Textarea required {...register(`decisions.${index}.justification`)} />
          {justificationError === undefined ? null : <FieldError match>{translate(justificationError)}</FieldError>}
        </Field>
      ) : null}
    </fieldset>
  );
}
