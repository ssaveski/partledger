import type { ApprovalStatus, ExpiryStatus, IdentityCheck, SupplierEvidenceStatus } from '@partledger/contracts';
import type { GridStateDefinition } from '@partledger/ui';
import {
  BadgeCheckIcon,
  BadgeMinusIcon,
  BadgeXIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarIcon,
  CalendarXIcon,
  CheckCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CirclePauseIcon,
  SearchXIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
} from 'lucide-react';

import { evidenceStates } from '../rfqs/comparison-states';

/** A supplier the evidence vault has not assessed yet, so its evidence status is unknown. */
export const evidenceNotAssessedState: GridStateDefinition = {
  id: 'evidenceNotAssessed',
  labelKey: 'pl.suppliers.evidence.notAssessed',
  tone: 'neutral',
  icon: ShieldQuestionIcon,
};

export function evidenceStateOf(status: SupplierEvidenceStatus | null): GridStateDefinition {
  return status === null ? evidenceNotAssessedState : evidenceStates[status];
}

export const approvalStates: Readonly<Record<ApprovalStatus, GridStateDefinition>> = {
  approved: {
    id: 'approvalApproved',
    labelKey: 'pl.suppliers.approval.approved',
    tone: 'success',
    icon: BadgeCheckIcon,
  },
  conditional: {
    id: 'approvalConditional',
    labelKey: 'pl.suppliers.approval.conditional',
    tone: 'warning',
    icon: BadgeMinusIcon,
  },
  suspended: {
    id: 'approvalSuspended',
    labelKey: 'pl.suppliers.approval.suspended',
    tone: 'danger',
    icon: CirclePauseIcon,
  },
  notApproved: {
    id: 'approvalNotApproved',
    labelKey: 'pl.suppliers.approval.notApproved',
    tone: 'neutral',
    icon: BadgeXIcon,
  },
};

/** Approval expiry; the evidence screens name the same statuses in their own words. */
export const approvalExpiryStates: Readonly<Record<ExpiryStatus, GridStateDefinition>> = {
  current: { id: 'approvalCurrent', labelKey: 'pl.suppliers.expiry.current', tone: 'success', icon: CalendarCheckIcon },
  expiringSoon: {
    id: 'approvalExpiringSoon',
    labelKey: 'pl.suppliers.expiry.expiringSoon',
    tone: 'warning',
    icon: CalendarClockIcon,
  },
  expired: { id: 'approvalExpired', labelKey: 'pl.suppliers.expiry.expired', tone: 'danger', icon: CalendarXIcon },
  noExpiry: { id: 'approvalNoExpiry', labelKey: 'pl.suppliers.expiry.noExpiry', tone: 'neutral', icon: CalendarIcon },
};

export const identityStates: Readonly<Record<IdentityCheck['status'], GridStateDefinition>> = {
  verified: {
    id: 'identityVerified',
    labelKey: 'pl.suppliers.identity.verified',
    tone: 'success',
    icon: UserRoundCheckIcon,
  },
  mismatch: {
    id: 'identityMismatch',
    labelKey: 'pl.suppliers.identity.mismatch',
    tone: 'warning',
    icon: UserRoundXIcon,
  },
  notFound: { id: 'identityNotFound', labelKey: 'pl.suppliers.identity.notFound', tone: 'warning', icon: SearchXIcon },
  notChecked: {
    id: 'identityNotChecked',
    labelKey: 'pl.suppliers.identity.notChecked',
    tone: 'neutral',
    icon: CircleDashedIcon,
  },
  notApplicable: {
    id: 'identityNotApplicable',
    labelKey: 'pl.suppliers.identity.notApplicable',
    tone: 'neutral',
    icon: CircleMinusIcon,
  },
};

/** Marks a supplier whose approved scope does not cover a line (assignment, R15). */
export const outOfScopeState: GridStateDefinition = {
  id: 'outOfScope',
  labelKey: 'pl.rfqs.assignment.outOfScope',
  tone: 'warning',
  icon: TriangleAlertIcon,
};

export const inScopeState: GridStateDefinition = {
  id: 'inScope',
  labelKey: 'pl.rfqs.assignment.inScope',
  tone: 'success',
  icon: CheckCheckIcon,
};
