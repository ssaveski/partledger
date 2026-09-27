import type { ComparisonCell, ComparisonLine, ComparisonSupplier } from '@partledger/contracts';
import { Button, cn, createGridColumnHelper, DataGrid, Mono, StateBadge, useTranslate } from '@partledger/ui';
import { useId, useMemo } from 'react';

import { formatMoney, formatNumber } from '../../shell/format';
import {
  alternateAcceptedMarker,
  alternateAwaitingMarker,
  buyerRecordedMarker,
  cellStates,
  evidenceStates,
} from './comparison-states';
import { canRecordOutsideQuote, type OutsideQuoteAction } from './outside-quote';

export interface OutsideQuoteTarget {
  readonly line: ComparisonLine;
  readonly supplier: ComparisonSupplier;
}

const helper = createGridColumnHelper<ComparisonLine>();

/**
 * Lines as rows and suppliers as columns on the shared grid (KTD28). Every cell names its state
 * the way the legend does; the lowest total is highlighted, and nothing here selects a winner.
 */
export function ComparisonGrid({
  label,
  lines,
  suppliers,
  outsideQuote,
  unavailableReasonId,
  onRecordOutsideQuote,
}: {
  label: string;
  lines: readonly ComparisonLine[];
  suppliers: readonly ComparisonSupplier[];
  outsideQuote: OutsideQuoteAction;
  /** The element explaining why recording is unavailable, when it is. */
  unavailableReasonId: string;
  onRecordOutsideQuote: (target: OutsideQuoteTarget) => void;
}) {
  const translate = useTranslate();
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('lineNumber', {
          header: () => translate('pl.rfqs.column.line'),
          enableSorting: false,
          cell: ({ row }) => (
            <span className="flex flex-col">
              <span>{translate('pl.rfqs.comparison.lineLabel', { line: row.original.lineNumber })}</span>
              <Mono className="text-xs font-normal text-muted">
                {translate('pl.rfqs.comparison.partLabel', {
                  part: row.original.partNumber,
                  revision: row.original.revision,
                })}
              </Mono>
            </span>
          ),
        }),
        helper.accessor('description', {
          header: () => translate('pl.rfqs.column.description'),
          enableSorting: false,
        }),
        helper.accessor('quantity', {
          header: () => translate('pl.rfqs.column.quantity'),
          enableSorting: false,
          cell: ({ getValue }) => formatNumber(getValue()),
          meta: { numeric: true },
        }),
        ...suppliers.map((supplier) =>
          helper.display({
            id: supplier.supplierId,
            enableSorting: false,
            header: () => <SupplierHeader supplier={supplier} />,
            cell: ({ row }) => {
              const line = row.original;
              const cell = line.cells.find((candidate) => candidate.supplierId === supplier.supplierId);
              return (
                <ComparisonCellView
                  cell={cell}
                  recordOutsideQuote={
                    outsideQuote.kind !== 'hidden' && cell !== undefined && canRecordOutsideQuote(cell.state)
                      ? {
                          disabledReasonId: outsideQuote.kind === 'unavailable' ? unavailableReasonId : null,
                          label: translate('pl.rfqs.outsideQuote.recordFor', {
                            supplier: supplier.name,
                            line: line.lineNumber,
                          }),
                          onClick: () => {
                            onRecordOutsideQuote({ line, supplier });
                          },
                        }
                      : null
                  }
                />
              );
            },
          }),
        ),
      ]),
    [translate, suppliers, outsideQuote, unavailableReasonId, onRecordOutsideQuote],
  );
  return (
    <DataGrid
      label={label}
      data={lines}
      columns={columns}
      getRowId={(line) => line.lineId}
      pageSize={5}
      className="max-h-[36rem]"
    />
  );
}

function SupplierHeader({ supplier }: { supplier: ComparisonSupplier }) {
  return (
    <span className="flex flex-col items-start gap-0.5 py-1">
      <span className="text-primary">{supplier.name}</span>
      <StateBadge state={evidenceStates[supplier.evidence]} showLabel className="[&>span]:text-xs" />
    </span>
  );
}

function ComparisonCellView({
  cell,
  recordOutsideQuote,
}: {
  cell: ComparisonCell | undefined;
  recordOutsideQuote: { label: string; disabledReasonId: string | null; onClick: () => void } | null;
}) {
  const translate = useTranslate();
  const stateId = useId();
  if (cell === undefined) {
    return <span className="text-xs text-muted">{translate('pl.rfqs.comparison.notInvited')}</span>;
  }
  const quote = cell.quote;
  const best = cell.state === 'bestPrice';
  return (
    <span
      data-cell-state={cell.state}
      className={cn(
        'flex min-w-40 flex-col gap-0.5 rounded-md border border-transparent px-2 py-1 whitespace-normal',
        best && 'border-success bg-surface-sunken',
      )}
    >
      <span className="flex items-center gap-1.5">
        <StateBadge state={cellStates[cell.state]} showLabel={quote === null} />
        {/* The action takes focus in its cell, so it names the cell's state as its description. */}
        <span id={stateId} hidden>
          {translate(cellStates[cell.state].labelKey)}
        </span>
        {quote === null ? null : (
          <Mono
            className={cn('text-sm', best && 'font-semibold text-success', cell.state === 'stale' && 'line-through')}
          >
            {formatMoney(quote.normalisedTotal)}
          </Mono>
        )}
        {quote?.buyerRecorded === true ? <StateBadge state={buyerRecordedMarker} /> : null}
      </span>
      {quote === null ? null : (
        <span className="text-xs text-muted">
          {translate('pl.rfqs.comparison.quoteSummary', {
            unitPrice: formatMoney(quote.unitPrice),
            leadTime: quote.leadTimeDays,
          })}
        </span>
      )}
      {cell.alternate === null ? null : (
        <span className="flex flex-col gap-0.5 text-xs">
          <Mono className="whitespace-nowrap">
            {translate('pl.rfqs.comparison.alternatePart', { part: cell.alternate.partNumber })}
          </Mono>
          <StateBadge
            state={cell.alternate.acceptedByQuality ? alternateAcceptedMarker : alternateAwaitingMarker}
            showLabel
            className="[&>span]:text-xs"
          />
        </span>
      )}
      {cell.noQuoteReason === null ? null : <span className="max-w-56 text-xs text-muted">{cell.noQuoteReason}</span>}
      {recordOutsideQuote === null ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="mt-1 h-7 self-start px-2 text-xs"
          aria-label={recordOutsideQuote.label}
          aria-describedby={
            recordOutsideQuote.disabledReasonId === null ? stateId : `${stateId} ${recordOutsideQuote.disabledReasonId}`
          }
          disabled={recordOutsideQuote.disabledReasonId !== null}
          focusableWhenDisabled
          onClick={recordOutsideQuote.onClick}
        >
          {translate('pl.rfqs.outsideQuote.record')}
        </Button>
      )}
    </span>
  );
}
