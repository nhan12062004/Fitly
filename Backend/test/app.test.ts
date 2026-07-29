import { Server } from 'node:http';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const limit = vi.fn();
  const select = vi.fn(() => ({ limit }));
  const userMaybeSingle = vi.fn();
  const userEq = vi.fn(() => ({ maybeSingle: userMaybeSingle }));
  const userSelect = vi.fn(() => ({ eq: userEq }));
  const userUpdateMaybeSingle = vi.fn();
  const userUpdateSelect = vi.fn(() => ({ maybeSingle: userUpdateMaybeSingle }));
  const userUpdateEq = vi.fn(() => ({ error: null, select: userUpdateSelect }));
  const userUpdate = vi.fn(() => ({ eq: userUpdateEq }));
  const userStorageUpload = vi.fn();
  const userStorageList = vi.fn();
  const userStorageRemove = vi.fn();
  const userStorageGetPublicUrl = vi.fn();
  const userStorageFrom = vi.fn(() => ({
    upload: userStorageUpload,
    list: userStorageList,
    remove: userStorageRemove,
    getPublicUrl: userStorageGetPublicUrl,
  }));
  const userFrom = vi.fn(() => ({ select: userSelect, update: userUpdate }));
  const userGetUser = vi.fn();
  const adminGetUser = vi.fn();
  const adminDeleteUser = vi.fn();
  const adminStorageList = vi.fn();
  const adminStorageRemove = vi.fn();
  const adminStorageFrom = vi.fn(() => ({ list: adminStorageList, remove: adminStorageRemove }));
  const createUserScopedSupabaseClient = vi.fn(() => ({
    auth: { getUser: userGetUser },
    from: userFrom,
    storage: { from: userStorageFrom },
  }));

  return {
    from: vi.fn(() => ({ select })),
    select,
    limit,
    cronSchedule: vi.fn(),
    initTelegramBot: vi.fn(),
    userMaybeSingle,
    userEq,
    userSelect,
    userUpdateMaybeSingle,
    userUpdateSelect,
    userUpdateEq,
    userUpdate,
    userFrom,
    userStorageUpload,
    userStorageList,
    userStorageRemove,
    userStorageGetPublicUrl,
    userStorageFrom,
    userGetUser,
    adminGetUser,
    adminDeleteUser,
    adminStorageList,
    adminStorageRemove,
    adminStorageFrom,
    createUserScopedSupabaseClient,
  };
});

