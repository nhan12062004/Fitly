import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAiCoachHandlers } from '../src/modules/ai-coach/aiCoachHandlers';
import { effectiveMembershipTier } from '../src/services/storeSubscriptionService';
import { ExternalProviderError } from '../src/http/errors';

function fixture(expiresAt = '2099-01-01T00:00:00Z', userId: string | null = 'user-1') {
  const profile = { id: 'user-1', membership_tier: 'pro', membership_expires_at: expiresAt, created_at: '2020-01-01T00:00:00Z' };
  let columns: string[] = [];
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: Object.fromEntries(columns.map((key) => [key, profile[key as keyof typeof profile]])), error: null }) }));
  const from = vi.fn(() => ({ select: (value: string) => { columns = value.split(',').map((key) => key.trim()); return { eq }; } }));
  const getAccess = vi.fn(async (selectedProfile: typeof profile) => {
    const membershipTier = effectiveMembershipTier(selectedProfile);
    return {
      membershipTier,
      trialExpired: membershipTier === 'free',
      canChat: membershipTier !== 'free',
      canGenerate: false,
      canUseWorkoutAdjustment: true,
      canUseMealAdjustment: false,
      quotaWindow: { startsAt: '2026-10-01T00:00:00Z', endsAt: null },
    };
  });
  const snapshot = { limits: { chatMessages: 800, planGenerations: 12, workoutAdjustments: 100, mealAdjustments: 100 }, usage: { chatMessages: 36, planGenerations: 12, workoutAdjustments: 2, mealAdjustments: 100 }, remaining: { chatMessages: 764, planGenerations: 0, workoutAdjustments: 98, mealAdjustments: 0 } };
  const app = express();
  const handlers = createAiCoachHandlers({ supabase: { from }, getAuthUserId: async () => userId, getAiCoachAccessState: getAccess, buildAiQuotaSnapshot: () => snapshot, ExternalProviderError });
  app.get('/api/ai/quota', handlers.getQuota);
  return { app, from, eq, getAccess, snapshot };
}

describe('AI plan quota response', () => {
  it('returns the authoritative counters, period and separate feature permissions', async () => {
    const { app, eq, snapshot } = fixture();
    const response = await request(app).get('/api/ai/quota');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ membershipTier: 'pro', canChat: true, canGenerate: false, canUseWorkoutAdjustment: true, canUseMealAdjustment: false, quotaWindow: { startsAt: '2026-10-01T00:00:00Z', endsAt: null }, aiQuota: snapshot });
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('passes the subscription expiry to access checks so an expired Pro grant does not stay Pro', async () => {
    const { app, getAccess } = fixture('2020-02-01T00:00:00Z');
    const response = await request(app).get('/api/ai/quota');
    expect(getAccess).toHaveBeenCalledWith(expect.objectContaining({ membership_expires_at: '2020-02-01T00:00:00Z' }), 'user-1');
    expect(response.body).toMatchObject({ membershipTier: 'free', trialExpired: true, canChat: false });
  });

  it('does not read another account or expose quotas without authentication', async () => {
    const { app, from } = fixture(undefined, null);
    expect((await request(app).get('/api/ai/quota')).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
});
