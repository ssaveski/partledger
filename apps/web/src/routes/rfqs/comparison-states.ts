import type { ComparisonCellState, SupplierEvidenceStatus } from '@partledger/contracts';
import type { GridStateDefinition } from '@partledger/ui';
import {
  AlarmClockOffIcon,
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  ClipboardPenIcon,
  HistoryIcon,
  HourglassIcon,
  ReplaceIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldEllipsisIcon,
  ShieldXIcon,
  TrophyIcon,
} from 'lucide-react';

/**
 * The seven comparison cell states. Each has its own icon and a label key the legend shows and
 * the cell announces, so colour is never the only signal (R35).
 */
export const cellStates: Readonly<Record<ComparisonCellState, GridStateDefinition>> = {
  bestPrice: { id: 'bestPrice', labelKey: 'pl.rfqs.cellState.bestPrice', tone: 'success', icon: TrophyIcon },
  submitted: { id: 'submitted', labelKey: 'pl.rfqs.cellState.submitted', tone: 'info', icon: CircleCheckIcon },
  alternate: { id: 'alternate', labelKey: 'pl.rfqs.cellState.alternate', tone: 'accent', icon: ReplaceIcon },
  noQuote: { id: 'noQuote', labelKey: 'pl.rfqs.cellState.noQuote', tone: 'neutral', icon: CircleSlashIcon },
  pending: { id: 'pending', labelKey: 'pl.rfqs.cellState.pending', tone: 'neutral', icon: CircleDashedIcon },
  stale: { id: 'stale', labelKey: 'pl.rfqs.cellState.stale', tone: 'warning', icon: HistoryIcon },
  late: { id: 'late', labelKey: 'pl.rfqs.cellState.late', tone: 'danger', icon: AlarmClockOffIcon },
};

/** Not a state: a quote a buyer recorded from outside the portal can be in any quoted state (R42). */
export const buyerRecordedMarker: GridStateDefinition = {
  id: 'buyerRecorded',
  labelKey: 'pl.rfqs.marker.buyerRecorded',
  tone: 'accent',
  icon: ClipboardPenIcon,
};

export const alternateAcceptedMarker: GridStateDefinition = {
  id: 'alternateAccepted',
  labelKey: 'pl.rfqs.marker.alternateAccepted',
  tone: 'success',
  icon: BadgeCheckIcon,
};

export const alternateAwaitingMarker: GridStateDefinition = {
  id: 'alternateAwaiting',
  labelKey: 'pl.rfqs.marker.alternateAwaiting',
  tone: 'warning',
  icon: HourglassIcon,
};

export const evidenceStates: Readonly<Record<SupplierEvidenceStatus, GridStateDefinition>> = {
  valid: { id: 'evidenceValid', labelKey: 'pl.rfqs.evidence.valid', tone: 'success', icon: ShieldCheckIcon },
  expiring: { id: 'evidenceExpiring', labelKey: 'pl.rfqs.evidence.expiring', tone: 'warning', icon: ShieldAlertIcon },
  invalid: { id: 'evidenceInvalid', labelKey: 'pl.rfqs.evidence.invalid', tone: 'danger', icon: ShieldXIcon },
  deviation: {
    id: 'evidenceDeviation',
    labelKey: 'pl.rfqs.evidence.deviation',
    tone: 'info',
    icon: ShieldEllipsisIcon,
  },
};
