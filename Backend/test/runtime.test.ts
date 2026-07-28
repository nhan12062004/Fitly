import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime shutdown lifecycle', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('stops jobs and Telegram once when a shutdown signal is repeated', async () => {
    const handlers = new Map<string, () => void>();
    vi.spyOn(process, 'once').mockImplementation(((signal: string, handler: () => void) => {
      handlers.set(signal, handler);
      return process;
    }) as typeof process.once);
    const close = vi.fn((callback: (error?: Error) => void) => callback());
    const stopJobs = vi.fn();
    const stopTelegram = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn((() => undefined) as never);
    const { startRuntime } = await import('../src/runtime');

    startRuntime({
      listen: (_port, callback) => {
        callback();
        return { close } as unknown as Server;
      },
      startJobs: vi.fn(),
      stopJobs,
      startTelegram: vi.fn(),
      stopTelegram,
      exit,
    });
    handlers.get('SIGTERM')?.();
    handlers.get('SIGTERM')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(stopJobs).toHaveBeenCalledTimes(1);
    expect(stopTelegram).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
