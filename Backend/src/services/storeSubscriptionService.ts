import { z } from 'zod';
import { adminSupabase } from '../config/Supabase';
import { AppError, InternalConfigurationError } from '../http/errors';
import { resolveMembership, type MembershipProfile, type StoreMembership, type MembershipState } from '../../../shared/membership';

export type StoreTier = 'free' | 'plus' | 'pro';
const entitlementSchema = z.object({ expires_date: z.string().nullable(), product_identifier: z.string() }).passthrough();
const subscriberSchema = z.object({
  request_date_ms: z.number().finite(),
  subscriber: z.object({
    entitlements: z.record(z.string(), entitlementSchema),
    subscriptions: z.record(z.string(), z.object({ is_sandbox: z.boolean(), grace_period_expires_date: z.string().nullable().optional() }).passthrough()),
  }),
});

export function selectStoreEntitlement(payload: unknown, now = Date.now()) {
  const parsed = subscriberSchema.parse(payload);
  for (const [tier, id] of [
    ['pro', process.env.REVENUECAT_PRO_ENTITLEMENT || 'fitly_pro'],
    ['plus', process.env.REVENUECAT_PLUS_ENTITLEMENT || 'fitly_plus'],
  ] as const) {
    const entitlement = parsed.subscriber.entitlements[id];
    if (!entitlement) continue;
    const subscription = parsed.subscriber.subscriptions[entitlement.product_identifier];
    // This integration sells subscriptions only; unknown/test-store products grant no rights.
    if (!subscription || (subscription.is_sandbox && process.env.REVENUECAT_ALLOW_SANDBOX !== 'true')) continue;
    const expiresAt = Math.max(Date.parse(entitlement.expires_date || ''), Date.parse(subscription.grace_period_expires_date || '') || 0);
    if (Number.isFinite(expiresAt) && expiresAt > now) return { tier, expiresAt: new Date(expiresAt).toISOString(), checkedAt: new Date(parsed.request_date_ms).toISOString() };
  }
  return { tier: 'free' as const, expiresAt: null, checkedAt: new Date(parsed.request_date_ms).toISOString() };
}

export function effectiveMembershipTier(profile: MembershipProfile, store?: StoreMembership | null, now = Date.now()): StoreTier {
  return resolveMembership(profile, store, now).tier;
}

async function revenueCatRequest(userId: string, method = 'GET') {
  if (!process.env.REVENUECAT_SECRET_API_KEY) throw new InternalConfigurationError();
  try {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      method, headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_API_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (method === 'DELETE' && response.status === 404) return null;
    if (method === 'GET' && response.status === 404) return { request_date_ms: Date.now(), subscriber: { entitlements: {}, subscriptions: {} } };
    if (!response.ok) throw new Error('Provider unavailable');
    return await response.json();
  } catch {
    throw new AppError(503, 'SUBSCRIPTION_UNAVAILABLE', 'Chưa xác minh được gói đăng ký. Vui lòng thử khôi phục giao dịch sau.');
  }
}

export async function syncStoreSubscription(userId: string) {
  const { data: profile, error: profileError } = await adminSupabase.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null; // Ignore delayed events for deleted accounts.
  const entitlement = selectStoreEntitlement(await revenueCatRequest(userId));
  const { error } = await adminSupabase.rpc('sync_store_entitlement', {
    p_user_id: userId, p_tier: entitlement.tier, p_expires_at: entitlement.expiresAt, p_checked_at: entitlement.checkedAt,
  });
  if (error) throw error;
  return entitlement;
}

export async function getEffectiveMembershipTier(profile: any, userId: string): Promise<StoreTier> {
  return (await getEffectiveMembership(profile, userId)).tier;
}

export async function getEffectiveMembership(profile: MembershipProfile, userId: string): Promise<MembershipState> {
  if (!process.env.REVENUECAT_SECRET_API_KEY) return resolveMembership(profile);
  const { data, error } = await adminSupabase.from('store_entitlements').select('tier, expires_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return resolveMembership(profile, data);
}

export async function deleteStoreCustomer(userId: string) {
  if (process.env.REVENUECAT_SECRET_API_KEY) await revenueCatRequest(userId, 'DELETE');
}
