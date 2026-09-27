import type { FixtureHandler } from '../client/fixture-adapter';
import { notificationFixtureHandlers } from './notifications';
import { rfqFixtureHandlers } from './rfqs';

export { alertFixtureOutput, notificationFixtureHandlers } from './notifications';
export {
  fixtureId,
  fixtureNormalisedTotal,
  fixtureRfqIds,
  rfqFixtureHandlers,
  rfqFixtureOutputs,
  type FixtureScenario,
} from './rfqs';

/** Every synthetic query the fixture adapter serves. */
export const fixtureHandlers: readonly FixtureHandler[] = [...rfqFixtureHandlers, ...notificationFixtureHandlers];
