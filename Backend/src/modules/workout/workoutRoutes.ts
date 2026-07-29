import type { Express, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { validateBody } from '../../http/validation';

type WorkoutHandlers = {
  materializeFromPlan: RequestHandler;
  replaceDailyExercise: RequestHandler;
  createDailyExercise: RequestHandler;
  updateDailyExerciseConfig: RequestHandler;
  updateDailyExerciseCompletion: RequestHandler;
  completeDailyExerciseSet: RequestHandler;
};

type WorkoutRouteDependencies = WorkoutHandlers & {
  aiLimiter: RequestHandler;
  dailyExercisesFromPlanSchema: ZodType;
};

/**
 * Owns the public Workout HTTP surface. Handler implementations are injected so
 * domain code can be migrated out of the legacy composition root incrementally
 * without changing API paths, validation order, or rate-limit policy.
 */
export const registerWorkoutRoutes = (app: Express, dependencies: WorkoutRouteDependencies) => {
  const {
    aiLimiter,
    dailyExercisesFromPlanSchema,
    materializeFromPlan,
    replaceDailyExercise,
    createDailyExercise,
    updateDailyExerciseConfig,
    updateDailyExerciseCompletion,
    completeDailyExerciseSet,
  } = dependencies;

  app.post('/api/workout/daily-exercises/from-plan', validateBody(dailyExercisesFromPlanSchema), materializeFromPlan);
  app.post('/api/workout/daily-exercises/:exerciseSessionId/replace', aiLimiter, replaceDailyExercise);
  app.post('/api/workout/daily-exercises', createDailyExercise);
  app.post('/api/workout/daily-exercises/:exerciseSessionId/config', updateDailyExerciseConfig);
  app.post('/api/workout/daily-exercises/:exerciseSessionId/completion', updateDailyExerciseCompletion);
  app.post('/api/workout/daily-exercises/:exerciseSessionId/complete-set', completeDailyExerciseSet);
};
