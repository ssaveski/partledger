import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';

import { useTranslate } from '../i18n/translation';
import { cn } from '../lib/cn';

export type StateTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** A state a grid cell can show. Each state has its own icon, so colour is never the only signal. */
export interface GridStateDefinition {
  readonly id: string;
  readonly labelKey: string;
  readonly tone: StateTone;
  readonly icon: LucideIcon;
}

// State colours are checked as text on every surface by `pnpm contrast:check`.
const toneClasses: Readonly<Record<StateTone, string>> = {
  neutral: 'text-muted',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

function StateIcon({ state }: { state: GridStateDefinition }) {
  const Icon = state.icon;
  return <Icon aria-hidden data-state-icon={state.id} className={cn('size-4 shrink-0', toneClasses[state.tone])} />;
}

/**
 * A state shown as its icon and colour, named by the same translation key as its legend entry. The name
 * is visually hidden text beside the icon, so assistive technology reads what the legend shows.
 */
export function StateBadge({
  state,
  showLabel = false,
  className,
}: {
  state: GridStateDefinition;
  /** Shows the label beside the icon instead of hiding it visually. */
  showLabel?: boolean;
  className?: string;
}) {
  const translate = useTranslate();
  return (
    <span data-state-badge={state.id} className={cn('inline-flex items-center gap-1.5', className)}>
      <StateIcon state={state} />
      <span className={showLabel ? 'text-sm' : 'sr-only'}>{translate(state.labelKey)}</span>
    </span>
  );
}

/** The key to the icons a grid uses; every entry pairs a state's icon and colour with its visible name. */
export function GridLegend({ states, className }: { states: readonly GridStateDefinition[]; className?: string }) {
  const translate = useTranslate();
  const headingId = useId();
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted', className)}>
      <span id={headingId} className="font-medium">
        {translate('pl.ui.grid.legend')}
      </span>
      <ul aria-labelledby={headingId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {states.map((state) => (
          <li key={state.id} data-legend-entry={state.id} className="inline-flex items-center gap-1.5 text-primary">
            <StateIcon state={state} />
            <span>{translate(state.labelKey)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
