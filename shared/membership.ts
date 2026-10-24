export type MembershipTier = 'free' | 'plus' | 'pro';
export type MembershipProfile = { membership_tier?: string | null; membership_expires_at?: string | null };
export type StoreMembership = { tier: string; expires_at: string | null };
export type MembershipState = {
  tier: MembershipTier;
  expiresAt: string | null;
  source: 'profile' | 'store' | 'none';
  expired: { tier: 'plus' | 'pro'; expiresAt: string } | null;
};

const rank = { free: 0, plus: 1, pro: 2 };

export function normalizeMembershipTier(value: unknown): MembershipTier {
  const tier = String(value || '').trim().toLowerCase();
  return tier === 'pro' || tier === 'premium' ? 'pro' : tier === 'plus' ? 'plus' : 'free';
}

export function resolveMembership(profile: MembershipProfile | null | undefined, store?: StoreMembership | null, now = Date.now()): MembershipState {
  const tier = normalizeMembershipTier(profile?.membership_tier);
  const expiry = profile?.membership_expires_at || null;
  const expiresAt = expiry && Number.isFinite(Date.parse(expiry)) ? new Date(expiry).toISOString() : null;
  let state: MembershipState = { tier: 'free', expiresAt: null, source: 'none', expired: null };
  if (tier !== 'free') {
    // A null expiry represents an existing separate referral/admin grant.
    // A dated subscription is valid only until its recorded expiry; reading it never renews it.
    if (!expiry || (expiresAt && Date.parse(expiresAt) > now)) {
      state = { tier, expiresAt, source: 'profile', expired: null };
    } else if (expiresAt) {
      state.expired = { tier, expiresAt };
    }
  }
  const storeTier = normalizeMembershipTier(store?.tier);
  const storeExpiry = Date.parse(store?.expires_at || '');
  if (storeTier !== 'free' && Number.isFinite(storeExpiry) && storeExpiry > now
    && (rank[storeTier] > rank[state.tier]
      || (storeTier === state.tier && state.expiresAt !== null && storeExpiry > Date.parse(state.expiresAt)))) {
    state = { tier: storeTier, expiresAt: new Date(storeExpiry).toISOString(), source: 'store', expired: null };
  }
  return state;
}

