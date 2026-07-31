import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAiCoachHandlers } from '../src/modules/ai-coach/aiCoachHandlers';
import { getAdjustmentApplyDecision } from '../src/services/ai/adjustmentApplyGuard';
import { createWorkoutHandlers } from '../src/modules/workout/workoutHandlers';

const queryResult = (result: unknown, onResolve?: () => void) => {
  let resolved = false;
  const resolve = async () => {
    if (!resolved) {
      resolved = true;
      onResolve?.();
    }
    return result;
  };
  const query: any = {
    eq: () => query,
    order: () => query,
    limit: () => query,
    select: () => query,
    maybeSingle: resolve,
    single: resolve,
    then: (onFulfilled: any, onRejected: any) => resolve().then(onFulfilled, onRejected),
  };
  return query;
};

const createAiApplyFixture = () => {
  const state = {
    adjustment: {
      id: 'adjustment-1',
      user_id: 'user-1',
      status: 'proposed',
      apply_idempotency_key: null as string | null,
      plan_type: 'meal',
      old_data: { weekly_food_plan_id: 'food-plan-1' },
      new_data: {
        day_of_week: 0,
        meal_type: 'dinner',
        old_weekly_food_item_id: 'food-item-1',
        new_food_id: 'recipe-1',
        quantity: 1,
      },
    },
    adjustmentMutations: 0,
    mealMutations: 0,
    quotaEvents: 0,
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'ai_plan_adjustments') {
        return {
          select: () => queryResult({ data: state.adjustment, error: null }),
          update: (values: Record<string, unknown>) => queryResult(
            { data: { id: state.adjustment.id }, error: null },
            () => {
              state.adjustmentMutations += 1;
              state.adjustment.status = String(values.status || state.adjustment.status);
              state.adjustment.apply_idempotency_key = String(values.apply_idempotency_key || '');
            },
          ),
        };
      }
      if (table === 'profiles') {
        return { select: () => queryResult({ data: { id: 'user-1', membership_tier: 'premium' }, error: null }) };
      }
      if (table === 'lifestyle_settings' || table === 'health_conditions') {
        return { select: () => queryResult({ data: {}, error: null }) };
      }
      if (table === 'weekly_food_plans') {
        return { select: () => queryResult({ data: { id: 'food-plan-1' }, error: null }) };
      }
      if (table === 'weekly_food_items') {
        return {
          select: () => queryResult({ data: { id: 'food-item-1', order_index: 0 }, error: null }),
          update: () => queryResult({ error: null }, () => { state.mealMutations += 1; }),
        };
      }
      if (table === 'recipes') {
        return {
          select: () => queryResult({
            data: { id: 'recipe-1', meal_type: 'dinner', calories: 500, protein: 30, carbs: 40, fat: 15 },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  const dependencies = new Proxy({
    supabase,
    getAuthUserId: vi.fn(async () => 'user-1'),
    getAdjustmentApplyDecision,
    validateActionPayload: vi.fn(() => ({ valid: true })),
    buildExerciseEligibilityContext: vi.fn(() => ({})),
    getAiCoachAccessState: vi.fn(async () => ({ canUseMealAdjustment: true, canUseWorkoutAdjustment: true })),
    getFoodSafetyDecision: vi.fn(() => ({ allowed: true, reasons: [] })),
    isMealFoodEligible: vi.fn(() => true),
    buildAiQuotaSnapshot: vi.fn(() => ({ mealAdjustments: { used: state.quotaEvents } })),
    recordAiQuotaUsage: vi.fn(async () => { state.quotaEvents += 1; }),
    incrementMetric: vi.fn(),
    logAIEvent: vi.fn(),
    ExternalProviderError: class ExternalProviderError extends Error {},
  }, {
    get: (target, property) => property in target ? (target as any)[property] : vi.fn(),
  });
  const app = express();
  app.use(express.json());
  app.post('/api/ai/apply-adjustment', createAiCoachHandlers(dependencies).applyAdjustment);

  return { app, state, supabase, dependencies };
};

describe('Milestone 0 mobile contract: AI apply idempotency', () => {
  it('applies once and records exactly one plan mutation and quota event', async () => {
    const { app, state } = createAiApplyFixture();

    const response = await request(app)
      .post('/api/ai/apply-adjustment')
      .set('Idempotency-Key', 'mobile-apply-1')
      .send({ adjustmentId: 'adjustment-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, adjustmentId: 'adjustment-1' });
    expect(state.adjustment).toMatchObject({ status: 'applied', apply_idempotency_key: 'mobile-apply-1' });
    expect(state.mealMutations).toBe(1);
    expect(state.adjustmentMutations).toBe(1);
    expect(state.quotaEvents).toBe(1);
  });

  it('replays the same key as alreadyApplied without another mutation or quota event', async () => {
    const { app, state } = createAiApplyFixture();
    const first = await request(app).post('/api/ai/apply-adjustment').set('Idempotency-Key', 'mobile-apply-1').send({ adjustmentId: 'adjustment-1' });
    const replay = await request(app).post('/api/ai/apply-adjustment').set('Idempotency-Key', 'mobile-apply-1').send({ adjustmentId: 'adjustment-1' });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ success: true, adjustmentId: 'adjustment-1', alreadyApplied: true });
    expect(state.mealMutations).toBe(1);
    expect(state.adjustmentMutations).toBe(1);
    expect(state.quotaEvents).toBe(1);
  });

  it('rejects a different key after apply without a further mutation or quota event', async () => {
    const { app, state } = createAiApplyFixture();
    await request(app).post('/api/ai/apply-adjustment').set('Idempotency-Key', 'mobile-apply-1').send({ adjustmentId: 'adjustment-1' });
    const conflict = await request(app).post('/api/ai/apply-adjustment').set('Idempotency-Key', 'mobile-apply-2').send({ adjustmentId: 'adjustment-1' });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toContain('another idempotency key');
    expect(state.mealMutations).toBe(1);
    expect(state.adjustmentMutations).toBe(1);
    expect(state.quotaEvents).toBe(1);
  });

  it('rejects a missing key before any database mutation', async () => {
    const { app, state, supabase } = createAiApplyFixture();
    const response = await request(app).post('/api/ai/apply-adjustment').send({ adjustmentId: 'adjustment-1' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Idempotency-Key header is required' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(state.mealMutations).toBe(0);
    expect(state.adjustmentMutations).toBe(0);
    expect(state.quotaEvents).toBe(0);
  });
});

describe('Milestone 0 mobile contract: complete-set duplicate-send warning', () => {
  it('does not mutate a session that is not owned by the authenticated user', async () => {
    const update = vi.fn();
    class ApiRequestError extends Error {
      constructor(public status: number, public body: unknown) {
        super('request failed');
      }
    }
    const handlers = createWorkoutHandlers({
      supabase: { from: vi.fn(() => ({ update })) },
      getAuthUserId: vi.fn(async () => 'ordinary-user'),
      loadDailyExerciseSessionWithExerciseMeta: vi.fn(async () => {
        throw new ApiRequestError(404, { error: 'Daily exercise session not found' });
      }),
      ApiRequestError,
      ExternalProviderError: class ExternalProviderError extends Error {},
    });
    const app = express();
    app.use(express.json());
    app.post('/api/workout/daily-exercises/:exerciseSessionId/complete-set', handlers.completeDailyExerciseSet);

    const response = await request(app)
      .post('/api/workout/daily-exercises/another-users-session/complete-set')
      .send({ restSeconds: 60 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Daily exercise session not found' });
    expect(update).not.toHaveBeenCalled();
  });

  it('increments two sets for two accepted requests, so mobile must not retry after a timeout', async () => {
    const state = { completedSets: 0, updateValues: [] as Array<Record<string, unknown>>, loggedSetNumbers: [] as number[] };
    const session = () => ({
      id: 'exercise-session-1',
      log_date: '2026-07-31',
      sets: 3,
      actual_sets: 3,
      completed_sets: state.completedSets,
      actual_kcal_estimated: state.completedSets * 10,
      planned_reps: '10',
      actual_reps: '10',
      planned_weight_kg: 20,
      actual_weight_kg: 20,
      rest_seconds: 60,
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'daily_exercise_sessions') {
          return {
            update: (values: Record<string, unknown>) => queryResult({ data: { id: 'exercise-session-1' }, error: null }, () => {
              state.updateValues.push(values);
              state.completedSets = Number(values.completed_sets);
            }),
          };
        }
        if (table === 'daily_exercise_set_logs') {
          return {
            upsert: (values: Record<string, unknown>) => queryResult({ error: null }, () => {
              state.loggedSetNumbers.push(Number(values.set_number));
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    const handlers = createWorkoutHandlers({
      supabase,
      getAuthUserId: vi.fn(async () => 'user-1'),
      loadDailyExerciseSessionWithExerciseMeta: vi.fn(async () => session()),
      calculateCompletedExerciseKcal: vi.fn(async ({ completedSets }: { completedSets: number }) => completedSets * 10),
      upsertWorkoutSessionExerciseFromDailySession: vi.fn(async () => ({ id: 'snapshot-1' })),
      syncWorkoutCaloriesBurnedForDate: vi.fn(async () => undefined),
      parseAverageReps: vi.fn(() => 10),
      ExternalProviderError: class ExternalProviderError extends Error {},
    });
    const app = express();
    app.use(express.json());
    app.post('/api/workout/daily-exercises/:exerciseSessionId/complete-set', handlers.completeDailyExerciseSet);

    const first = await request(app).post('/api/workout/daily-exercises/exercise-session-1/complete-set').send({ restSeconds: 60 });
    const second = await request(app).post('/api/workout/daily-exercises/exercise-session-1/complete-set').send({ restSeconds: 60 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.completedSets).toBe(2);
    expect(state.updateValues.map((values) => values.completed_sets)).toEqual([1, 2]);
    expect(state.loggedSetNumbers).toEqual([1, 2]);
  });
});
