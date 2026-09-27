import { previewStates } from '@partledger/contracts/client';
import { fixtureRfqIds, type FixtureScenario } from '@partledger/contracts/fixtures';
import { Card, CardDescription, CardTitle, useTranslate } from '@partledger/ui';
import { Link } from '@tanstack/react-router';

import { previewSearchParameter } from '../api/preview';
import { navigationLinkClasses } from '../shell/app-shell';

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

/** The screens whose reads take no id, so the address asks them for a designed state instead. */
const stateScreens = [
  { key: 'overview', path: '/' },
  { key: 'rfqs', path: '/rfqs' },
  { key: 'newRfq', path: '/rfqs/new' },
  { key: 'parts', path: '/parts' },
  { key: 'suppliers', path: '/suppliers' },
  { key: 'evidence', path: '/evidence' },
] as const;

/** What a reviewer can open in the fixture preview: synthetic RFQs, and every screen in each designed state. */
export function PreviewScenarios() {
  const translate = useTranslate();
  return (
    <>
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
      <section aria-labelledby="preview-states" className="flex flex-col gap-3">
        <h2 id="preview-states" className="text-lg font-semibold">
          {translate('pl.web.home.states.title')}
        </h2>
        <p className="max-w-prose text-sm text-muted">{translate('pl.web.home.states.description')}</p>
        <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {stateScreens.map((screen) => {
            const name = translate(`pl.web.home.states.screen.${screen.key}`);
            return (
              <li key={screen.key} className="flex flex-wrap items-baseline gap-x-1">
                <span className="mr-1 text-sm font-medium">{name}</span>
                {previewStates.map((state) => (
                  // A full page load, so the new address picks its state for every read.
                  <a
                    key={state}
                    href={`${screen.path}?${previewSearchParameter}=${state}`}
                    className={navigationLinkClasses}
                  >
                    {translate(`pl.web.home.states.state.${state}`)}
                    <span className="sr-only">{translate('pl.web.home.scenario.linkContext', { scenario: name })}</span>
                  </a>
                ))}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function ScenarioCard({ scenario }: { scenario: FixtureScenario }) {
  const translate = useTranslate();
  const rfqId = fixtureRfqIds[scenario];
  const name = translate(`pl.web.home.scenario.${scenario}.title`);
  const context = <span className="sr-only">{translate('pl.web.home.scenario.linkContext', { scenario: name })}</span>;
  return (
    <Card className="h-full gap-2 p-4">
      <CardTitle headingLevel={3}>{name}</CardTitle>
      <CardDescription>{translate(`pl.web.home.scenario.${scenario}.description`)}</CardDescription>
      <ul className="-ml-2 flex flex-wrap gap-1">
        <li>
          <Link to="/rfqs/$rfqId" params={{ rfqId }} search={{}} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.detail')}
            {context}
          </Link>
        </li>
        <li>
          <Link to="/rfqs/$rfqId/assignment" params={{ rfqId }} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.assignment')}
            {context}
          </Link>
        </li>
        <li>
          <Link to="/rfqs/$rfqId/comparison" params={{ rfqId }} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.comparison')}
            {context}
          </Link>
        </li>
        <li>
          <Link to="/rfqs/$rfqId/approval" params={{ rfqId }} className={navigationLinkClasses}>
            {translate('pl.web.rfq.section.approval')}
            {context}
          </Link>
        </li>
      </ul>
    </Card>
  );
}
