import { staffAlertsSchema } from '@partledger/contracts';
import { alertFixtureOutput } from '@partledger/contracts/fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AlertsPanel, type RenderAlertLink } from './alerts';

const alerts = staffAlertsSchema.parse(alertFixtureOutput);

function text(props: Parameters<typeof AlertsPanel>[0]): string {
  return renderToStaticMarkup(<AlertsPanel {...props} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

const closeAction = <button type="button">Close</button>;
const onRetry = () => undefined;
const renderLink: RenderAlertLink = (path, className, children) => (
  <a href={path} className={className}>
    {children}
  </a>
);

describe('the alerts panel', () => {
  it('announces that the alerts are loading while the read is in flight', () => {
    expect(text({ result: undefined, loading: true, onRetry, closeAction, renderLink })).toContain('Loading alerts');
  });

  it('lists each alert with its wording, where it comes from and when it was raised', () => {
    const shown = text({ result: { ok: true, value: alerts }, loading: false, onRetry, closeAction, renderLink });
    expect(shown).toContain('The audit trail check failed');
    expect(shown).toContain('The nightly check failed at entry 1187.');
    expect(shown).toContain('Organization');
    expect(shown).toContain('Supplier evidence expires soon');
    expect(shown).toContain('A supplier document expires in 21 days.');
    expect(shown).toContain('For you');
    expect(shown).toContain('Raised Sep 26, 2026, 03:17 UTC');
  });

  it('says there is nothing to act on when there are no alerts, and offers to close', () => {
    const shown = text({
      result: { ok: true, value: { alerts: [] } },
      loading: false,
      onRetry,
      closeAction,
      renderLink,
    });
    expect(shown).toContain('No alerts');
    expect(shown).toContain('Close');
  });

  it('shows the error state with a retry when the read fails, and the no-permission state when it is refused', () => {
    expect(
      text({
        result: { ok: false, failure: { kind: 'unavailable' } },
        loading: false,
        onRetry,
        closeAction,
        renderLink,
      }),
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
        renderLink,
      }),
    ).toContain('You do not have access to this');
  });

  it("shows an alert whose wording this build lacks with the shell's unknown-alert wording, never the page-crash message", () => {
    const [first] = alerts.alerts;
    if (first === undefined) {
      throw new Error('The fixture has alerts');
    }
    const unknown = { ...first, titleKey: 'pl.notifications.alert.fromANewerBuild.title' };
    const shown = text({
      result: { ok: true, value: { alerts: [unknown] } },
      loading: false,
      onRetry,
      closeAction,
      renderLink,
    });
    expect(shown).toContain('Alert');
    expect(shown).toContain('This alert cannot be shown in this version of Partledger.');
    expect(shown).not.toContain('Something went wrong');
  });

  it('translates the params that name messages before filling them in', () => {
    const [first] = alerts.alerts;
    if (first === undefined) {
      throw new Error('The fixture has alerts');
    }
    const failed = {
      ...first,
      titleKey: 'pl.notifications.alert.notificationDeliveryFailed.title',
      descriptionKey: 'pl.notifications.alert.notificationDeliveryFailed.description.other',
      params: { attempts: 4, template: 'rfqAmended', recipientKind: 'supplierContact' },
      keyParams: {
        template: 'pl.notifications.templateName.rfqAmended',
        recipientKind: 'pl.notifications.recipientKind.supplierContact',
      },
    };
    const shown = text({
      result: { ok: true, value: { alerts: [failed] } },
      loading: false,
      onRetry,
      closeAction,
      renderLink,
    });
    expect(shown).toContain(
      'The notice of a changed request for quotation to a supplier contact failed after 4 attempts',
    );
  });

  it('links an alert that has a path to that page of the staff app', () => {
    const markup = renderToStaticMarkup(
      <AlertsPanel
        result={{ ok: true, value: alerts }}
        loading={false}
        onRetry={onRetry}
        closeAction={closeAction}
        renderLink={renderLink}
      />,
    );
    expect(markup).toContain('href="/evidence"');
  });
});
