import { VerifyChainHandler, verifyChainJob } from '../../audit/chain-verification.job';
import { defineSchedule, registerJob, type ModuleJobs } from '../job.types';

/** The audit module's jobs: every tenant's chain is verified nightly (R27). */
const auditJobs: ModuleJobs = {
  jobs: [registerJob(verifyChainJob, VerifyChainHandler)],
  schedules: [
    defineSchedule({ name: 'audit.nightlyChainVerification', job: verifyChainJob, cron: '17 3 * * *', payload: {} }),
  ],
};

export default auditJobs;