vi.mock('../src/config/Supabase', () => {
  const adminSupabase = {
    from: mocks.from,
    auth: {
      getUser: mocks.adminGetUser,
      admin: { getUserById: vi.fn(), deleteUser: mocks.adminDeleteUser },
    },
    storage: { from: mocks.adminStorageFrom },
  };

  return {
    adminSupabase,
    supabase: adminSupabase,
    createUserScopedSupabaseClient: mocks.createUserScopedSupabaseClient,
    hasUserScopedSupabaseConfiguration: () => true,
  };
});

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
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.TELEGRAM_BOT_ENABLED = 'false';
    delete process.env.READY_TIMEOUT_MS;
    mocks.userGetUser.mockResolvedValue({
      data: { user: { id: 'authenticated-user', app_metadata: {}, user_metadata: {} } },
      error: null,
    });
    mocks.userMaybeSingle.mockResolvedValue({ data: { id: 'authenticated-user' }, error: null });
    mocks.userUpdateMaybeSingle.mockResolvedValue({ data: { id: 'authenticated-user' }, error: null });
    mocks.userStorageUpload.mockResolvedValue({ error: null });
    mocks.userStorageList.mockResolvedValue({ data: [{ name: 'avatar.png' }], error: null });
    mocks.userStorageRemove.mockResolvedValue({ error: null });
    mocks.userStorageGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/authenticated-user/avatar.png' } });
    mocks.adminStorageList.mockResolvedValue({ data: [{ name: 'avatar.png' }], error: null });
    mocks.adminStorageRemove.mockResolvedValue({ error: null });
    mocks.adminDeleteUser.mockResolvedValue({ error: null });
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

  it('returns not ready without querying Supabase when required environment is missing', async () => {
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_PUBLISHABLE_KEY = '';
    const { app } = await import('../src/app');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { environment: 'missing_required_variables', database: 'skipped' },
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('creates and returns a request ID when the client does not provide one', async () => {
    const { app } = await import('../src/app');
    const response = await request(app).get('/health');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('preserves a valid client request ID and replaces unsafe values', async () => {
    const { app } = await import('../src/app');
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const accepted = await request(app).get('/health').set('x-request-id', requestId);
    const replaced = await request(app).get('/health').set('x-request-id', 'unsafe-request-id');
    expect(accepted.headers['x-request-id']).toBe(requestId);
    expect(replaced.headers['x-request-id']).not.toBe('unsafe-request-id');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('returns not ready when the lightweight Supabase query exceeds the configured timeout', async () => {
    process.env.READY_TIMEOUT_MS = '10';
    mocks.limit.mockImplementationOnce(() => new Promise(() => undefined));
    const { app } = await import('../src/app');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { environment: 'ok', database: 'unavailable' },
    });
  });

  it('does not emit an unhandled rejection when a timed-out readiness query rejects later', async () => {
    process.env.READY_TIMEOUT_MS = '10';
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    mocks.limit.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('late database failure')), 20);
    }));

    try {
      const { app } = await import('../src/app');
      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('uses the request-scoped client for the self-service Telegram link endpoint', async () => {
    const { app } = await import('../src/app');

    const response = await request(app)
      .post('/api/telegram/link-token')
      .set('Authorization', 'Bearer user-jwt');

    expect(response.status).toBe(200);
    expect(mocks.createUserScopedSupabaseClient).toHaveBeenCalledWith('user-jwt');
    expect(mocks.userFrom).toHaveBeenCalledWith('profiles');
    expect(mocks.userEq).toHaveBeenCalledWith('id', 'authenticated-user');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('requires a token to read the authenticated user profile', async () => {
    const { app } = await import('../src/app');

    const response = await request(app).get('/api/profile');

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(mocks.userFrom).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('reads only the authenticated user profile with the request-scoped client', async () => {
    const { app } = await import('../src/app');

    const response = await request(app)
      .get('/api/profile?user_id=another-user')
      .set('Authorization', 'Bearer user-jwt')
      .send({ user_id: 'another-user' });

    expect(response.status).toBe(200);
    expect(mocks.createUserScopedSupabaseClient).toHaveBeenCalledWith('user-jwt');
    expect(mocks.userFrom).toHaveBeenCalledWith('profiles');
    expect(mocks.userEq).toHaveBeenCalledWith('id', 'authenticated-user');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects attacker-controlled ownership fields when updating a profile', async () => {
    const { app } = await import('../src/app');

    const response = await request(app)
      .patch('/api/profile?user_id=another-user')
      .set('Authorization', 'Bearer user-jwt')
      .send({
        id: 'another-user',
        user_id: 'another-user',
        role: 'admin',
        full_name: 'Authenticated User',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('accepts the existing valid profile update payload through the user-scoped client', async () => {
    const { app } = await import('../src/app');
    const response = await request(app)
      .patch('/api/profile')
      .set('Authorization', 'Bearer user-jwt')
      .send({ full_name: 'Authenticated User', gender: 'Nam' });
    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Authenticated User', gender: 'Nam' }));
    expect(mocks.userUpdateEq).toHaveBeenCalledWith('id', 'authenticated-user');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns the standardized validation error with its request ID', async () => {
    const { app } = await import('../src/app');
    const requestId = '123e4567-e89b-42d3-a456-426614174001';
    const response = await request(app)
      .patch('/api/profile')
      .set('Authorization', 'Bearer user-jwt')
      .set('x-request-id', requestId)
      .send({ role: 'admin' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', requestId } });
  });

  it('validates account, workout, and AI inputs before invoking providers', async () => {
    const { app } = await import('../src/app');
    const [account, workout, ai] = await Promise.all([
      request(app).delete('/api/account').send({ confirmation: 'nope' }),
      request(app).post('/api/workout/daily-exercises/from-plan').send({ logDate: 'not-a-date' }),
      request(app).post('/api/ai/chat').send({ message: '' }),
    ]);

    for (const response of [account, workout, ai]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('builds avatar paths from the authenticated user and never accepts a client path', async () => {
    const { app } = await import('../src/app');

    const response = await request(app)
      .put('/api/profile/avatar?path=another-user/avatar.png')
      .set('Authorization', 'Bearer user-jwt')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('png-bytes'));

    expect(response.status).toBe(200);
    expect(mocks.userStorageFrom).toHaveBeenCalledWith('avatars');
    expect(mocks.userStorageUpload).toHaveBeenCalledWith(
      'authenticated-user/avatar.png',
      expect.any(Buffer),
      { upsert: true, contentType: 'image/png' },
    );
    expect(mocks.userUpdateEq).toHaveBeenCalledWith('id', 'authenticated-user');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('removes only avatar objects listed inside the authenticated user folder', async () => {
    mocks.userStorageList.mockResolvedValueOnce({
      data: [{ name: 'avatar.png' }, { name: '../another-user/avatar.png' }],
      error: null,
    });
    const { app } = await import('../src/app');

    const response = await request(app)
      .delete('/api/profile/avatar?path=another-user/avatar.png')
      .set('Authorization', 'Bearer user-jwt')
      .send({ user_id: 'another-user', path: 'another-user/avatar.png' });

    expect(response.status).toBe(204);
    expect(mocks.userStorageList).toHaveBeenCalledWith('authenticated-user', { limit: 100 });
    expect(mocks.userStorageRemove).toHaveBeenCalledWith(['authenticated-user/avatar.png']);
    expect(mocks.userUpdateEq).toHaveBeenCalledWith('id', 'authenticated-user');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('deletes only the authenticated account and its avatar objects after confirmation', async () => {
    mocks.adminGetUser.mockResolvedValueOnce({
      data: { user: { id: 'authenticated-user' } },
      error: null,
    });
    const { app } = await import('../src/app');

    const response = await request(app)
      .delete('/api/account')
      .set('Authorization', 'Bearer user-jwt')
      .send({ confirmation: 'DELETE' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.adminStorageFrom).toHaveBeenCalledWith('avatars');
    expect(mocks.adminStorageList).toHaveBeenCalledWith('authenticated-user', { limit: 100 });
    expect(mocks.adminStorageRemove).toHaveBeenCalledWith(['authenticated-user/avatar.png']);
    expect(mocks.adminDeleteUser).toHaveBeenCalledWith('authenticated-user');
  });

  it('does not expose provider errors, tokens, or storage URLs from self-service routes', async () => {
    mocks.userMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: new Error('https://bucket.example/private user-jwt provider failure'),
    });
    const { app } = await import('../src/app');

    const response = await request(app)
      .get('/api/profile')
      .set('Authorization', 'Bearer user-jwt');

    expect(response.status).toBe(502);
    expect(response.body.error).toMatchObject({ code: 'EXTERNAL_PROVIDER_ERROR', message: 'Internal server error' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('user-jwt');
    expect(JSON.stringify(response.body)).not.toContain('bucket.example');
  });

  it('keeps the admin profile list gated while allowing a trusted app_metadata admin', async () => {
    const { app } = await import('../src/app');

    const regularResponse = await request(app)
      .get('/api/profiles')
      .set('Authorization', 'Bearer user-jwt');
    expect(regularResponse.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();

    mocks.userGetUser.mockResolvedValueOnce({
      data: { user: { id: 'admin-user', app_metadata: { role: 'admin' }, user_metadata: { role: 'user' } } },
      error: null,
    });
    const adminResponse = await request(app)
      .get('/api/profiles')
      .set('Authorization', 'Bearer admin-jwt');

    expect(adminResponse.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith('profiles');
  });

  it('keeps the unrelated membership route behaviour unchanged', async () => {
    const { app } = await import('../src/app');

    const response = await request(app)
      .post('/api/membership/renew')
      .set('Authorization', 'Bearer user-jwt');

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({ code: 'EXTERNAL_PROVIDER_ERROR', message: 'A dependent service is unavailable' });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
