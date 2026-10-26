import type { AiQuotaResponse } from '../../../shared/aiQuota';
import type { StoreMembership } from '../../../shared/membership';
import { createAccountResource } from './accountResource';
import { fetchWithAuth } from './Api';
import { parseAiQuotaResponse } from './aiQuota';
import { supabase } from './Supabase';

export const aiQuotaResource = createAccountResource<AiQuotaResponse>(async (_userId, signal) => {
  const response = await fetchWithAuth('/api/ai/quota', { signal });
  if (!response.ok) throw new Error('Chưa tải được số lượt AI. Vui lòng thử lại.');
  return parseAiQuotaResponse(await response.json());
});

export const accountOverviewResource = createAccountResource(async (userId, signal) => {
  const [profile, lifestyle, store] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).abortSignal(signal).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).abortSignal(signal).maybeSingle(),
    supabase.from('store_entitlements').select('tier, expires_at').eq('user_id', userId).abortSignal(signal).maybeSingle(),
  ]);
  if (profile.error) throw profile.error;
  if (lifestyle.error) throw lifestyle.error;
  return { profile: profile.data, lifestyle: lifestyle.data, store: (store.error ? null : store.data) as StoreMembership | null };
});

export const profileDetailsResource = createAccountResource(async (userId, signal) => {
  const [body, health] = await Promise.all([
    supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).abortSignal(signal).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).abortSignal(signal).maybeSingle(),
  ]);
  if (body.error) throw body.error;
  if (health.error) throw health.error;
  return { body: body.data, health: health.data };
});

/** A mutation response must win over any quota GET that started before the mutation. */
export function publishAiQuotaSnapshot(userId: string, snapshot: unknown) {
  const current = aiQuotaResource.read(userId).data;
  if (!current) { void aiQuotaResource.load(userId, true).catch(() => undefined); return; }
  try {
    const next = parseAiQuotaResponse({ ...current, aiQuota: snapshot });
    next.canChat = !next.trialExpired && next.aiQuota.remaining.chatMessages > 0;
    next.canGenerate = !next.trialExpired && next.aiQuota.remaining.planGenerations > 0;
    next.canUseWorkoutAdjustment = !next.trialExpired && next.aiQuota.remaining.workoutAdjustments > 0;
    next.canUseMealAdjustment = !next.trialExpired && next.aiQuota.remaining.mealAdjustments > 0;
    aiQuotaResource.publish(userId, next);
  } catch { void aiQuotaResource.load(userId, true).catch(() => undefined); }
}
