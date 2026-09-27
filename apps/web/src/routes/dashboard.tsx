import {
  reviewQueueQuery,
  rfqListQuery,
  supplierListQuery,
  type ReviewQueue,
  type RfqList,
  type SupplierList,
} from '@partledger/contracts';
import { buttonVariants, cn, EmptyState, Mono, raisedSurface, StateBadge, useTranslate } from '@partledger/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useAdapterKind, useApiQuery } from '../api/api-client';
import { navigationLinkClasses } from '../shell/app-shell';
import { useDocumentTitle } from '../shell/document-title';
import { formatInstantUtc, formatNumber } from '../shell/format';
import { SectionQueryView } from '../shell/query-view';
import { PreviewScenarios } from './home';
import { evidenceStates } from './rfqs/comparison-states';
import { driftStates } from './rfqs/drift-states';
import { closingNext, dashboardCounts, evidenceCounts, suppliersNeedingAttention } from './dashboard-summary';
import { approvalExpiryStates } from './suppliers/supplier-states';

/**
 * The overview: what needs a person's attention across RFQs, evidence and suppliers. Each section
 * reads on its own, so one refused or failed read leaves the others usable.
 */
export function DashboardPage() {
  const translate = useTranslate();
  const adapterKind = useAdapterKind();
  useDocumentTitle('pl.web.home.title');
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{translate('pl.web.home.title')}</h1>
        <p className="text-muted">{translate('pl.common.staffAppTagline')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RfqSection />
        <div className="flex flex-col gap-4">
          <EvidenceSection />
          <SupplierSection />
        </div>
      </div>
      {adapterKind === 'fixture' ? <PreviewScenarios /> : null}
    </>
  );
}

function DashboardCard({ id, titleKey, children }: { id: string; titleKey: string; children: ReactNode }) {
  const translate = useTranslate();
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}
    >
      <h2 id={id} className="text-lg font-semibold">
        {translate(titleKey)}
      </h2>
      {children}
    </section>
  );
}

/** The numbers a section leads with; the label follows its number for assistive technology too. */
function Counts({ items }: { items: readonly { labelKey: string; count: number }[] }) {
  const translate = useTranslate();
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.labelKey} className="flex flex-col-reverse gap-1 rounded-md border border-line p-3">
          <dt className="text-sm text-muted">{translate(item.labelKey)}</dt>
          <dd className="font-mono text-2xl font-semibold tabular-nums">{formatNumber(item.count)}</dd>
        </div>
      ))}
    </dl>
  );
}

function RfqSection() {
  const translate = useTranslate();
  const query = useApiQuery(rfqListQuery, {});
  return (
    <DashboardCard id="dashboard-rfqs" titleKey="pl.web.dashboard.rfqs.title">
      <SectionQueryView query={query} loadingKey="pl.web.dashboard.rfqs.loading">
        {(list) =>
          list.rfqs.length === 0 ? (
            <EmptyState
              headingLevel={3}
              titleKey="pl.web.dashboard.rfqs.empty.title"
              descriptionKey="pl.web.dashboard.rfqs.empty.description"
              action={
                <Link to="/rfqs/new" className={buttonVariants({ variant: 'primary' })}>
                  {translate('pl.rfqs.list.new')}
                </Link>
              }
            />
          ) : (
            <RfqSummary list={list} />
          )
        }
      </SectionQueryView>
    </DashboardCard>
  );
}

