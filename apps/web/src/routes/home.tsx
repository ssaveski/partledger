import { fixtureRfqIds, type FixtureScenario } from '@partledger/contracts/fixtures';
import { Card, CardDescription, CardTitle, EmptyState, useTranslate } from '@partledger/ui';
import { Link } from '@tanstack/react-router';

import { useAdapterKind } from '../api/api-client';
import { navigationLinkClasses } from '../shell/app-shell';
import { useDocumentTitle } from '../shell/document-title';

/** The fixture RFQs a reviewer walks through, each standing for one scenario of the key screens. */
const scenarios: readonly FixtureScenario[] = [
  'open',
  'closed',
  'blockedApproval',
  'readyApproval',
  'draftWithoutSuppliers',
  'slow',
  'unavailable',
  'forbidden',
];

export function HomePage() {
  const translate = useTranslate();
  const adapterKind = useAdapterKind();
  useDocumentTitle('pl.web.home.title');
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{translate('pl.web.home.title')}</h1>
        <p className="text-muted">{translate('pl.common.staffAppTagline')}</p>
      </div>
      {adapterKind === 'fixture' ? (
        <section aria-labelledby="preview-scenarios" className="flex flex-col gap-3">
          <h2 id="preview-scenarios" className="text-lg font-semibold">
            {translate('pl.web.home.scenarios.title')}
          </h2>
          <p className="max-w-prose text-sm text-muted">{translate('pl.web.home.scenarios.description')}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {scenarios.map((scenario) => (
              <li key={scenario}>
                <ScenarioCard scenario={scenario} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState titleKey="pl.web.home.empty.title" descriptionKey="pl.web.home.empty.description" action={null} />
      )}
    </>
  );
}

function ScenarioCard({ scenario }: { scenario: FixtureScenario }) {
  const translate = useTranslate();
  const rfqId = fixtureRfqIds[scenario];
  const name = translate(`pl.web.home.scenario.${scenario}.title`);
  return (
    <Card className="h-full gap-2 p-4">
      <CardTitle headingLevel={3}>{name}</CardTitle>
      <CardDescription>{translate(`pl.web.home.scenario.${scenario}.description`)}</CardDescription>
      <ul className="-ml-2 flex flex-wrap gap-1">
        <li>
          <Link to="/rfqs/$rfqId" params={{ rfqId }} search={{}} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.detail')}
            <span className="sr-only">{translate('pl.web.home.scenario.linkContext', { scenario: name })}</span>
          </Link>
        </li>
        <li>
          <Link to="/rfqs/$rfqId/comparison" params={{ rfqId }} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.comparison')}
            <span className="sr-only">{translate('pl.web.home.scenario.linkContext', { scenario: name })}</span>
          </Link>
        </li>
        <li>
          <Link to="/rfqs/$rfqId/approval" params={{ rfqId }} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.approval')}
            <span className="sr-only">{translate('pl.web.home.scenario.linkContext', { scenario: name })}</span>
          </Link>
        </li>
      </ul>
    </Card>
  );
}
