import { ReleaseQuarantineHandler, releaseQuarantineJob } from '../../uploads/release-quarantine.job';
import {
  RescanPendingUploadsHandler,
  rescanPendingUploadsJob,
  ScanUploadHandler,
  scanUploadJob,
} from '../../uploads/scan.job';
import { defineSchedule, registerJob, type ModuleJobs } from '../job.types';

/** The uploads module's jobs: each upload is scanned as it arrives, and uploads left pending are swept every ten minutes. */
const uploadJobs: ModuleJobs = {
  jobs: [
    registerJob(scanUploadJob, ScanUploadHandler),
    registerJob(rescanPendingUploadsJob, RescanPendingUploadsHandler),
    registerJob(releaseQuarantineJob, ReleaseQuarantineHandler),
  ],
  schedules: [
    defineSchedule({
      name: 'uploads.pendingScanSweep',
      job: rescanPendingUploadsJob,
      cron: '*/10 * * * *',
      payload: {},
    }),
  ],
};

export default uploadJobs;
