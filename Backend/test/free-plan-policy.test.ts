import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiCoachHandlers } from '../src/modules/ai-coach/aiCoachHandlers';
import { callGroqJson } from '../src/services/ai/groqJsonService';
import { InternalConfigurationError } from '../src/http/errors';
import { errorHandler } from '../src/http/errorHandler';
import { legacyErrorContractMiddleware } from '../src/http/legacyErrorContract';
import { requestIdMiddleware } from '../src/http/requestId';

vi.mock('../src/services/ai/groqJsonService', () => ({ callGroqJson: vi.fn() }));

const weekStartDate = '2026-10-19';
type Plan = { id: string; week_start_date: string; plan_status: string };

function fixture({ workoutPlan = null, currentFoodPlan = null, earlierFoodPlan = null, canGenerate = false }: {
  workoutPlan?: Plan | null;
  currentFoodPlan?: Plan | null;
  earlierFoodPlan?: Plan | null;
  canGenerate?: boolean;
} = {}) {
  const profile = { id: 'user-1', membership_tier: 'free' };
  const exercise = { id: 'exercise-1', name: 'Safe exercise' };
  const from = vi.fn((table: string) => {
    const filters = new Map<string, unknown>();
    const result = () => {
      const data = table === 'profiles' ? profile
        : table === 'exercises' ? [exercise]
          : table === 'weekly_plans' ? (workoutPlan ? [workoutPlan] : [])
            : table === 'weekly_food_plans' ? (filters.has('week_start_date')
              ? (currentFoodPlan ? [currentFoodPlan] : [])
              : (earlierFoodPlan ? [earlierFoodPlan] : []))
              : table === 'body_metrics' || table === 'lifestyle_settings' || table === 'health_conditions' ? {}
                : [];
      return { data, error: null };
    };
    const query: any = {
      select: () => query,
      eq: (name: string, value: unknown) => { filters.set(name, value); return query; },
      in: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  });
  const buildAiExerciseCatalog = vi.fn(() => { throw new Error('Generation was reached'); });
  const handlers = createAiCoachHandlers({
    supabase: { from },
    getAuthUserId: async () => profile.id,
    getVietnamDateKey: () => weekStartDate,
    getWeekStartKey: () => weekStartDate,
    getAiCoachAccessState: async () => ({ membershipTier: 'free', canGenerate }),
    InternalConfigurationError,
    buildAiQuotaSnapshot: () => ({}),
    synchronizeTrainingProfileContext: async () => ({
      profile, lifestyle: {}, health: {}, safetyContext: { profile, lifestyle: {}, health: {} },
      trainingPrescription: { weeklyWorkouts: 3, durationMinutes: 30 },
    }),
    buildExerciseEligibilityContext: () => ({}),
    getEligibleExercises: (exercises: unknown[]) => exercises,
    rankExercises: (exercises: unknown[]) => exercises.map((exercise) => ({ exercise })),
    buildAiExerciseCatalog,
    calculateNutritionMacroTargets: () => ({}),
  });
  const app = express();
  app.use(express.json(), requestIdMiddleware, legacyErrorContractMiddleware);
  app.post('/weekly', handlers.generateWeeklyPlan);
  app.post('/onboarding-meal', handlers.generateOnboardingMealPlan);
  app.post('/meal', handlers.generateMealPlan);
  app.post('/meal-swap', handlers.recordMealSwap);
  app.use(errorHandler);
  return { app, from, buildAiExerciseCatalog };
}

describe('Free initial plan policy', () => {
  beforeEach(() => vi.stubEnv('GROQ_API_KEY', 'test-key'));
  afterEach(() => vi.unstubAllEnvs());

  it('rejects another weekly plan after the first week without calling AI', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture({ workoutPlan: { id: 'first-plan', week_start_date: '2026-10-12', plan_status: 'active' } });
    const response = await request(app).post('/weekly').send({ weekStartDate, planScope: 'workout_only' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it('returns the first active plan on an onboarding retry without generating a replacement', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture({ workoutPlan: { id: 'first-plan', week_start_date: weekStartDate, plan_status: 'active' } });
    const response = await request(app).post('/weekly').send({ weekStartDate, planScope: 'workout_only' });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ weeklyPlanId: 'first-plan', source: 'existing' });
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it('reserves the first Free plan for the onboarding flow', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture({ canGenerate: true });
    const response = await request(app).post('/weekly').send({ weekStartDate });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it('allows the first onboarding request to reach generation', async () => {
    const { app, buildAiExerciseCatalog } = fixture({ canGenerate: true });
    const response = await request(app).post('/weekly').send({ weekStartDate, planScope: 'workout_only' });
    expect(response.status).toBe(500);
    expect(buildAiExerciseCatalog).toHaveBeenCalledOnce();
  });

  it('does not create another Free meal plan in a later week', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture({
      workoutPlan: { id: 'workout-plan', week_start_date: weekStartDate, plan_status: 'active' },
      earlierFoodPlan: { id: 'first-meal-plan', week_start_date: '2026-10-12', plan_status: 'active' },
    });
    const response = await request(app).post('/onboarding-meal').send({ weekStartDate });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it('returns an existing first meal plan on an onboarding retry', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture({
      workoutPlan: { id: 'workout-plan', week_start_date: weekStartDate, plan_status: 'active' },
      currentFoodPlan: { id: 'first-meal-plan', week_start_date: weekStartDate, plan_status: 'active' },
    });
    const response = await request(app).post('/onboarding-meal').send({ weekStartDate });
    expect(response.status).toBe(200);
    expect(response.body.data.foodPlanId).toBe('first-meal-plan');
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it('waits for the onboarding workout plan before creating Free meals', async () => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture();
    const response = await request(app).post('/onboarding-meal').send({ weekStartDate });
    expect(response.status).toBe(409);
    expect(callGroqJson).not.toHaveBeenCalled();
  });

  it.each(['/meal', '/meal-swap'])('blocks Free meal AI changes at %s', async (route) => {
    vi.mocked(callGroqJson).mockClear();
    const { app } = fixture();
    const response = await request(app).post(route).send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(callGroqJson).not.toHaveBeenCalled();
  });
});
