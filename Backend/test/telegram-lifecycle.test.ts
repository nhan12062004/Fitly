import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const instances: Array<{ stopPolling: ReturnType<typeof vi.fn> }> = [];
  const TelegramBot = vi.fn(function () {
    const instance = {
      on: vi.fn(),
      onText: vi.fn(),
      setMyCommands: vi.fn().mockResolvedValue(undefined),
      deleteWebHook: vi.fn().mockResolvedValue(undefined),
      startPolling: vi.fn().mockResolvedValue(undefined),
      stopPolling: vi.fn().mockResolvedValue(undefined),
    };
    instances.push(instance);
    return instance;
  });
  return { TelegramBot, instances };
});

vi.mock('node-telegram-bot-api', () => ({ default: mocks.TelegramBot }));

describe('Telegram lifecycle', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.instances.splice(0);
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_TELEGRAM;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not start Telegram by default in tests', async () => {
    const { startTelegramBot } = await import('../src/TelegramBot');
    expect(startTelegramBot()).toBeNull();
    expect(mocks.TelegramBot).not.toHaveBeenCalled();
  });

  it('creates one bot per process and closes polling during shutdown', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_TELEGRAM = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ENABLE_REMINDERS = 'false';
    process.env.TELEGRAM_ENABLE_POLLING = 'false';
    const { startTelegramBot, stopTelegramBot } = await import('../src/TelegramBot');

    const first = startTelegramBot();
    const second = startTelegramBot();
    expect(first).toBe(second);
    expect(mocks.TelegramBot).toHaveBeenCalledTimes(1);

    await stopTelegramBot();
    expect(mocks.instances[0].stopPolling).toHaveBeenCalledTimes(1);
  });
});
