import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, ClockIcon } from 'lucide-react';

import type { GridStateDefinition } from '../grid/state-badge';
import type { SamplePartStatus } from './sample-data';

/** Preview states for the sample parts; each has its own icon, so colour is never the only signal. */
export const samplePartStates: Readonly<Record<SamplePartStatus, GridStateDefinition>> = {
  approved: { id: 'approved', labelKey: 'pl.preview.approved', tone: 'success', icon: CircleCheckIcon },
  pending: { id: 'pending', labelKey: 'pl.preview.pending', tone: 'warning', icon: ClockIcon },
  expired: { id: 'expired', labelKey: 'pl.preview.expired', tone: 'danger', icon: CircleXIcon },
  draft: { id: 'draft', labelKey: 'pl.preview.draft', tone: 'neutral', icon: CircleDashedIcon },
};
