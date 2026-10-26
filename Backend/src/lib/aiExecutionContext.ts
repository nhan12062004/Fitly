import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiQuotaKey } from '../../../shared/aiQuota';

export type AiExecution = {
  id: string;
  userId: string;
  quotaKey: AiQuotaKey | null;
  signal: AbortSignal;
  mutationMayHaveCommitted: boolean;
  mutationAttempts: number;
};
export const aiOperationContext = new AsyncLocalStorage<AiExecution>();
