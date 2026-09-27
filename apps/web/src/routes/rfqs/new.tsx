import { partListQuery, rfqListQuery, supplierListQuery, type PartList, type PartSummary } from '@partledger/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  cn,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  Mono,
  raisedSurface,
  useTranslate,
} from '@partledger/ui';
import { useNavigate } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';

import { useApiClient, useApiQuery } from '../../api/api-client';
import { ActionButton } from '../../shell/action-button';
import { useDocumentTitle } from '../../shell/document-title';
import { TextField } from '../../shell/form-dialog';
import { FilterBar, SearchFilter } from '../../shell/list-filters';
import { QueryView } from '../../shell/query-view';
import { matchesText } from '../../shell/text-filter';
import {
  builderFormSchema,
  builderLineFor,
  emptyBuilderForm,
  nextReference,
  previewDraft,
  previewTenantCurrency,
  type BuilderForm,
  type BuilderFormValues,
} from './rfq-builder';
import { useRfqPreview } from './rfq-preview';

export function NewRfqScreen() {
  const query = useApiQuery(partListQuery, {});
  return (
    <QueryView query={query} titleKey="pl.rfqs.builder.title" loadingKey="pl.rfqs.builder.loading">
      {(list) => <BuilderView list={list} />}
    </QueryView>
  );
}

function BuilderView({ list }: { list: PartList }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.builder.title');
  const preview = useRfqPreview();
  const client = useApiClient();
  const navigate = useNavigate();
  const parts = useMemo(() => list.parts.filter((part) => part.active), [list.parts]);
  const form = useForm<BuilderFormValues, unknown, BuilderForm>({
    defaultValues: emptyBuilderForm(),
    resolver: (values, context, options) =>
      zodResolver(builderFormSchema(new Date().toISOString()))(values, context, options),
    shouldFocusError: true,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const chosen = useWatch({ control: form.control, name: 'lines' }).map((line) => line.partId);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const save = async (draft: BuilderForm) => {
    setFailed(false);
    const [suppliers, rfqs] = await Promise.all([client.query(supplierListQuery, {}), client.query(rfqListQuery, {})]);
    if (preview === null || !suppliers.ok || !rfqs.ok) {
      setFailed(true);
      return;
    }
    const rfqId = window.crypto.randomUUID();
    const created = previewDraft(draft, {
      rfqId,
      reference: nextReference(rfqs.value),
      currency: previewTenantCurrency,
      lineIds: draft.lines.map(() => window.crypto.randomUUID()),
      parts,
      suppliers: suppliers.value.suppliers,
    });
    await preview.save(created);
    await navigate({ to: '/rfqs/$rfqId/assignment', params: { rfqId } });
  };

  const toggle = useCallback(
    (part: PartSummary) => {
      const index = form.getValues('lines').findIndex((line) => line.partId === part.partId);
      if (index === -1) {
        append(builderLineFor(part), { shouldFocus: false });
        setAnnouncement(translate('pl.rfqs.builder.added', { part: part.partNumber }));
      } else {
        remove(index);
        setAnnouncement(translate('pl.rfqs.builder.removed', { part: part.partNumber }));
      }
    },
    [form, append, remove, translate],
  );

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold">{translate('pl.rfqs.builder.title')}</h1>
        <p className="max-w-prose text-muted">{translate('pl.rfqs.builder.description')}</p>
      </div>
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (preview !== null) {
            void form.handleSubmit(save)(event);
          }
        }}
      >
        <section aria-labelledby="builder-details" className="flex flex-col gap-3">
          <h2 id="builder-details" className="text-lg font-semibold">
            {translate('pl.rfqs.builder.details')}
          </h2>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <TextField
              label={translate('pl.rfqs.builder.rfqTitle')}
              registration={form.register('title')}
              error={form.formState.errors.title}
              required
            />
            <TextField
              label={translate('pl.rfqs.builder.deadline')}
              description={translate('pl.rfqs.builder.deadlineHint')}
              registration={form.register('deadline')}
              error={form.formState.errors.deadline}
              type="datetime-local"
              required
            />
          </div>
        </section>
        <PartPicker parts={parts} chosen={chosen} onToggle={toggle} />
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <LinesSection form={form} parts={parts} fields={fields} onRemove={remove} />
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton
            availability={
              preview === null
                ? { kind: 'notYetAvailable', messageKey: 'pl.rfqs.changes.notYetAvailable' }
                : { kind: 'available' }
            }
            variant="primary"
            onAction={() => {
              void form.handleSubmit(save)();
            }}
          >
            {translate('pl.rfqs.builder.submit')}
          </ActionButton>
          <p className="text-sm text-muted">{translate('pl.rfqs.builder.submitHint')}</p>
        </div>
        {failed ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {translate('pl.rfqs.builder.saveFailed')}
          </p>
        ) : null}
      </form>
    </>
  );
}

const partHelper = createGridColumnHelper<PartSummary>();

/** The parts already chosen, read by each row's button so the grid's columns never change. */
const ChosenParts = createContext<ReadonlySet<string>>(new Set());

function ChooseButton({ part, onToggle }: { part: PartSummary; onToggle: (part: PartSummary) => void }) {
  const translate = useTranslate();
  const added = useContext(ChosenParts).has(part.partId);
  return (
    <Button
      size="sm"
      variant={added ? 'secondary' : 'primary'}
      onClick={() => {
        onToggle(part);
      }}
    >
      {translate(added ? 'pl.rfqs.builder.remove' : 'pl.rfqs.builder.add')}
      <span className="sr-only">{translate('pl.rfqs.builder.partContext', { part: part.partNumber })}</span>
    </Button>
  );
}

