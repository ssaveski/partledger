import {
  rfqAssignmentQuery,
  rfqDetailQuery,
  type AssignmentCandidate,
  type AssignmentLine,
  type RfqAssignment,
} from '@partledger/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { Checkbox, cn, EmptyState, GridLegend, Mono, raisedSurface, StateBadge, useTranslate } from '@partledger/ui';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';

import { useApiClient, useApiQuery } from '../../api/api-client';
import { actionAvailability } from '../../shell/action-availability';
import { ActionButton } from '../../shell/action-button';
import { useDocumentTitle } from '../../shell/document-title';
import { formatDate, formatInstantUtc, formatNumber } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { approvalStates, evidenceStateOf, inScopeState, outOfScopeState } from '../suppliers/supplier-states';
import {
  assignmentFormFrom,
  assignmentFormSchema,
  canInvite,
  submitAssignment,
  type AssignmentFormValues,
  type AssignmentIntent,
} from './assignment-form';
import { Fact, RfqHeader } from './rfq-header';
import { useRfqPreview } from './rfq-preview';

const route = getRouteApi('/rfqs/$rfqId/assignment');

const notYetAvailableKey = 'pl.rfqs.changes.notYetAvailable';

export function AssignmentScreen() {
  const { rfqId } = route.useParams();
  const query = useApiQuery(rfqAssignmentQuery, { rfqId });
  return (
    <QueryView query={query} titleKey="pl.rfqs.assignment.title" loadingKey="pl.rfqs.assignment.loading">
      {(assignment) => <AssignmentView assignment={assignment} />}
    </QueryView>
  );
}

function AssignmentView({ assignment }: { assignment: RfqAssignment }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.assignment.documentTitle', { reference: assignment.reference });
  const preview = useRfqPreview();
  const client = useApiClient();
  const navigate = useNavigate();
  const intent = useRef<AssignmentIntent>('save');
  const current = useRef(assignment);
  current.current = assignment;
  const form = useForm<AssignmentFormValues>({
    defaultValues: assignmentFormFrom(assignment),
    // Reads the intent of the button pressed: saving accepts empty lines, publishing does not.
    resolver: (values, context, options) =>
      zodResolver(assignmentFormSchema(current.current, intent.current))(values, context, options),
    shouldFocusError: true,
  });
  const [outcome, setOutcome] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const editable = assignment.allowedTransitions.includes('assign');
  const save = actionAvailability(assignment, 'assign', preview !== null, notYetAvailableKey);
  const publish = actionAvailability(assignment, 'publish', preview !== null, notYetAvailableKey);

  const submit = (next: AssignmentIntent) => {
    intent.current = next;
    setOutcome(null);
    setFailed(false);
    void form.handleSubmit(async (values) => {
      const result = await submitAssignment(next, assignment, values, {
        readDetail: () => client.query(rfqDetailQuery, { rfqId: assignment.rfqId }),
        save: preview === null ? null : (change) => preview.save(change),
      });
      if (result === 'failed') {
        setFailed(true);
      } else if (result === 'saved') {
        setOutcome(translate('pl.rfqs.assignment.saved'));
        status.current?.focus();
      } else {
        await navigate({ to: '/rfqs/$rfqId', params: { rfqId: assignment.rfqId }, search: {} });
      }
    })();
  };

  return (
    <>
      <RfqHeader
        rfqId={assignment.rfqId}
        reference={assignment.reference}
        title={assignment.title}
        status={assignment.status}
        screenKey="pl.rfqs.assignment.title"
      >
        <Fact label={translate('pl.rfqs.detail.deadline')}>
          <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(assignment.deadline) })}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.detail.version')}>
          <Mono>{formatNumber(assignment.version)}</Mono>
        </Fact>
      </RfqHeader>
      <div className="flex max-w-prose flex-col gap-2 text-sm">
        <p>{translate('pl.rfqs.assignment.description')}</p>
        <p className="flex items-start gap-2 text-muted">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          {translate(`pl.rfqs.assignment.policy.${assignment.outOfScopePolicy}`)}
        </p>
      </div>
      {assignment.lines.every((line) => line.candidates.length === 0) ? (
        <EmptyState
          titleKey="pl.rfqs.assignment.empty.title"
          descriptionKey="pl.rfqs.assignment.empty.description"
          action={null}
        />
      ) : (
        <>
          <GridLegend states={[inScopeState, outOfScopeState]} />
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (publish.kind === 'available') {
                submit('publish');
              }
            }}
          >
            <div className="grid gap-3 xl:grid-cols-2">
              {assignment.lines.map((line, index) => (
                <LineAssignment
                  key={line.lineId}
                  index={index}
                  line={line}
                  policy={assignment.outOfScopePolicy}
                  editable={editable}
                  control={form.control}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton
                availability={publish}
                variant="primary"
                onAction={() => {
                  submit('publish');
                }}
              >
                {translate('pl.rfqs.assignment.publish')}
              </ActionButton>
              <ActionButton
                availability={save}
                onAction={() => {
                  submit('save');
                }}
              >
                {translate('pl.rfqs.assignment.save')}
              </ActionButton>
            </div>
            <p ref={status} role="status" tabIndex={-1} className="text-sm font-medium text-success outline-hidden">
              {outcome}
            </p>
            {failed ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {translate('pl.rfqs.assignment.saveFailed')}
              </p>
            ) : null}
          </form>
        </>
      )}
    </>
  );
}

