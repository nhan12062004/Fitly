import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Telegram reminder jobs', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_JOBS = 'true';
    delete process.env.TELEGRAM_ENABLE_REMINDERS;
  });

  afterEach(() => { process.env = { ...originalEnv }; });

  it('registers seven independent schedules once and clears them on stop', async () => {
    const stop = vi.fn();
    const schedule = vi.fn(() => ({ stop }));
    const actions = {
      acquireDispatchLock: vi.fn().mockResolvedValue({ acquired: true }),
      sendWater: vi.fn().mockResolvedValue(undefined),
      sendSleep: vi.fn().mockResolvedValue(undefined),
    };
    const { startTelegramReminderJobs, stopTelegramReminderJobs } = await import('../src/jobs/telegramReminders');

    startTelegramReminderJobs(actions, { schedule });
    startTelegramReminderJobs(actions, { schedule });
    expect(schedule).toHaveBeenCalledTimes(7);
    stopTelegramReminderJobs();
    expect(stop).toHaveBeenCalledTimes(7);
  });
});
