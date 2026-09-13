import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sync: vi.fn(), from: vi.fn(), role: 'user' }));
const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
vi.mock('../src/services/storeSubscriptionService', () => ({ syncStoreSubscription: mocks.sync }));
vi.mock('../src/config/Supabase', () => ({ adminSupabase: { from: mocks.from } }));
vi.mock('../src/auth/middleware', () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization !== 'Bearer user-token') return res.sendStatus(401);
    req.auth = { user: { id: '11111111-1111-4111-8111-111111111111' }, accessToken: 'user-token' } as Request['auth'];
    next();
  },
}));
import { storeRouter } from '../src/modules/account/storeRouter';
import { feedbackRouter } from '../src/modules/account/feedbackRouter';
import { AppError } from '../src/http/errors';

const app = express();
app.use(express.json(), storeRouter, feedbackRouter);
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error instanceof AppError ? error.status : 500).json({ error: error instanceof AppError ? error.code : 'INTERNAL_ERROR' });
});
const feedbackInsert = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REVENUECAT_WEBHOOK_AUTHORIZATION', 'Bearer webhook-secret');
  mocks.role = 'user';
  mocks.sync.mockResolvedValue({ tier: 'pro' });
  feedbackInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'report-id' }, error: null }) }) });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: mocks.role }, error: null }) }) }) };
    if (table === 'app_feedback') return { insert: feedbackInsert, select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('store verification boundary', () => {
  it('requires login and rejects client supplied tier or another account', async () => {
    expect((await request(app).post('/subscriptions/sync').send({})).status).toBe(401);
    expect((await request(app).post('/subscriptions/sync').set('Authorization', 'Bearer user-token').send({ tier: 'pro', userId: otherId })).status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('verifies only the authenticated account', async () => {
    const result = await request(app).post('/subscriptions/sync').set('Authorization', 'Bearer user-token').send({});
    expect(result.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(userId);
  });
  it('rejects forged webhooks before any verification', async () => {
    const result = await request(app).post('/subscriptions/webhook').set('Authorization', 'Bearer wrong-secret').send({ event: { type: 'INITIAL_PURCHASE', app_user_id: userId } });
    expect(result.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('rechecks both sides of transfers once and ignores anonymous IDs', async () => {
    const result = await request(app).post('/subscriptions/webhook').set('Authorization', 'Bearer webhook-secret').send({ event: {
      type: 'TRANSFER', app_user_id: userId, transferred_from: [userId, '$RCAnonymousID:example'], transferred_to: [otherId],
      entitlement_ids: ['forged-pro'],
    } });
    expect(result.status).toBe(200);
    expect(mocks.sync.mock.calls).toEqual([[userId], [otherId]]);
  });
  it('asks the provider to retry when verification fails', async () => {
    mocks.sync.mockRejectedValue(new Error('private provider detail'));
    const result = await request(app).post('/subscriptions/webhook').set('Authorization', 'Bearer webhook-secret').send({ event: { type: 'RENEWAL', app_user_id: userId } });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain('private provider detail');
  });
});

describe('feedback access boundary', () => {
  it('rejects anonymous reports and user-supplied ownership', async () => {
    expect((await request(app).post('/feedback').send({ category: 'support', message: 'Help please' })).status).toBe(401);
    expect((await request(app).post('/feedback').set('Authorization', 'Bearer user-token').send({ category: 'support', message: 'Help please', user_id: otherId })).status).toBe(400);
    expect(feedbackInsert).not.toHaveBeenCalled();
  });
  it('saves an AI report with the authenticated owner', async () => {
    const result = await request(app).post('/feedback').set('Authorization', 'Bearer user-token').send({ category: 'ai_report', message: 'Unsafe suggestion', context: 'Reported answer' });
    expect(result.status).toBe(201);
    expect(result.body.id).toBe('report-id');
    expect(feedbackInsert).toHaveBeenCalledWith({ user_id: userId, category: 'ai_report', message: 'Unsafe suggestion', context: 'Reported answer' });
  });
  it('prevents ordinary users from reading or changing reports', async () => {
    expect((await request(app).get('/admin/feedback').set('Authorization', 'Bearer user-token')).status).toBe(403);
    expect((await request(app).patch(`/admin/feedback/${otherId}`).set('Authorization', 'Bearer user-token').send({ status: 'resolved' })).status).toBe(403);
    expect((await request(app).post(`/admin/feedback/${otherId}/remove-content`).set('Authorization', 'Bearer user-token').send({})).status).toBe(403);
    expect(mocks.from.mock.calls.every(([table]) => table === 'profiles')).toBe(true);
  });
  it('allows the trusted database admin role to read reports', async () => {
    mocks.role = 'admin';
    const result = await request(app).get('/admin/feedback').set('Authorization', 'Bearer user-token');
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual([]);
  });
});