function RfqSummary({ list }: { list: RfqList }) {
  const translate = useTranslate();
  const counts = dashboardCounts(list);
  const next = closingNext(list);
  return (
    <>
      <Counts
        items={[
          { labelKey: 'pl.web.dashboard.rfqs.open', count: counts.open },
          { labelKey: 'pl.web.dashboard.rfqs.awaitingApproval', count: counts.awaitingApproval },
          { labelKey: 'pl.web.dashboard.rfqs.driftedLines', count: counts.driftedLines },
        ]}
      />
      <h3 className="text-base font-semibold">{translate('pl.web.dashboard.rfqs.closingNext')}</h3>
      {next.length === 0 ? (
        <p className="text-sm text-muted">{translate('pl.web.dashboard.rfqs.noneOpen')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {next.map((rfq) => (
            <li key={rfq.rfqId} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to="/rfqs/$rfqId"
                  params={{ rfqId: rfq.rfqId }}
                  search={{}}
                  className={cn(navigationLinkClasses, '-ml-2 font-mono text-primary')}
                >
                  {rfq.reference}
                </Link>
                <span>{rfq.title}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <Mono>{translate('pl.web.dashboard.rfqs.closes', { instant: formatInstantUtc(rfq.deadline) })}</Mono>
                <span>
                  {translate('pl.rfqs.list.responses', { responded: rfq.respondedCount, invited: rfq.invitedCount })}
                </span>
                {rfq.driftedLineCount === 0 ? null : (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <StateBadge state={driftStates.drifted} />
                    {translate('pl.rfqs.list.driftedLines', { count: rfq.driftedLineCount })}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/rfqs" className={cn(navigationLinkClasses, '-ml-2 self-start')}>
        {translate('pl.web.dashboard.rfqs.all')}
      </Link>
    </>
  );
}

function EvidenceSection() {
  const query = useApiQuery(reviewQueueQuery, {});
  return (
    <DashboardCard id="dashboard-evidence" titleKey="pl.web.dashboard.evidence.title">
      <SectionQueryView query={query} loadingKey="pl.web.dashboard.evidence.loading">
        {(queue) => <EvidenceSummary queue={queue} />}
      </SectionQueryView>
    </DashboardCard>
  );
}

function EvidenceSummary({ queue }: { queue: ReviewQueue }) {
  const translate = useTranslate();
  const counts = evidenceCounts(queue);
  if (queue.documents.length === 0 && queue.gaps.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        titleKey="pl.web.dashboard.evidence.empty.title"
        descriptionKey="pl.web.dashboard.evidence.empty.description"
        action={null}
      />
    );
  }
  return (
    <>
      <Counts
        items={[
          { labelKey: 'pl.web.dashboard.evidence.awaiting', count: counts.awaiting },
          { labelKey: 'pl.web.dashboard.evidence.awaitingExpiring', count: counts.awaitingExpiring },
          { labelKey: 'pl.web.dashboard.evidence.uncovered', count: counts.uncovered },
        ]}
      />
      <Link to="/evidence" className={cn(navigationLinkClasses, '-ml-2 self-start')}>
        {translate('pl.web.dashboard.evidence.review')}
      </Link>
    </>
  );
}

function SupplierSection() {
  const query = useApiQuery(supplierListQuery, {});
  return (
    <DashboardCard id="dashboard-suppliers" titleKey="pl.web.dashboard.suppliers.title">
      <SectionQueryView query={query} loadingKey="pl.web.dashboard.suppliers.loading">
        {(list) => <SupplierSummaryList list={list} />}
      </SectionQueryView>
    </DashboardCard>
  );
}

function SupplierSummaryList({ list }: { list: SupplierList }) {
  const translate = useTranslate();
  const attention = suppliersNeedingAttention(list);
  if (list.suppliers.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        titleKey="pl.web.dashboard.suppliers.empty.title"
        descriptionKey="pl.web.dashboard.suppliers.empty.description"
        action={null}
      />
    );
  }
  return (
    <>
      {attention.length === 0 ? (
        <p className="text-sm text-muted">{translate('pl.web.dashboard.suppliers.allClear')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {attention.map((supplier) => (
            <li key={supplier.supplierId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="font-medium">{supplier.name}</span>
              {supplier.approval.expiry === 'expiringSoon' || supplier.approval.expiry === 'expired' ? (
                <StateBadge state={approvalExpiryStates[supplier.approval.expiry]} showLabel />
              ) : null}
              {supplier.evidence === 'expiring' || supplier.evidence === 'invalid' ? (
                <StateBadge state={evidenceStates[supplier.evidence]} showLabel />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link to="/suppliers" className={cn(navigationLinkClasses, '-ml-2 self-start')}>
        {translate('pl.web.dashboard.suppliers.all')}
      </Link>
    </>
  );
}