function LineAssignment({
  index,
  line,
  policy,
  editable,
  control,
}: {
  index: number;
  line: AssignmentLine;
  policy: RfqAssignment['outOfScopePolicy'];
  editable: boolean;
  control: Control<AssignmentFormValues>;
}) {
  const translate = useTranslate();
  const errorId = useId();
  return (
    <Controller
      control={control}
      name={`lines.${index}.supplierIds`}
      render={({ field, fieldState }) => {
        const invited = field.value;
        const outside = line.candidates.filter(
          (candidate) => !candidate.inScope && invited.includes(candidate.supplierId),
        ).length;
        return (
          <fieldset
            aria-describedby={fieldState.error === undefined ? undefined : errorId}
            className={cn('flex flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}
          >
            <legend className="float-left flex w-full flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              <span>{translate('pl.rfqs.comparison.lineLabel', { line: line.lineNumber })}</span>
              <Mono className="font-normal text-muted">
                {translate('pl.rfqs.comparison.partLabel', { part: line.partNumber, revision: line.revision })}
              </Mono>
              <span className="font-normal text-muted">{line.description}</span>
              <span className="font-normal text-muted">
                {translate('pl.rfqs.assignment.category', {
                  category: translate(`pl.parts.category.${line.category}`),
                })}
              </span>
            </legend>
            <p className="text-sm text-muted">
              {translate('pl.rfqs.assignment.lineSummary', {
                quantity: formatNumber(line.quantity),
                date: formatDate(line.requiredBy),
                invited: invited.length,
                outside,
              })}
            </p>
            <ul className="flex flex-col gap-2">
              {line.candidates.map((candidate) => (
                <li key={candidate.supplierId}>
                  <CandidateOption
                    candidate={candidate}
                    checked={invited.includes(candidate.supplierId)}
                    disabled={!editable || !canInvite(policy, candidate.inScope)}
                    focusRef={invited.length === 0 && candidate === line.candidates[0] ? field.ref : undefined}
                    onChange={(checked) => {
                      field.onChange(
                        checked
                          ? [...invited, candidate.supplierId]
                          : invited.filter((supplierId) => supplierId !== candidate.supplierId),
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
            {fieldState.error?.message === undefined ? null : (
              <p id={errorId} className="text-sm font-medium text-danger">
                {translate(fieldState.error.message)}
              </p>
            )}
          </fieldset>
        );
      }}
    />
  );
}

function CandidateOption({
  candidate,
  checked,
  disabled,
  focusRef,
  onChange,
}: {
  candidate: AssignmentCandidate;
  checked: boolean;
  disabled: boolean;
  focusRef: ((element: HTMLElement | null) => void) | undefined;
  onChange: (checked: boolean) => void;
}) {
  const nameId = useId();
  const statusId = useId();
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_1fr] items-start gap-x-3 gap-y-1">
      {/* The name takes clicks too, so the target is larger than the 16px box (WCAG 2.5.8). */}
      <label className="flex cursor-pointer items-start gap-3 has-data-disabled:cursor-not-allowed">
        <Checkbox
          ref={focusRef}
          checked={checked}
          disabled={disabled}
          aria-labelledby={nameId}
          aria-describedby={statusId}
          className="mt-0.5"
          onCheckedChange={(next) => {
            onChange(next);
          }}
        />
        <span id={nameId} className="text-sm font-medium">
          {candidate.name}
        </span>
      </label>
      <span id={statusId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <StateBadge state={candidate.inScope ? inScopeState : outOfScopeState} showLabel />
        {candidate.approval.status === 'approved' ? null : (
          <StateBadge state={approvalStates[candidate.approval.status]} showLabel />
        )}
        <StateBadge state={evidenceStateOf(candidate.evidence)} showLabel />
      </span>
    </div>
  );
}
