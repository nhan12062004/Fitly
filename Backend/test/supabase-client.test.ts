import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
  dotenvConfig: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('dotenv', () => ({ default: { config: mocks.dotenvConfig } }));

const originalEnvironment = {
  url: process.env.SUPABASE_URL,
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anon: process.env.SUPABASE_ANON_KEY,
  publishable: process.env.SUPABASE_PUBLISHABLE_KEY,
};

const restoreEnvironmentValue = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  restoreEnvironmentValue('SUPABASE_URL', originalEnvironment.url);
  restoreEnvironmentValue('SUPABASE_SERVICE_ROLE_KEY', originalEnvironment.serviceRole);
  restoreEnvironmentValue('SUPABASE_ANON_KEY', originalEnvironment.anon);
  restoreEnvironmentValue('SUPABASE_PUBLISHABLE_KEY', originalEnvironment.publishable);
});

describe('Supabase client boundaries', () => {
  it('creates a request-scoped client with the publishable key, JWT, and no persisted session', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    delete process.env.SUPABASE_PUBLISHABLE_KEY;

    const { createUserScopedSupabaseClient } = await import('../src/config/Supabase');
    createUserScopedSupabaseClient('request-jwt');

    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        }),
        accessToken: expect.any(Function),
      }),
    );

    const options = mocks.createClient.mock.calls.at(-1)?.[2] as { accessToken: () => Promise<string> };
    await expect(options.accessToken()).resolves.toBe('request-jwt');
    expect(mocks.createClient.mock.calls.at(-1)?.[1]).not.toBe('service-role-key');
  });
});
