import type { EvidenceGap, ExpiryStatus, ReviewDocument } from '@partledger/contracts';
import type { GridStateDefinition } from '@partledger/ui';
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarIcon,
  CalendarXIcon,
  FileQuestionIcon,
  FileXIcon,
  HourglassIcon,
  ScanSearchIcon,
  ShieldEllipsisIcon,
  ShieldOffIcon,
  ShieldXIcon,
} from 'lucide-react';

/** Document expiry: expiring within 60 days is flagged (R14). */
export const documentExpiryStates: Readonly<Record<ExpiryStatus, GridStateDefinition>> = {
  current: { id: 'documentCurrent', labelKey: 'pl.evidence.expiry.current', tone: 'success', icon: CalendarCheckIcon },
  expiringSoon: {
    id: 'documentExpiringSoon',
    labelKey: 'pl.evidence.expiry.expiringSoon',
    tone: 'warning',
    icon: CalendarClockIcon,
  },
  expired: { id: 'documentExpired', labelKey: 'pl.evidence.expiry.expired', tone: 'danger', icon: CalendarXIcon },
  noExpiry: { id: 'documentNoExpiry', labelKey: 'pl.evidence.expiry.noExpiry', tone: 'neutral', icon: CalendarIcon },
};

/** Unscanned files are never served (R12), so the scan state is always shown. */
export const scanStates: Readonly<Record<ReviewDocument['scan'], GridStateDefinition>> = {
  clean: { id: 'scanClean', labelKey: 'pl.evidence.scan.clean', tone: 'success', icon: ScanSearchIcon },
  pending: { id: 'scanPending', labelKey: 'pl.evidence.scan.pending', tone: 'warning', icon: HourglassIcon },
};

export const problemStates: Readonly<Record<EvidenceGap['problem'], GridStateDefinition>> = {
  missing: { id: 'problemMissing', labelKey: 'pl.evidence.problem.missing', tone: 'danger', icon: FileQuestionIcon },
  expired: { id: 'problemExpired', labelKey: 'pl.evidence.problem.expired', tone: 'danger', icon: ShieldXIcon },
  rejected: { id: 'problemRejected', labelKey: 'pl.evidence.problem.rejected', tone: 'danger', icon: FileXIcon },
};

export const deviationStates: Readonly<Record<'active' | 'none', GridStateDefinition>> = {
  active: { id: 'deviationActive', labelKey: 'pl.evidence.deviation.active', tone: 'info', icon: ShieldEllipsisIcon },
  none: { id: 'deviationNone', labelKey: 'pl.evidence.deviation.none', tone: 'neutral', icon: ShieldOffIcon },
};
