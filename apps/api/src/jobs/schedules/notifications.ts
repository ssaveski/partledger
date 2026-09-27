import {
  DeliverOperationalAlertsHandler,
  deliverOperationalAlertsJob,
} from '../../notifications/deliver-operational-alerts.job';
import { SendNotificationHandler, sendNotificationJob } from '../../notifications/send-notification.job';
import { defineSchedule, registerJob, type ModuleJobs } from '../job.types';

/** The notifications module's jobs: emails are sent as they are recorded, and new operational alerts delivered every five minutes. */
const notificationJobs: ModuleJobs = {
  jobs: [
    registerJob(sendNotificationJob, SendNotificationHandler),
    registerJob(deliverOperationalAlertsJob, DeliverOperationalAlertsHandler),
  ],
  schedules: [
    defineSchedule({
      name: 'notifications.operationalAlertDelivery',
      job: deliverOperationalAlertsJob,
      cron: '*/5 * * * *',
      payload: {},
    }),
  ],
};

export default notificationJobs;
