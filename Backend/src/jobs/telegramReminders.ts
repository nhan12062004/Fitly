import cron from 'node-cron';
import { isJobsEnabled } from '../config/runtime';
import { logOperational } from '../lib/operationalLogger';

type ScheduledTask = { stop: () => void };
type ReminderActions = {
  acquireDispatchLock: (type: 'water' | 'sleep', slotLabel: string) => Promise<{ acquired: boolean }>;
  sendWater: (slotIndex: number) => Promise<unknown>;
  sendSleep: () => Promise<unknown>;
};
type Scheduler = { schedule: (expression: string, callback: () => void | Promise<void>, options: { timezone: string }) => ScheduledTask };

const WATER_SCHEDULES = ['0 9 * * *', '0 11 * * *', '0 14 * * *', '0 16 * * *', '0 20 * * *', '0 22 * * *'];
const SLEEP_SCHEDULE = '30 9 * * *';
const TIMEZONE = 'Asia/Ho_Chi_Minh';
let handles: ScheduledTask[] = [];

const runReminder = async (jobName: string, action: () => Promise<void>): Promise<void> => {
  const correlationId = crypto.randomUUID();
  logOperational({ level: 'info', event: 'job_started', jobName, correlationId });
  try {
    await action();
    logOperational({ level: 'info', event: 'job_completed', jobName, correlationId, status: 'ok' });
  } catch (error) {
    logOperational({ level: 'error', event: 'job_failed', jobName, correlationId, status: 'failed', errorCode: 'TELEGRAM_REMINDER_FAILED', message: error });
  }
};

export const startTelegramReminderJobs = (actions: ReminderActions, scheduler: Scheduler = cron): void => {
  if (!isJobsEnabled() || process.env.TELEGRAM_ENABLE_REMINDERS === 'false') {
    logOperational({ level: 'info', event: 'jobs_disabled', jobName: 'telegram_reminders', status: 'disabled' });
    return;
  }
  if (handles.length > 0) return;

  WATER_SCHEDULES.forEach((schedule, index) => {
    handles.push(scheduler.schedule(schedule, () => runReminder('telegram_water_reminder', async () => {
      const lock = await actions.acquireDispatchLock('water', schedule);
      if (lock.acquired) await actions.sendWater(index);
    }), { timezone: TIMEZONE }));
  });
  handles.push(scheduler.schedule(SLEEP_SCHEDULE, () => runReminder('telegram_sleep_reminder', async () => {
    const lock = await actions.acquireDispatchLock('sleep', '09:30');
    if (lock.acquired) await actions.sendSleep();
  }), { timezone: TIMEZONE }));
};

export const stopTelegramReminderJobs = (): void => {
  for (const handle of handles) handle.stop();
  handles = [];
};
