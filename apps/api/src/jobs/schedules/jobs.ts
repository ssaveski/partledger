import { EnrollTenantHandler, enrollTenantJob } from '../tenant-enrollment.job';
import { registerJob, type ModuleJobs } from '../job.types';

/** The job runner's own jobs. */
const runnerJobs: ModuleJobs = {
  jobs: [registerJob(enrollTenantJob, EnrollTenantHandler)],
  schedules: [],
};

export default runnerJobs;
