import type { PartSource } from '@partledger/contracts';
import type { GridStateDefinition } from '@partledger/ui';
import { CircleCheckIcon, CircleOffIcon, DatabaseIcon, PencilLineIcon } from 'lucide-react';

export const partSourceStates: Readonly<Record<PartSource, GridStateDefinition>> = {
  erp: { id: 'sourceErp', labelKey: 'pl.parts.source.erp', tone: 'info', icon: DatabaseIcon },
  platform: { id: 'sourcePlatform', labelKey: 'pl.parts.source.platform', tone: 'accent', icon: PencilLineIcon },
};

export const partStatusStates: Readonly<Record<'active' | 'inactive', GridStateDefinition>> = {
  active: { id: 'partActive', labelKey: 'pl.parts.status.active', tone: 'success', icon: CircleCheckIcon },
  inactive: { id: 'partInactive', labelKey: 'pl.parts.status.inactive', tone: 'neutral', icon: CircleOffIcon },
};
