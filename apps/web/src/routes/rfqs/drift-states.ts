import type { GridStateDefinition } from '@partledger/ui';
import { FileCheckIcon, FileDiffIcon } from 'lucide-react';

/**
 * An open line whose part changed after publish (R8). The line keeps its snapshot, so suppliers
 * quote what was published; the flag tells the buyer to amend if the change matters.
 */
export const driftStates: Readonly<Record<'drifted' | 'unchanged', GridStateDefinition>> = {
  drifted: { id: 'drifted', labelKey: 'pl.rfqs.drift.drifted', tone: 'warning', icon: FileDiffIcon },
  unchanged: { id: 'unchanged', labelKey: 'pl.rfqs.drift.unchanged', tone: 'neutral', icon: FileCheckIcon },
};
