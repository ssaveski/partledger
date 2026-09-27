import type { ReviewQueue, RfqList, RfqListRow, SupplierList, SupplierSummary } from '@partledger/contracts';

export function dashboardCounts(list: RfqList): {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly driftedLines: number;
} {
  const open = list.rfqs.filter((rfq) => rfq.status === 'published');
  return {
    open: open.length,
    awaitingApproval: list.rfqs.filter((rfq) => rfq.status === 'pendingApproval').length,
    driftedLines: open.reduce((total, rfq) => total + rfq.driftedLineCount, 0),
  };
}

/** Open RFQs whose deadline comes first. */
export function closingNext(list: RfqList, limit = 5): RfqListRow[] {
  return list.rfqs
    .filter((rfq) => rfq.status === 'published')
    .sort((first, second) => Date.parse(first.deadline) - Date.parse(second.deadline))
    .slice(0, limit);
}

/** Suppliers whose approval or evidence has expired, is invalid, or ends within 60 days. */
export function suppliersNeedingAttention(list: SupplierList): SupplierSummary[] {
  return list.suppliers.filter(
    (supplier) =>
      supplier.approval.expiry === 'expiringSoon' ||
      supplier.approval.expiry === 'expired' ||
      supplier.evidence === 'expiring' ||
      supplier.evidence === 'invalid',
  );
}

/**
 * The evidence queue in numbers. The expiring count covers only documents awaiting confirmation;
 * confirmed evidence that expires soon shows on the supplier card instead.
 */
export function evidenceCounts(queue: ReviewQueue): {
  readonly awaiting: number;
  readonly awaitingExpiring: number;
  readonly uncovered: number;
} {
  return {
    awaiting: queue.documents.length,
    awaitingExpiring: queue.documents.filter((document) => document.expiry === 'expiringSoon').length,
    uncovered: queue.gaps.filter((gap) => gap.deviation === null).length,
  };
}
