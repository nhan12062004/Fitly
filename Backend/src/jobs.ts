import cron from 'node-cron';
import { isJobsEnabled } from './config/runtime';
import { runPremiumMondayAutoPlanner } from './app';
import { runBackgroundJob, runPrivacyMaintenance, privacyRunKey } from './services/backgroundJobService';
import { logOperational } from './lib/operationalLogger';

const PREMIUM_AUTO_PLAN_JOB = 'premium_auto_planner';
const PREMIUM_AUTO_PLAN_CRON = process.env.PREMIUM_AUTO_PLAN_CRON || '5 0 * * *';
const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

type ScheduledTask = { stop: () => void };
type Scheduler = { schedule: (expression: string, callback: () => void | Promise<void>, options: { timezone: string }) => ScheduledTask };

let handles: ScheduledTask[] = [];

const runPremiumAutoPlannerJob = async (): Promise<void> => {
  const correlationId = crypto.randomUUID();
  logOperational({ level: 'info', event: 'job_started', jobName: PREMIUM_AUTO_PLAN_JOB, correlationId });
  try {
    if (process.env.AI_ENABLED === 'false') return;
    let result = { generated: 0, failed: 0 };
    await runBackgroundJob(PREMIUM_AUTO_PLAN_JOB, async () => {
      result = await runPremiumMondayAutoPlanner();
      if (result.failed) throw new Error('Premium planner had failed items');
    });
    logOperational({
      level: 'info',
      event: 'job_completed',
      jobName: PREMIUM_AUTO_PLAN_JOB,
      correlationId,
      status: 'ok',
      message: `generated=${result.generated}; failed=${result.failed}`,
    });
  } catch (error) {
    logOperational({
      level: 'error',
      event: 'job_failed',
      jobName: PREMIUM_AUTO_PLAN_JOB,
      correlationId,
      status: 'failed',
      errorCode: 'JOB_EXECUTION_FAILED',
      message: error,
    });
  }
};

export const startJobs = (scheduler: Scheduler = cron): void => {
  if (!isJobsEnabled()) {
    logOperational({ level: 'info', event: 'jobs_disabled', status: 'disabled', message: 'ENABLE_JOBS is not enabled' });
    return;
  }
  if (handles.length > 0) return;

  handles.push(scheduler.schedule('35 * * * *', async () => {
    try { await runBackgroundJob('privacy_maintenance', runPrivacyMaintenance, privacyRunKey()); }
    catch (error) { logOperational({ level: 'error', event: 'privacy_maintenance_failed', errorCode: 'JOB_FAILED', message: error }); }
  }, { timezone: VIETNAM_TIMEZONE }));
  handles.push(scheduler.schedule(PREMIUM_AUTO_PLAN_CRON, runPremiumAutoPlannerJob, { timezone: VIETNAM_TIMEZONE }));
  logOperational({ level: 'info', event: 'job_registered', jobName: PREMIUM_AUTO_PLAN_JOB, status: 'scheduled' });
};

export const stopJobs = (): void => {
  for (const handle of handles) handle.stop();
  handles = [];
};

export const __resetJobsForTests = (): void => stopJobs();
