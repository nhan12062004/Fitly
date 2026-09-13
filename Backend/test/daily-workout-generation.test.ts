import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiCoachHandlers } from '../src/modules/ai-coach/aiCoachHandlers';
import { AppError } from '../src/http/errors';
import { errorHandler } from '../src/http/errorHandler';
import { legacyErrorContractMiddleware } from '../src/http/legacyErrorContract';
import { requestIdMiddleware } from '../src/http/requestId';
import { callGroqJson } from '../src/services/ai/groqJsonService';

vi.mock('../src/services/ai/groqJsonService', () => ({ callGroqJson: vi.fn() }));

const query = (data: unknown) => {
  const result: any = {};
  for (const method of ['eq', 'order', 'limit', 'select', 'in']) result[method] = () => result;
  result.single = result.maybeSingle = async () => ({ data, error: null });
  result.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return result;
};

const fixture = (existing = false, safeDuration = 45) => {
  const profile = { id: 'user-1' };
  const lifestyle = { fitness_goal: 'Tăng cơ', workout_location: 'Phòng gym', equipment_available: 'barbell' };
  const health = { injuries: 'knee injury' };
  const exercise = { id: 'exercise-1', name: 'Safe exercise' };
  const dailyExercise = { id: 'daily-1', exercise_id: exercise.id };
  const inserts = vi.fn();
  let saved = existing;
  const supabase = { from: vi.fn((table: string) => ({
    select: () => query({
      profiles: profile, lifestyle_settings: lifestyle, health_conditions: health,
      body_metrics: { weight: 70 }, exercises: [exercise],
      daily_exercise_sessions: saved ? [dailyExercise] : [],
    }[table]),
    insert: (values: unknown) => {
      inserts(table, values);
      if (table === 'daily_exercise_sessions') saved = true;
      return query(table === 'daily_workout_sessions' ? { id: 'session-1' } : [dailyExercise]);
    },
    delete: () => query(null),
  })) };
  const workoutPlan = { plan_name: 'Today', days: [{ is_rest_day: false, exercises: [{ exercise_id: exercise.id }] }] };
  const dependencies = {
    supabase,
    getAuthUserId: async () => profile.id,
    getVietnamDateKey: () => '2026-09-12',
    DATE_KEY_REGEX: /^\d{4}-\d{2}-\d{2}$/,
    DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT: '*',
    AI_EXERCISE_CATALOG_FETCH_LIMIT: 500,
    AI_EXERCISE_CATALOG_LIMIT: 48,
    synchronizeTrainingProfileContext: vi.fn(async () => ({
      profile, lifestyle, health, safetyContext: { profile, lifestyle, health },
      trainingPrescription: { durationMinutes: safeDuration },
    })),
    getAiCoachAccessState: async () => ({ canGenerate: true }),
    buildExerciseEligibilityContext: vi.fn((context) => context),
    getEligibleExercises: (exercises: unknown[]) => exercises,
    rankExercises: (exercises: unknown[]) => exercises.map((exercise) => ({ exercise })),
    buildAiExerciseCatalog: () => ({ text: 'EX01|Safe exercise', referenceIds: new Map() }),
    truncateText: (value: unknown) => String(value || ''),
    buildSafetyPromptAddendum: () => 'Respect injury restrictions.',
    parseJsonFromAiText: JSON.parse,
    resolveAiExerciseReferences: (value: unknown) => value,
    validateExerciseProposal: () => ({ valid: true }),
    normalizeAiPlanPayload: () => ({ workoutPlan }),
    sanitizeWorkoutPlanForUser: vi.fn(() => ({ workoutPlan, removedCount: 0 })),
    prescribeWorkoutExercise: async () => ({ sets: 3, reps: '12-13', weightKg: 0, estimatedKcal: 20 }),
    buildDailyExerciseSessionRow: (value: unknown) => value,
    buildWorkoutSessionExerciseRow: (value: unknown) => value,
    buildAiQuotaSnapshot: () => ({}),
    ApiRequestError: class extends Error {},
    isDatabaseMigrationRequiredError: () => false,
  };
  const app = express();
  app.use(express.json(), requestIdMiddleware, legacyErrorContractMiddleware);
  app.post('/daily', createAiCoachHandlers(dependencies).generateDailyWorkout);
  app.use(errorHandler);
  return { app, inserts, dependencies };
};

describe('daily workout quick setup', () => {
  beforeEach(() => {
    vi.stubEnv('GROQ_API_KEY', 'test-key');
    vi.mocked(callGroqJson).mockReset().mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the selected goal, duration and location while preserving health safeguards', async () => {
    const { app, inserts, dependencies } = fixture();
    const response = await request(app).post('/daily').send({
      logDate: '2026-09-12', goal: 'Giảm mỡ', durationMinutes: 20, location: 'Tại nhà',
    });
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('ai_daily_workout');
    const prompt = vi.mocked(callGroqJson).mock.calls[0][0].messages[1].content;
    expect(prompt).toContain('target_duration_minutes=20');
    expect(prompt).toContain('fitness_goal=Giảm mỡ');
    expect(prompt).toContain('workout_location=Tại nhà');
    expect(dependencies.buildExerciseEligibilityContext).toHaveBeenCalledWith(expect.objectContaining({
      health: { injuries: 'knee injury' },
      lifestyle: expect.objectContaining({ equipment_available: 'bodyweight', workout_duration: 20 }),
    }));
    expect(inserts).toHaveBeenCalledWith('daily_workout_sessions', expect.objectContaining({ duration_minutes: 20 }));
    expect(inserts.mock.calls.filter(([table]) => table === 'ai_plan_adjustments')).toHaveLength(1);
  });

  it('caps requested duration at the safety prescription', async () => {
    const { app, inserts } = fixture(false, 35);
    expect((await request(app).post('/daily').send({ durationMinutes: 45 })).status).toBe(200);
    expect(inserts).toHaveBeenCalledWith('daily_workout_sessions', expect.objectContaining({ duration_minutes: 35 }));
  });

  it('returns an existing workout without calling AI even when its key is missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const { app, inserts } = fixture(true);
    const response = await request(app).post('/daily').send({});
    expect(response.status).toBe(200);
    expect(response.body.data.source).toBe('existing');
    expect(callGroqJson).not.toHaveBeenCalled();
    expect(inserts).not.toHaveBeenCalled();
  });

  it('rejects invalid quick setup values before any AI call or plan insertion', async () => {
    const { app, inserts } = fixture();
    expect((await request(app).post('/daily').send({ durationMinutes: 900 })).status).toBe(400);
    expect(callGroqJson).not.toHaveBeenCalled();
    expect(inserts).not.toHaveBeenCalled();
  });

  it('preserves the safe Vietnamese AI failure through the API error boundary', async () => {
    vi.mocked(callGroqJson).mockRejectedValue(new AppError(503, 'AI_PROVIDER_ERROR', 'AI tạm thời chưa tạo được kế hoạch. Vui lòng thử lại sau.'));
    const { app, inserts } = fixture();
    const response = await request(app).post('/daily').send({});
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'AI_PROVIDER_ERROR', message: 'AI tạm thời chưa tạo được kế hoạch. Vui lòng thử lại sau.',
      requestId: response.headers['x-request-id'],
    });
    expect(inserts).not.toHaveBeenCalled();
  });
});
