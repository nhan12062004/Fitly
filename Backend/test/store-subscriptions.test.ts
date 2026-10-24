import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveMembershipTier, selectStoreEntitlement } from '../src/services/storeSubscriptionService';
import { validWebhookAuthorization } from '../src/modules/account/storeRouter';
import { resolveMembership } from '../../shared/membership';

const now = Date.parse('2026-09-12T12:00:00Z');
const fixture = (expires = '2026-10-12T12:00:00Z', sandbox = false) => ({
  request_date_ms: now,
  subscriber: {
    entitlements: { fitly_pro: { product_identifier: 'pro_monthly', expires_date: expires } },
    subscriptions: { pro_monthly: { is_sandbox: sandbox, grace_period_expires_date: null } },
  },
});
afterEach(() => vi.unstubAllEnvs());

describe('verified subscription rights', () => {
  it('grants a valid recurring store subscription', () => {
    expect(selectStoreEntitlement(fixture(), now)).toMatchObject({ tier: 'pro', expiresAt: '2026-10-12T12:00:00.000Z' });
  });
  it('does not grant expired or malformed expiry dates', () => {
    expect(selectStoreEntitlement(fixture('2026-08-12T12:00:00Z'), now).tier).toBe('free');
    expect(selectStoreEntitlement(fixture('invalid'), now).tier).toBe('free');
  });
  it('grants a verified billing grace period until its end', () => {
    const data: any = fixture('2026-09-11T12:00:00Z');
    data.subscriber.subscriptions.pro_monthly.grace_period_expires_date = '2026-09-15T12:00:00Z';
    expect(selectStoreEntitlement(data, now).tier).toBe('pro');
  });
  it('keeps sandbox rights separate unless the test backend explicitly allows them', () => {
    vi.stubEnv('REVENUECAT_ALLOW_SANDBOX', 'false');
    expect(selectStoreEntitlement(fixture(undefined, true), now).tier).toBe('free');
    vi.stubEnv('REVENUECAT_ALLOW_SANDBOX', 'true');
    expect(selectStoreEntitlement(fixture(undefined, true), now).tier).toBe('pro');
  });
  it('rejects unknown products and a malformed provider response', () => {
    const data = fixture();
    data.subscriber.subscriptions = {} as any;
    expect(selectStoreEntitlement(data, now).tier).toBe('free');
    expect(() => selectStoreEntitlement({ tier: 'pro' }, now)).toThrow();
  });
  it('does not remove a separate referral/admin grant when store rights expire', () => {
    expect(effectiveMembershipTier({ membership_tier: 'pro' }, { tier: 'free', expires_at: null }, now)).toBe('pro');
    expect(effectiveMembershipTier({ membership_tier: 'plus' }, { tier: 'pro', expires_at: '2026-10-01' }, now)).toBe('pro');
    expect(effectiveMembershipTier({ membership_tier: 'pro', membership_expires_at: '2026-01-01' }, null, now)).toBe('free');
  });
  it('expires an August subscription by October 24 without inventing a new monthly period', () => {
    const profile = { membership_tier: 'pro', membership_expires_at: '2026-08-22T00:00:00+07:00' };
    const october24 = Date.parse('2026-10-24T12:00:00+07:00');
    expect(effectiveMembershipTier(profile, null, october24)).toBe('free');
    expect(resolveMembership(profile, null, october24)).toMatchObject({ tier: 'free', expiresAt: null, expired: { tier: 'pro' } });
    expect(profile.membership_expires_at).toBe('2026-08-22T00:00:00+07:00');
  });
  it('takes a newer verified expiry for a renewal of the same tier', () => {
    const state = resolveMembership({ membership_tier: 'pro', membership_expires_at: '2026-10-25' }, { tier: 'pro', expires_at: '2026-11-25' }, Date.parse('2026-10-24'));
    expect(state).toMatchObject({ tier: 'pro', source: 'store', expiresAt: '2026-11-25T00:00:00.000Z' });
  });
});

describe('webhook authentication', () => {
  it('rejects missing, incorrect and different-length credentials', () => {
    expect(validWebhookAuthorization(undefined, 'Bearer secret')).toBe(false);
    expect(validWebhookAuthorization('Bearer other!', 'Bearer secret')).toBe(false);
    expect(validWebhookAuthorization('short', 'Bearer secret')).toBe(false);
    expect(validWebhookAuthorization('Bearer secret', '')).toBe(false);
  });
  it('accepts only the exact configured header', () => {
    expect(validWebhookAuthorization('Bearer secret', 'Bearer secret')).toBe(true);
  });
});
