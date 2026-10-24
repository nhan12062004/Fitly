import { expect, test } from 'vitest';
import { formatAiDate, getDisplayedMembership, getQuotaPeriod, parseAiQuotaResponse } from '../../Frontend/src/lib/aiQuota';
import { resolveMembership } from '../../shared/membership';

const quota = () => ({
  membershipTier: 'pro', canChat: true, trialExpired: false,
  aiQuota: {
    limits: { chatMessages: 900, planGenerations: 14, workoutAdjustments: 110, mealAdjustments: 120 },
    usage: { chatMessages: 45, planGenerations: 3, workoutAdjustments: 11, mealAdjustments: 20 },
    remaining: { chatMessages: 855, planGenerations: 11, workoutAdjustments: 99, mealAdjustments: 100 },
  },
});

test('keeps actual API quotas instead of replacing them with fixed tier limits', () => {
  const response = parseAiQuotaResponse(quota());
  expect(response.aiQuota.limits.chatMessages).toBe(900);
  expect(response.aiQuota.remaining.planGenerations).toBe(11);
  expect(response.aiQuota.remaining.mealAdjustments).toBe(100);
});

test('rejects incomplete or malformed counters instead of displaying an unused plan', () => {
  for (const value of [null, {}, { ...quota(), aiQuota: {} }, { ...quota(), membershipTier: 'unknown' }]) {
    expect(() => parseAiQuotaResponse(value)).toThrow();
  }
  for (const invalid of [-1, NaN, Infinity, '0']) {
    const data = quota();
    Object.assign(data.aiQuota.usage, { chatMessages: invalid });
    expect(() => parseAiQuotaResponse(data)).toThrow();
  }
});

test('supports the deployed response without optional period metadata', () => {
  expect(getQuotaPeriod(parseAiQuotaResponse(quota()))).toBe('Hạn mức được tính lại mỗi tháng');
});

test('shows the monthly reset from the API period, including the year boundary', () => {
  const data = { ...parseAiQuotaResponse(quota()), quotaWindow: { startsAt: '2026-12-01T00:00:00Z', endsAt: null } };
  expect(getQuotaPeriod(data)).toContain('01/01/2027');
});

test('shows an expired free trial separately from monthly paid quotas', () => {
  const data = parseAiQuotaResponse({ ...quota(), membershipTier: 'free', trialExpired: true, canChat: false });
  data.aiQuota.trialEndsAt = '2026-10-23T18:00:00Z';
  expect(getQuotaPeriod(data)).toBe('Dùng thử đã kết thúc ngày 24/10/2026');
  expect(formatAiDate('invalid')).toBe('');
});

const today = Date.parse('2026-10-24T12:00:00+07:00');
const expiredPro = { membership_tier: 'pro', membership_expires_at: '2026-08-22T00:00:00+07:00' };

test('an August Pro subscription is Free on October 24, including with the old API', () => {
  const state = getDisplayedMembership(parseAiQuotaResponse(quota()), expiredPro, undefined, today);
  expect(state.tier).toBe('free');
  expect(formatAiDate(state.expired?.expiresAt)).toBe('22/08/2026');
  expect(state.expiresAt).toBeNull();
});

test('a verified monthly renewal supplies the new expiry instead of the stale profile date', () => {
  const state = resolveMembership(expiredPro, { tier: 'pro', expires_at: '2026-11-22T00:00:00+07:00' }, today);
  expect(state).toMatchObject({ tier: 'pro', source: 'store', expired: null });
  expect(formatAiDate(state.expiresAt)).toBe('22/11/2026');
});

test('same-tier renewals show the later verified expiry', () => {
  const state = resolveMembership({ membership_tier: 'pro', membership_expires_at: '2026-10-25T00:00:00Z' }, { tier: 'pro', expires_at: '2026-11-25T00:00:00Z' }, today);
  expect(state.expiresAt).toBe('2026-11-25T00:00:00.000Z');
});

test('reaches Free at the exact expiry and never advances expiry just because time passed', () => {
  const expiresAt = '2026-10-24T05:00:00Z';
  const profile = { membership_tier: 'plus', membership_expires_at: expiresAt };
  expect(resolveMembership(profile, null, Date.parse(expiresAt) - 1).tier).toBe('plus');
  expect(resolveMembership(profile, null, Date.parse(expiresAt)).tier).toBe('free');
  expect(resolveMembership(profile, null, Date.parse('2026-12-24')).tier).toBe('free');
  expect(profile.membership_expires_at).toBe(expiresAt);
});
