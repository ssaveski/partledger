import { portalFixtureLinks, type PortalFixtureScenario } from '@partledger/contracts/fixtures/portal';
import { Card, CardDescription, CardTitle, cn, focusRing, useTranslate } from '@partledger/ui';
import { MailIcon } from 'lucide-react';
import { useEffect } from 'react';

import { useConnection } from '../api/connection';

/** The fixture links a reviewer walks through, each standing for one situation a supplier can be in. */
const scenarios: readonly PortalFixtureScenario[] = [
  'open',
  'closed',
  'sealed',
  'evidence',
  'expired',
  'revoked',
  'slow',
  'unavailable',
];

/** Suppliers arrive through links, so the portal's front page only says where to find one. */
export function HomePage() {
  const translate = useTranslate();
  const { kind } = useConnection();
  const title = translate('pl.common.portalTitle');
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted">{translate('pl.common.portalTagline')}</p>
        <p className="flex max-w-prose items-start gap-2 text-sm text-muted">
          <MailIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          {translate('pl.portal.home.openFromEmail')}
        </p>
      </div>
      {kind === 'fixture' ? (
        <section aria-labelledby="preview-links" className="flex flex-col gap-3">
          <h2 id="preview-links" className="text-lg font-semibold">
            {translate('pl.portal.home.scenarios.title')}
          </h2>
          <p className="max-w-prose text-sm text-muted">{translate('pl.portal.home.scenarios.description')}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {scenarios.map((scenario) => (
              <li key={scenario}>
                <ScenarioCard scenario={scenario} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ScenarioCard({ scenario }: { scenario: PortalFixtureScenario }) {
  const translate = useTranslate();
  const { linkId, secret } = portalFixtureLinks[scenario];
  const name = translate(`pl.portal.home.scenario.${scenario}.title`);
  return (
    <Card className="h-full gap-2 p-4">
      <CardTitle headingLevel={3}>{name}</CardTitle>
      <CardDescription>{translate(`pl.portal.home.scenario.${scenario}.description`)}</CardDescription>
      {/* A full page load, as from an email, so the landing page starts with the secret in its fragment. */}
      <a
        href={`/link/${linkId}#${secret}`}
        className={cn(
          'self-start rounded-md text-sm font-medium text-primary underline decoration-accent underline-offset-4',
          focusRing,
        )}
      >
        {translate('pl.portal.home.scenario.openLink')}
        <span className="sr-only">{translate('pl.portal.home.scenario.linkContext', { scenario: name })}</span>
      </a>
    </Card>
  );
}
