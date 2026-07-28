import { Server } from 'node:http';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const select = vi.fn(() => ({ limit }));

  return {
    from: vi.fn(() => ({ select })),
    select,
    limit,
    cronSchedule: vi.fn(),
    initTelegramBot: vi.fn(),
  };
});

vi.mock('../src/config/Supabase', () => ({
  supabase: {
    from: mocks.from,
    auth: {
      getUser: vi.fn(),
      admin: { getUserById: vi.fn() },
    },
    storage: { from: vi.fn() },
  },
}));

vi.mock('node-cron', () => ({
  default: { schedule: mocks.cronSchedule },
}));

vi.mock('../src/TelegramBot', () => ({
  initTelegramBot: mocks.initTelegramBot,
  stopTelegramBot: vi.fn(),
}));

describe('Express application bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue({ error: null });
    process.env.NODE_ENV = 'test';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    process.env.TELEGRAM_BOT_ENABLED = 'false';
  });

  it('imports the Express app without opening an HTTP port or starting runtime services', async () => {
    const listenSpy = vi.spyOn(Server.prototype, 'listen');

    await import('../src/app');

    expect(listenSpy).not.toHaveBeenCalled();
    expect(mocks.cronSchedule).not.toHaveBeenCalled();
    expect(mocks.initTelegramBot).not.toHaveBeenCalled();
    listenSpy.mockRestore();
  });

  it('returns a valid liveness response without querying Supabase', async () => {
    const { app } = await import('../src/app');

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'fitly-api' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns ready when the required environment and Supabase query are available', async () => {
    const { app } = await import('../src/app');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: { environment: 'ok', database: 'ok' },
    });
    expect(mocks.from).toHaveBeenCalledWith('profiles');
    expect(mocks.select).toHaveBeenCalledWith('id', { head: true });
    expect(mocks.limit).toHaveBeenCalledWith(1);
  });

  it('returns not ready when the lightweight Supabase query fails', async () => {
    mocks.limit.mockResolvedValueOnce({ error: new Error('database unavailable') });
    const { app } = await import('../src/app');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { environment: 'ok', database: 'unavailable' },
    });
  });
});
