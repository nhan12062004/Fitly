export type AdjustmentApplyDecision =
  | { kind: 'apply' }
  | { kind: 'already_applied' }
  | { kind: 'conflict'; message: string };

/**
 * Keep the public endpoint's optimistic checks aligned with the SQL RPC's
 * locked status checks. The RPC remains the source of truth under concurrency.
 */
export const getAdjustmentApplyDecision = (params: {
  status: unknown;
  storedIdempotencyKey: unknown;
  idempotencyKey: string;
}): AdjustmentApplyDecision => {
  const status = String(params.status || '').trim();
  const storedIdempotencyKey = String(params.storedIdempotencyKey || '').trim();

  if (storedIdempotencyKey && storedIdempotencyKey !== params.idempotencyKey) {
    return {
      kind: 'conflict',
      message: 'Adjustment already processed with another idempotency key',
    };
  }
  if (status === 'applied') return { kind: 'already_applied' };
  if (status !== 'proposed') {
    return { kind: 'conflict', message: `Adjustment is already ${status || 'unavailable'}` };
  }
  return { kind: 'apply' };
};
