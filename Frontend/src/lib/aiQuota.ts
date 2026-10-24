import type { AiQuotaCounters, AiQuotaKey, AiQuotaResponse } from '../../../shared/aiQuota';
import { resolveMembership, type MembershipProfile, type MembershipState } from '../../../shared/membership';

export const quotaKeys: AiQuotaKey[] = ['chatMessages', 'planGenerations', 'workoutAdjustments', 'mealAdjustments'];

const isCounters = (value: unknown): value is AiQuotaCounters => {
  if (!value || typeof value !== 'object') return false;
  return quotaKeys.every((key) => {
    const count = (value as Record<string, unknown>)[key];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
};

export function parseAiQuotaResponse(value: unknown): AiQuotaResponse {
  if (!value || typeof value !== 'object') throw new Error('Chưa nhận được thông tin gói AI.');
  const payload = value as AiQuotaResponse;
  if (!['free', 'plus', 'pro'].includes(payload.membershipTier)
    || typeof payload.canChat !== 'boolean' || typeof payload.trialExpired !== 'boolean'
    || !isCounters(payload.aiQuota?.limits) || !isCounters(payload.aiQuota?.usage)
    || !isCounters(payload.aiQuota?.remaining)) {
    throw new Error('Thông tin gói AI chưa đầy đủ. Vui lòng thử tải lại.');
  }
  return payload;
}

export function formatAiDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function getDisplayedMembership(data: AiQuotaResponse | null | undefined, profile: MembershipProfile | null, known?: MembershipState, now = Date.now()): MembershipState {
  const local = known || resolveMembership(profile, null, now);
  if (!data?.membership) {
    // Older API versions omit expiry. They must not turn an expired local subscription back into Pro.
    return data?.membershipTier === 'free' ? { tier: 'free', expiresAt: null, source: 'none', expired: local.expired } : local;
  }
  const state = resolveMembership({ membership_tier: data.membership.tier, membership_expires_at: data.membership.expiresAt }, null, now);
  return {
    ...state,
    source: state.tier === 'free' ? 'none' : data.membership.source,
    expired: state.tier === 'free' ? state.expired || data.membership.expired || local.expired : null,
  };
}

export function getQuotaPeriod(data: AiQuotaResponse): string {
  if (data.membershipTier === 'free') {
    const endsAt = formatAiDate(data.aiQuota.trialEndsAt);
    if (data.trialExpired) return endsAt ? `Dùng thử đã kết thúc ngày ${endsAt}` : 'Dùng thử 7 ngày đã kết thúc';
    return endsAt ? `Dùng thử đến ${endsAt} · Hạn mức cho toàn bộ 7 ngày` : 'Hạn mức cho toàn bộ 7 ngày dùng thử';
  }
  const startsAt = data.quotaWindow?.startsAt;
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return 'Hạn mức được tính lại mỗi tháng';
  const start = new Date(startsAt);
  const resetAt = data.quotaWindow?.endsAt || new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
  return `Chu kỳ từ ${formatAiDate(startsAt)} · Đặt lại ngày ${formatAiDate(resetAt)}`;
}
