import {
  rfqAssignmentQuery,
  rfqDetailQuery,
  rfqListQuery,
  type RfqAssignment,
  type RfqDetail,
} from '@partledger/contracts';
import { useMemo } from 'react';

import { useApiClient, usePreviewWrite } from '../../api/api-client';
import { listRowOf, withListRow } from './rfq-builder';

export interface RfqPreview {
  /** Writes an RFQ's detail (and assignment) to the preview and keeps its row in the list in step. */
  save(change: { readonly detail: RfqDetail; readonly assignment?: RfqAssignment }): Promise<void>;
}

/** RFQ writes in the fixture preview; null against the API, where U16's commands perform them. */
export function useRfqPreview(): RfqPreview | null {
  const write = usePreviewWrite();
  const client = useApiClient();
  return useMemo(() => {
    if (write === null) {
      return null;
    }
    return {
      async save({ detail, assignment }) {
        const rfqId = detail.rfqId;
        write(rfqDetailQuery, { rfqId }, detail);
        if (assignment !== undefined) {
          write(rfqAssignmentQuery, { rfqId }, assignment);
        }
        const list = await client.query(rfqListQuery, {});
        if (list.ok) {
          write(rfqListQuery, {}, withListRow(list.value, listRowOf(detail)));
        }
      },
    };
  }, [write, client]);
}
