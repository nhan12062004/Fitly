import type { MembershipState } from './membership';

export type AiQuotaKey = 'chatMessages' | 'planGenerations' | 'workoutAdjustments' | 'mealAdjustments';
export type AiQuotaCounters = Record<AiQuotaKey, number>;

export type AiQuotaResponse = {
  membershipTier: 'free' | 'plus' | 'pro';
  membership?: MembershipState;
  canChat: boolean;
  trialExpired: boolean;
  canGenerate?: boolean;
  canUseWorkoutAdjustment?: boolean;
  canUseMealAdjustment?: boolean;
  quotaWindow?: { startsAt: string; endsAt: string | null };
  aiQuota: {
    limits: AiQuotaCounters;
    usage: AiQuotaCounters;
    remaining: AiQuotaCounters;
    trialEndsAt?: string | null;
  };
};
