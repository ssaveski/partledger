import { ResetSecondFactorJobHandler, resetSecondFactorJob } from '../../auth/factor-reset.job';
import { registerJob, type ModuleJobs } from '../job.types';

/** Staff authentication's jobs: the Keycloak half of a second-factor reset (U29). */
const authJobs: ModuleJobs = {
  jobs: [registerJob(resetSecondFactorJob, ResetSecondFactorJobHandler)],
  schedules: [],
};

export default authJobs;
