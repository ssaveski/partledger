import { staffAlertsSchema } from '@partledger/contracts';
import { alertFixtureOutput } from '@partledger/contracts/fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AlertsPanel } from './alerts';

const alerts = staffAlertsSchema.parse(alertFixtureOutput);

function text(props: Parameters<typeof AlertsPanel>[0]): string {
  return renderToStaticMarkup(<AlertsPanel {...props} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

const closeAction = <button type="button">Close</button>;
const onRetry = () => undefined;

describe('the alerts panel', () => {
  it('announces that the alerts are loading while the read is in flight', () => {
    expect(text({ result: undefined, loading: true, onRetry, closeAction })).toContain('Loading alerts');
  });

  it('lists each alert with its wording, where it comes from and when it was raised', () => {
    const shown = text({ result: { ok: true, value: alerts }, loading: false, onRetry, closeAction });
    expect(shown).toContain('The audit trail check failed');
    expect(shown).toContain('The nightly check failed at entry 1187.');
    expect(shown).toContain('Organisation');
    expect(shown).toContain('Supplier evidence expires soon');
    expect(shown).toContain('A supplier document expires in 21 days.');
    expect(shown).toContain('For you');
    expect(shown).toContain('Raised Sep 26, 2026, 03:17 UTC');
  });

  it('says there is nothing to act on when there are no alerts, and offers to close', () => {
    const shown = text({ result: { ok: true, value: { alerts: [] } }, loading: false, onRetry, closeAction });
    expect(shown).toContain('No alerts');
    expect(shown).toContain('Close');
  });

  it('shows the error state with a retry when the read fails, and the no-permission state when it is refused', () => {
    expect(
      text({ result: { ok: false, failure: { kind: 'unavailable' } }, loading: false, onRetry, closeAction }),
    ).toContain('Try again');
    expect(
      text({
        result: {
          ok: false,
          failure: { kind: 'refused', error: 'Forbidden', message: 'pl.error.forbidden.notPermitted', params: {} },
        },
        loading: false,
        onRetry,
        closeAction,
      }),
    ).toContain('You do not have access to this');
  });

  it('shows an alert whose wording this build lacks with the generic wording instead of failing', () => {
    const [first] = alerts.alerts;
    if (first === undefined) {
      throw new Error('The fixture has alerts');
    }
    const unknown = { ...first, titleKey: 'pl.notifications.alert.fromANewerBuild.title' };
    const shown = text({ result: { ok: true, value: { alerts: [unknown] } }, loading: false, onRetry, closeAction });
    expect(shown).toContain('Alerts');
    expect(shown).toContain('The nightly check failed at entry 1187.');
  });
});
