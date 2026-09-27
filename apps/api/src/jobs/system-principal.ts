import type { SystemPrincipal } from '../principals/principal';
import type { JobEnvelope } from './job.types';

/**
 * The principal a job runs as (KTD15, KTD16): `system`, acting under the job, which names what
 * enqueued it. A job a command enqueued carries that command's correlation id, so its audit
 * entries join the command's; a scheduled run correlates on its own job id.
 */
export function systemPrincipalFor(envelope: JobEnvelope, jobId: string): SystemPrincipal {
  return {
    type: 'system',
    tenantId: envelope.tenantId,
    actedUnder: { grant: 'job', jobId, cause: envelope.cause, source: envelope.source },
    adapter: 'jobs',
    correlationId: envelope.cause === 'command' ? envelope.correlationId : jobId,
  };
}
