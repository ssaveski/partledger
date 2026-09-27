import { IdentityCheckHandler, identityCheckJob } from '../../identity-checks/identity-check.job';
import { registerJob, type ModuleJobs } from '../job.types';

/** The suppliers module's jobs: identity checks against the VIES and LEI registers (R10). */
const supplierJobs: ModuleJobs = {
  jobs: [registerJob(identityCheckJob, IdentityCheckHandler)],
  schedules: [],
};

export default supplierJobs;
