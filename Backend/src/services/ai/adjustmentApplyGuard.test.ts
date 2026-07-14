import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdjustmentApplyDecision } from './adjustmentApplyGuard';

test('an applied proposal is idempotent only with its original key', () => {
  assert.deepEqual(
    getAdjustmentApplyDecision({
      status: 'applied',
      storedIdempotencyKey: 'first-request',
      idempotencyKey: 'first-request',
    }),
    { kind: 'already_applied' },
  );
});

test('an applied proposal rejects a different idempotency key', () => {
  assert.deepEqual(
    getAdjustmentApplyDecision({
      status: 'applied',
      storedIdempotencyKey: 'first-request',
      idempotencyKey: 'second-request',
    }),
    {
      kind: 'conflict',
      message: 'Adjustment already processed with another idempotency key',
    },
  );
});

test('a proposed proposal rejects a different idempotency key', () => {
  assert.deepEqual(
    getAdjustmentApplyDecision({
      status: 'proposed',
      storedIdempotencyKey: 'first-request',
      idempotencyKey: 'second-request',
    }),
    {
      kind: 'conflict',
      message: 'Adjustment already processed with another idempotency key',
    },
  );
});
