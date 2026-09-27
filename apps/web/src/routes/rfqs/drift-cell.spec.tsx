import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DriftCell } from './drift-cell';

function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a drift cell', () => {
  it('names a changed unit in the words the parts list uses', () => {
    const drift = {
      detectedAt: '2026-09-26T06:00:00Z',
      changes: [{ field: 'unit' as const, snapshot: 'each', current: 'kilogram' }],
    };
    expect(text(renderToStaticMarkup(<DriftCell drift={drift} />))).toContain('Unit each is now kg');
  });

  it('names a changed revision and description together', () => {
    const drift = {
      detectedAt: '2026-09-26T06:00:00Z',
      changes: [
        { field: 'revision' as const, snapshot: 'B', current: 'C' },
        { field: 'description' as const, snapshot: 'Drive shaft', current: 'Drive shaft, hardened' },
      ],
    };
    expect(text(renderToStaticMarkup(<DriftCell drift={drift} />))).toContain(
      'Revision B is now C; Description is now Drive shaft, hardened',
    );
  });

  it('says there is no change on a line whose part has not drifted', () => {
    expect(text(renderToStaticMarkup(<DriftCell drift={null} />))).toContain('No change');
  });
});
