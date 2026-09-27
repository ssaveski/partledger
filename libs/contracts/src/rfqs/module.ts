import type { QueryDeclaration } from '../define';
import { rfqAssignmentQuery } from './assignment';
import { rfqListQuery, rfqQueries } from './queries';

/**
 * Every read the rfqs module declares, for registries and registry tests. The assignment read
 * lives in its own file because it builds on the supplier contracts.
 */
export const rfqModuleQueries: readonly QueryDeclaration[] = [...rfqQueries, rfqListQuery, rfqAssignmentQuery];
