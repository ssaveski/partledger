import type { FixtureHandler } from '../client/fixture-adapter';
import { notificationFixtureHandlers } from './notifications';
import { evidenceFixtureHandlers } from './evidence';
import { partFixtureHandlers } from './parts';
import { rfqFixtureHandlers } from './rfqs';
import { supplierFixtureHandlers } from './suppliers';

export { alertFixtureOutput, notificationFixtureHandlers } from './notifications';
export { evidenceFixtureHandlers, evidenceFixtureOutputs, fixtureEvidenceDocumentIds } from './evidence';
export { fixtureHash } from './ids';
export { fixtureCategoryOf, fixtureParts, partFixtureHandlers, partFixtureOutputs, type FixturePart } from './parts';
export {
  fixtureId,
  fixtureNormalisedTotal,
  fixtureRfqIds,
  rfqFixtureHandlers,
  rfqFixtureOutputs,
  type FixtureScenario,
} from './rfqs';
export {
  fixtureAsOf,
  fixtureCovers,
  fixtureSupplierIds,
  fixtureSuppliers,
  supplierFixtureHandlers,
  supplierFixtureOutputs,
  type FixtureSupplier,
} from './suppliers';

/** Every synthetic query the fixture adapter serves. */
export const fixtureHandlers: readonly FixtureHandler[] = [
  ...rfqFixtureHandlers,
  ...partFixtureHandlers,
  ...supplierFixtureHandlers,
  ...evidenceFixtureHandlers,
  ...notificationFixtureHandlers,
];
