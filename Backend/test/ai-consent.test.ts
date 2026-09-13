import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock('../src/config/Supabase', () => ({ adminSupabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.single }) }) }) } }));
import { requireAiDataConsent, hasAiDataConsent } from '../src/services/ai/aiConsentService';
import { AppError } from '../src/http/errors';
import type { Request, Response, NextFunction } from 'express';
const app = express();
app.use((req, _res, next) => { req.auth = { user: { id: 'test-user' } } as Request['auth']; next(); });
const provider = vi.fn((_req: Request, res: Response) => res.json({ success: true }));
app.post('/ai', requireAiDataConsent, provider);
app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || 500).json({ code: error.code }));
beforeEach(() => vi.clearAllMocks());
it('blocks missing or revoked permission before invoking AI', async () => {
  mocks.single.mockResolvedValue({ data: null, error: null });
  expect((await request(app).post('/ai')).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
  expect(await hasAiDataConsent('test-user')).toBe(false);
});
it('permits the current accepted disclosure version', async () => {
  mocks.single.mockResolvedValue({ data: { version: 1 }, error: null });
  expect((await request(app).post('/ai')).status).toBe(200);
  expect(provider).toHaveBeenCalledOnce();
});
it('fails closed when the consent database is unavailable', async () => {
  mocks.single.mockResolvedValue({ data: null, error: new Error('database unavailable') });
  expect((await request(app).post('/ai')).status).toBe(503);
  expect(provider).not.toHaveBeenCalled();
});
