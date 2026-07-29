import express from 'express';
import request from 'supertest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createRequireAuth, requireAdmin } from '../src/auth/middleware';

const makeUser = (options: { admin?: boolean; userMetadataRole?: string } = {}): User => ({
  id: 'user-123',
  app_metadata: options.admin ? { role: 'admin' } : {},
  user_metadata: options.userMetadataRole ? { role: options.userMetadataRole } : {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
}) as User;

const makeClient = (getUser: ReturnType<typeof vi.fn>): SupabaseClient => ({
  auth: { getUser },
}) as unknown as SupabaseClient;

const createTestApp = (middleware: ReturnType<typeof createRequireAuth>, adminOnly = false) => {
  const app = express();
  app.use(middleware);
  if (adminOnly) app.use(requireAdmin);
  app.get('/protected', (req, res) => {
    res.json({
      userId: req.auth?.user.id,
      accessToken: req.auth?.accessToken,
      hasUserClient: Boolean(req.supabase),
    });
  });
  return app;
};

const createMiddleware = (getUser: ReturnType<typeof vi.fn>, createUserScopedClient = vi.fn(() => makeClient(vi.fn()))) => ({
  middleware: createRequireAuth({
    createUserScopedClient,
    hasUserScopedConfiguration: () => true,
    verifyAccessToken: getUser,
  }),
  createUserScopedClient,
});

describe('authentication middleware', () => {
  it.each([undefined, 'Token valid-token', 'Basic credentials'])('returns 401 for a missing or malformed Authorization header', async (authorization) => {
    const getUser = vi.fn();
    const { middleware } = createMiddleware(getUser);
    const response = await request(createTestApp(middleware))
      .get('/protected')
      .set(authorization ? { Authorization: authorization } : {});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('returns a generic 401 for an invalid token without leaking provider details', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error('provider token validation failed: private diagnostic'),
    });
    const { middleware } = createMiddleware(getUser);

    const response = await request(createTestApp(middleware))
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
    expect(JSON.stringify(response.body)).not.toContain('provider');
  });

  it('attaches the verified user, original JWT, and user-scoped client to the request', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: makeUser() }, error: null });
    const { middleware, createUserScopedClient } = createMiddleware(getUser);

    const response = await request(createTestApp(middleware))
      .get('/protected')
      .set('Authorization', 'Bearer verified-jwt');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-123', accessToken: 'verified-jwt', hasUserClient: true });
    expect(createUserScopedClient).toHaveBeenCalledWith('verified-jwt');
    expect(getUser).toHaveBeenCalledWith('verified-jwt');
  });

  it('verifies the token before constructing a user-scoped client', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: makeUser() }, error: null });
    const createUserScopedClient = vi.fn(() => makeClient(getUser));
    const { middleware } = createMiddleware(getUser, createUserScopedClient);

    const response = await request(createTestApp(middleware))
      .get('/protected')
      .set('Authorization', 'Bearer user-jwt');

    expect(response.status).toBe(200);
    expect(createUserScopedClient).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for a verified non-admin user', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: makeUser() }, error: null });
    const { middleware } = createMiddleware(getUser);

    const response = await request(createTestApp(middleware, true))
      .get('/protected')
      .set('Authorization', 'Bearer user-jwt');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });

  it('permits a verified admin with app_metadata role', async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: makeUser({ admin: true }) }, error: null });
    const { middleware } = createMiddleware(getUser);

    const response = await request(createTestApp(middleware, true))
      .get('/protected')
      .set('Authorization', 'Bearer admin-jwt');

    expect(response.status).toBe(200);
  });

  it('does not treat user_metadata as an admin authority', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: makeUser({ userMetadataRole: 'admin' }) },
      error: null,
    });
    const { middleware } = createMiddleware(getUser);

    const response = await request(createTestApp(middleware, true))
      .get('/protected')
      .set('Authorization', 'Bearer user-controlled-metadata-jwt');

    expect(response.status).toBe(403);
  });
});
