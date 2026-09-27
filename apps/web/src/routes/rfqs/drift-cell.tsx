import { partUnits, type PartDrift } from '@partledger/contracts';
import { StateBadge, useTranslate, type Translate } from '@partledger/ui';

import { driftStates } from './drift-states';

function unitLabel(translate: Translate, value: string): string {
  const unit = partUnits.find((candidate) => candidate === value);
  return unit === undefined ? value : translate(`pl.parts.unit.${unit}`);
}

/** What changed since publish, in the words the parts list uses, such as "Revision B is now C". */
export function driftSummary(translate: Translate, drift: PartDrift): string {
  return drift.changes
    .map((change) =>
      change.field === 'unit'
        ? translate('pl.rfqs.drift.change.unit', {
            snapshot: unitLabel(translate, change.snapshot),
            current: unitLabel(translate, change.current),
          })
        : translate(`pl.rfqs.drift.change.${change.field}`, { snapshot: change.snapshot, current: change.current }),
    )
    .join('; ');
}

/** A drifted line says what changed; the snapshot suppliers quote stays as published (R8). */
export function DriftCell({ drift }: { drift: PartDrift | null }) {
  const translate = useTranslate();
  if (drift === null) {
    return <StateBadge state={driftStates.unchanged} showLabel className="text-muted" />;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <StateBadge state={driftStates.drifted} showLabel />
      <span className="text-sm text-muted">{driftSummary(translate, drift)}</span>
    </span>
  );
}
