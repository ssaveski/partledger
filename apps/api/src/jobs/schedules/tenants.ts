import { LeaveOrganizationHandler, leaveOrganizationJob } from '../../tenants/leave-organization.job';
import { registerJob, type ModuleJobs } from '../job.types';

/** The tenants module's jobs: a removed member leaves the identity provider's organization. */
const tenantJobs: ModuleJobs = {
  jobs: [registerJob(leaveOrganizationJob, LeaveOrganizationHandler)],
  schedules: [],
};

export default tenantJobs;
