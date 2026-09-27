import type { RfqStatus } from '@partledger/contracts';
import { Badge, Mono, useTranslate, type StateTone } from '@partledger/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { navigationLinkClasses } from '../../shell/app-shell';

const statusTones: Readonly<Record<RfqStatus, StateTone>> = {
  draft: 'neutral',
  published: 'info',
  closed: 'warning',
  pendingApproval: 'accent',
  sealed: 'success',
  cancelled: 'neutral',
};

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  const translate = useTranslate();
  return <Badge tone={statusTones[status]}>{translate(`pl.rfqs.status.${status}`)}</Badge>;
}

/**
 * The heading every RFQ screen shares: reference, title, status and the links between its
 * sections. The page heading names the screen, so each screen is distinguishable by its title.
 */
export function RfqHeader({
  rfqId,
  reference,
  title,
  status,
  screenKey,
  children,
}: {
  rfqId: string;
  reference: string;
  title: string;
  status: RfqStatus | null;
  /** The message key naming the screen, shown as the page heading. */
  screenKey: string;
  /** Facts about the RFQ shown under the heading, as `<div>` pairs of `<dt>` and `<dd>`. */
  children?: ReactNode;
}) {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-4">
      <div className="flex flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Mono>{reference}</Mono>
          {status === null ? null : <RfqStatusBadge status={status} />}
        </p>
        <h1 className="text-2xl font-semibold">
          {translate(screenKey)}
          <span className="block text-base font-normal text-muted">{title}</span>
        </h1>
      </div>
      {children === undefined ? null : (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm [&_dd]:font-medium [&_dt]:text-muted">{children}</dl>
      )}
      <nav aria-label={translate('pl.web.rfq.sections', { reference })}>
        <ul className="-ml-2 flex flex-wrap gap-1">
          <li>
            <Link
              to="/rfqs/$rfqId"
              params={{ rfqId }}
              search={{}}
              activeOptions={{ exact: true, includeSearch: false }}
              className={navigationLinkClasses}
            >
              {translate('pl.web.rfq.section.detail')}
            </Link>
          </li>
          <li>
            <Link to="/rfqs/$rfqId/comparison" params={{ rfqId }} className={navigationLinkClasses}>
              {translate('pl.web.rfq.section.comparison')}
            </Link>
          </li>
          <li>
            <Link to="/rfqs/$rfqId/approval" params={{ rfqId }} className={navigationLinkClasses}>
              {translate('pl.web.rfq.section.approval')}
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