/** Parts are chosen from the list (R15); only active parts can start a line. */
function PartPicker({
  parts,
  chosen,
  onToggle,
}: {
  parts: readonly PartSummary[];
  chosen: readonly string[];
  onToggle: (part: PartSummary) => void;
}) {
  const translate = useTranslate();
  const [search, setSearch] = useState('');
  const shown = parts.filter((part) => matchesText(search, [part.partNumber, part.description]));
  const chosenKey = chosen.join(' ');
  const chosenSet = useMemo(() => new Set(chosenKey.split(' ')), [chosenKey]);
  // Stable, so a row's button keeps focus when it switches between add and remove.
  const columns = useMemo(
    () =>
      partHelper.columns([
        partHelper.accessor('partNumber', {
          header: () => translate('pl.parts.list.column.part'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        partHelper.accessor('revision', {
          header: () => translate('pl.parts.list.column.revision'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        partHelper.accessor('description', { header: () => translate('pl.parts.list.column.description') }),
        partHelper.accessor((part) => translate(`pl.parts.category.${part.category}`), {
          id: 'category',
          header: () => translate('pl.parts.list.column.category'),
        }),
        partHelper.display({
          id: 'choose',
          header: () => translate('pl.rfqs.builder.column.choose'),
          cell: ({ row }) => <ChooseButton part={row.original} onToggle={onToggle} />,
        }),
      ]),
    [translate, onToggle],
  );
  return (
    <section aria-labelledby="builder-parts" className="flex flex-col gap-3">
      <h2 id="builder-parts" className="text-lg font-semibold">
        {translate('pl.rfqs.builder.parts')}
      </h2>
      {parts.length === 0 ? (
        <EmptyState
          headingLevel={3}
          titleKey="pl.rfqs.builder.noParts.title"
          descriptionKey="pl.rfqs.builder.noParts.description"
          action={null}
        />
      ) : (
        <>
          <FilterBar labelKey="pl.rfqs.builder.filter">
            <SearchFilter labelKey="pl.parts.filter.search" value={search} onChange={setSearch} />
          </FilterBar>
          {shown.length === 0 ? (
            <EmptyState
              headingLevel={3}
              titleKey="pl.parts.list.noMatch.title"
              descriptionKey="pl.rfqs.builder.noMatch.description"
              action={null}
            />
          ) : (
            <ChosenParts value={chosenSet}>
              <DataGrid
                label={translate('pl.rfqs.builder.partsGridLabel')}
                data={shown}
                columns={columns}
                getRowId={(part) => part.partId}
                className="max-h-96"
              />
            </ChosenParts>
          )}
        </>
      )}
    </section>
  );
}

function LinesSection({
  form,
  parts,
  fields,
  onRemove,
}: {
  form: UseFormReturn<BuilderFormValues, unknown, BuilderForm>;
  parts: readonly PartSummary[];
  fields: readonly { id: string; partId: string }[];
  onRemove: (index: number) => void;
}) {
  const translate = useTranslate();
  const errors = form.formState.errors.lines;
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section aria-labelledby="builder-lines" className="flex flex-col gap-3">
      <h2 id="builder-lines" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-hidden">
        {translate('pl.rfqs.builder.lines', { count: fields.length })}
      </h2>
      {fields.length === 0 ? (
        <>
          <EmptyState
            headingLevel={3}
            titleKey="pl.rfqs.builder.noLines.title"
            descriptionKey="pl.rfqs.builder.noLines.description"
            action={null}
          />
          {errors?.root?.message === undefined && errors?.message === undefined ? null : (
            <p role="alert" className="text-sm font-medium text-danger">
              {translate(errors.root?.message ?? errors.message ?? 'pl.rfqs.builder.error.noLines')}
            </p>
          )}
        </>
      ) : (
        <ol className="grid gap-3 xl:grid-cols-2">
          {fields.map((field, index) => {
            const part = parts.find((candidate) => candidate.partId === field.partId);
            const lineErrors = errors?.[index];
            const unit = part === undefined ? '' : translate(`pl.parts.unit.${part.unit}`);
            return (
              <li key={field.id}>
                <fieldset className={cn('flex flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}>
                  <legend className="float-left flex w-full flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                    <span>{translate('pl.rfqs.comparison.lineLabel', { line: index + 1 })}</span>
                    <Mono className="font-normal text-muted">
                      {translate('pl.rfqs.comparison.partLabel', {
                        part: part?.partNumber ?? '',
                        revision: part?.revision ?? '',
                      })}
                    </Mono>
                    <span className="font-normal text-muted">{part?.description}</span>
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <TextField
                      label={translate('pl.rfqs.builder.quantity', { unit })}
                      registration={form.register(`lines.${index}.quantity`)}
                      error={lineErrors?.quantity}
                      inputMode="numeric"
                      required
                    />
                    <TextField
                      label={translate('pl.rfqs.builder.quantityBreaks')}
                      description={translate('pl.rfqs.builder.quantityBreaksHint')}
                      registration={form.register(`lines.${index}.quantityBreaks`)}
                      error={lineErrors?.quantityBreaks}
                    />
                    <TextField
                      label={translate('pl.rfqs.builder.requiredBy')}
                      registration={form.register(`lines.${index}.requiredBy`)}
                      error={lineErrors?.requiredBy}
                      type="date"
                      required
                    />
                  </div>
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onRemove(index);
                        heading.current?.focus();
                      }}
                    >
                      {translate('pl.rfqs.builder.removeLine', { line: index + 1 })}
                    </Button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
