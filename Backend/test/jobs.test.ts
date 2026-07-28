import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runPremiumMondayAutoPlanner: vi.fn() }));

vi.mock('../src/app', () => ({ runPremiumMondayAutoPlanner: mocks.runPremiumMondayAutoPlanner }));

describe('job runner lifecycle', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_JOBS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps jobs disabled by default in tests', async () => {
    const schedule = vi.fn();
    const { startJobs } = await import('../src/jobs');
    startJobs({ schedule });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not register the same job twice and stops every handle', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_JOBS = 'true';
    const stop = vi.fn();
    const schedule = vi.fn(() => ({ stop }));
    const { startJobs, stopJobs } = await import('../src/jobs');

    startJobs({ schedule });
    startJobs({ schedule });
    expect(schedule).toHaveBeenCalledTimes(1);

    stopJobs();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('catches rejected job work and sanitizes operational logs', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_JOBS = 'true';
    const callbacks: Array<() => Promise<void>> = [];
    const schedule = vi.fn((_expression, callback) => {
      callbacks.push(callback);
      return { stop: vi.fn() };
    });
    mocks.runPremiumMondayAutoPlanner.mockRejectedValueOnce(new Error('token=super-secret provider failure'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { startJobs, stopJobs } = await import('../src/jobs');

    try {
      startJobs({ schedule });
      await callbacks[0]();
      expect(errorSpy).toHaveBeenCalled();
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('super-secret');
    } finally {
      stopJobs();
      errorSpy.mockRestore();
    }
  });
});
