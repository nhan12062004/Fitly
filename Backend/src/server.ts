import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import { supabase } from './config/Supabase';
import { initTelegramBot, getTelegramReminderStatus, sendWaterReminders, sendSleepReminders } from './TelegramBot';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { resolveWeeklyWorkouts } from './lib/WorkoutFrequency';
import { detectIntent, extractDayIndexFromText, getResponseModeForIntent } from './services/ai/aiRouterService';
import { aiChatService } from './services/ai/aiChatService';
import { aiPlannerService } from './services/ai/aiPlannerService';
import { workoutAdjusterService } from './services/ai/workoutAdjusterService';
import { mealAdjusterService } from './services/ai/mealAdjusterService';
import { progressAnalyzerService } from './services/ai/progressAnalyzerService';
import { AIChatResponse, AIIntent } from './services/ai/types';
import { incrementMetric, logAIEvent, snapshotAIMetrics } from './lib/aiObservability';
import { validateActionPayload } from './services/ai/aiValidationService';
import { createTelegramLinkToken } from './lib/telegramLinkToken';
import {
  buildCoachDataContext,
  buildTodayStatus,
  executeCoachCommand,
  processNaturalTracking,
} from './services/coachCommandService';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = process.env.PORT || 5000;
const AI_COACH_FREE_TRIAL_DAYS = 7;
const AI_ACTION_FLOW_ENABLED = process.env.AI_ACTION_FLOW_ENABLED !== 'false';
const PREMIUM_AUTO_PLAN_ENABLED = process.env.PREMIUM_AUTO_PLAN_ENABLED !== 'false';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return {
    year: parts.find((p) => p.type === 'year')?.value || '1970',
    month: parts.find((p) => p.type === 'month')?.value || '01',
    day: parts.find((p) => p.type === 'day')?.value || '01'
  };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const getWeekStartKey = (baseDate: Date): string => {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return getVietnamDateKey(date);
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const getVietnamDayBoundsUtc = (dateKey = getVietnamDateKey()) => {
  const start = new Date(`${dateKey}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};
const getDateKeyFromWeekStartAndDayIndex = (weekStartKey: string, dayIndex: number): string => {
  const safeDayIndex = Math.max(0, Math.min(6, Number(dayIndex) || 0));
  const baseDate = new Date(`${weekStartKey}T00:00:00`);
  return getVietnamDateKey(addDays(baseDate, safeDayIndex));
};

const pickLatestByUpdatedAt = <T extends { updated_at?: string | null; created_at?: string | null }>(rows?: T[] | null): T | null => {
  if (!rows || rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const at = new Date(a.updated_at || a.created_at || 0).getTime();
    const bt = new Date(b.updated_at || b.created_at || 0).getTime();
    return bt - at;
  })[0];
};

const clampList = <T,>(rows: T[] | null | undefined, maxItems: number): T[] => (rows || []).slice(0, maxItems);

const truncateText = (value: unknown, maxLength: number) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const getBearerToken = (authorizationHeader: unknown): string | null => {
  const raw = String(authorizationHeader || '');
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim() || null;
};
const getAuthUserId = async (req: express.Request): Promise<string | null> => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) return null;
  const authRes = await supabase.auth.getUser(token);
  if (authRes.error || !authRes.data.user?.id) return null;
  return authRes.data.user.id;
};
const isAdminUser = async (userId: string): Promise<boolean> => {
  const profileRes = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (profileRes.error) return false;
  return String(profileRes.data?.role || '') === 'admin';
};
const hasValidCronSecret = (req: express.Request): boolean => {
  const secret = String(req.headers['x-cron-secret'] || '').trim();
  return Boolean(process.env.CRON_SECRET && secret && secret === process.env.CRON_SECRET);
};

const resolveMealsPerDay = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(2, Math.min(5, Math.round(parsed)));
};

const getMealSlotsForCount = (mealsPerDay: number) => {
  if (mealsPerDay <= 2) return ['breakfast', 'dinner'];
  if (mealsPerDay === 3) return ['breakfast', 'lunch', 'dinner'];
  if (mealsPerDay === 4) return ['breakfast', 'lunch', 'dinner', 'snack'];
  return ['breakfast', 'snack', 'lunch', 'snack', 'dinner'];
};

const normalizeDayMeals = (rawMeals: any[], mealsPerDay: number, foodById: Map<string, any>) => {
  const slots = getMealSlotsForCount(mealsPerDay);
  const meals = Array.isArray(rawMeals) ? rawMeals : [];
  const validMeals = meals.filter((item) => foodById.has(String(item?.food_id || '')));
  if (validMeals.length === 0) return [];

  const usedIndexes = new Set<number>();
  const normalized = slots.map((mealType, slotIndex) => {
    let sourceIndex = validMeals.findIndex((item, index) => !usedIndexes.has(index) && String(item?.meal_type || '') === mealType);
    if (sourceIndex < 0) {
      sourceIndex = validMeals.findIndex((_, index) => !usedIndexes.has(index));
    }
    if (sourceIndex < 0) {
      sourceIndex = Math.min(slotIndex, validMeals.length - 1);
    }

    usedIndexes.add(sourceIndex);
    const source = validMeals[sourceIndex] || validMeals[0];
    return {
      ...source,
      meal_type: mealType,
      order_index: slotIndex
    };
  });

  return normalized;
};

const getAiCoachAccessState = (profile: any) => {
  const membershipTier = profile?.membership_tier === 'premium' ? 'premium' : 'free';
  const createdAt = profile?.created_at ? new Date(profile.created_at) : null;
  const freeUsedAt = profile?.ai_coach_free_used_at ? new Date(profile.ai_coach_free_used_at) : null;
  const trialEndsAt = createdAt ? addDays(createdAt, AI_COACH_FREE_TRIAL_DAYS) : null;
  const isTrialActive = !!trialEndsAt && trialEndsAt.getTime() >= Date.now();
  const canGenerate = membershipTier === 'premium' || (!!createdAt && !freeUsedAt && isTrialActive);

  return {
    membershipTier,
    createdAt,
    freeUsedAt,
    trialEndsAt,
    isTrialActive,
    canGenerate
  };
};

const parseJsonFromAiText = (text: string) => {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('AI did not return valid JSON');
  }
};

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const AI_CHAT_DAY_LABELS = ['Thu 2', 'Thu 3', 'Thu 4', 'Thu 5', 'Thu 6', 'Thu 7', 'Chu nhat'];
const DAY_TO_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

const isValidDayIndex = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;

const isMealIntent = (intent: AIIntent): boolean =>
  intent === 'meal_plan' || intent === 'adjust_meal' || intent === 'create_meal_plan';

type NormalizedAiPlan = {
  workoutPlan: {
    plan_name: string;
    goal: string;
    explanation: string;
    days: Array<{
      day_of_week: number;
      is_rest_day: boolean;
      duration_minutes: number;
      exercises: Array<{
        exercise_id: string;
        sets: number;
        reps: string;
        weight_kg: number;
        rest_seconds: number;
        target_rpe: number;
        load_instruction: string;
        note: string;
      }>;
    }>;
  };
  mealPlan: {
    target_calories: number;
    explanation: string;
    days: Array<{
      day_of_week: number;
      is_rest_day: boolean;
      meals: Array<{
        meal_type: string;
        food_ids: string[];
        total_calories: number;
      }>;
    }>;
  };
};

const toDayOfWeekIndex = (value: unknown): number => {
  if (Number.isFinite(Number(value))) {
    const n = Number(value);
    return Math.max(0, Math.min(6, Math.round(n)));
  }
  const key = String(value || '').trim().toLowerCase();
  if (key in DAY_TO_INDEX) return DAY_TO_INDEX[key];
  return 0;
};

const normalizeAiPlanPayload = (raw: any): NormalizedAiPlan => {
  const workout = raw?.workout_plan || {};
  const meal = raw?.meal_plan || {};
  const workoutDays = Array.isArray(workout.days) ? workout.days : [];
  const mealDays = Array.isArray(meal.days) ? meal.days : [];

  const normalizedWorkoutDays = workoutDays.map((day: any) => {
    const dayIndex = toDayOfWeekIndex(day.day_of_week ?? day.day);
    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    return {
      day_of_week: dayIndex,
      is_rest_day: day.type === 'rest' || day.is_rest_day === true || exercises.length === 0,
      duration_minutes: Math.max(0, Number(day.duration_minutes) || 0),
      exercises: exercises.map((ex: any) => ({
        exercise_id: String(ex.exercise_id || ''),
        sets: Math.max(1, Math.min(8, Number(ex.sets) || 3)),
        reps: String(ex.reps || '10-12').slice(0, 20),
        weight_kg: Math.max(0, Number(ex.weight_kg) || 0),
        rest_seconds: Math.max(30, Math.min(240, Number(ex.rest_seconds) || 60)),
        target_rpe: Math.max(5, Math.min(10, Number(ex.target_rpe) || 7)),
        load_instruction: String(ex.load_instruction || '').slice(0, 160),
        note: String(ex.note || '').slice(0, 200)
      }))
    };
  });

  const normalizedMealDays = mealDays.map((day: any) => {
    const dayIndex = toDayOfWeekIndex(day.day_of_week ?? day.day);
    const meals = Array.isArray(day.meals) ? day.meals : [];
    return {
      day_of_week: dayIndex,
      is_rest_day: day.type === 'rest' || day.is_rest_day === true,
      meals: meals.map((item: any) => {
        const ids = Array.isArray(item.food_ids)
          ? item.food_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : [String(item.food_id || '').trim()].filter(Boolean);
        return {
          meal_type: String(item.meal_type || 'lunch').toLowerCase(),
          food_ids: ids,
          total_calories: Math.max(0, Number(item.total_calories) || 0)
        };
      })
    };
  });

  if (normalizedWorkoutDays.length === 0 || normalizedMealDays.length === 0) {
    throw new Error('AI JSON missing workout_plan.days or meal_plan.days');
  }

  return {
    workoutPlan: {
      plan_name: String(workout.plan_name || workout.name || 'AI Coach Week Plan').slice(0, 120),
      goal: String(workout.goal || 'general_fitness').slice(0, 40),
      explanation: String(workout.explanation || workout.description || '').slice(0, 1500),
      days: normalizedWorkoutDays
    },
    mealPlan: {
      target_calories: Math.max(0, Number(meal.target_calories) || 0),
      explanation: String(meal.explanation || '').slice(0, 1500),
      days: normalizedMealDays
    }
  };
};

const parseAverageReps = (repsText: string): number => {
  const numbers = String(repsText || '')
    .match(/\d+/g)
    ?.map(Number)
    .filter((value) => Number.isFinite(value)) || [];
  if (numbers.length === 0) return 10;
  if (numbers.length === 1) return numbers[0];
  return Math.round((numbers[0] + numbers[numbers.length - 1]) / 2);
};

const estimatePlannedExerciseKcal = ({
  exercise,
  bodyWeightKg,
  sets,
  repsText,
  weightKg,
  restSeconds
}: {
  exercise?: any;
  bodyWeightKg: number;
  sets: number;
  repsText: string;
  weightKg: number;
  restSeconds: number;
}): number => {
  const safeSets = Math.max(1, Number(sets) || 1);
  const safeReps = Math.max(1, parseAverageReps(repsText));
  const safeWeightKg = Math.max(0, Number(weightKg) || 0);
  const safeBodyWeightKg = Math.max(40, Number(bodyWeightKg) || 70);
  const workSeconds = safeSets * safeReps * (safeWeightKg > 0 ? 3.2 : 2.6);
  const pauseSeconds = Math.max(0, safeSets - 1) * Math.max(0, Number(restSeconds) || 0);
  const totalMinutes = Math.max(1, (workSeconds + pauseSeconds) / 60);
  const basePerMinute = Math.max(2.5, Number(exercise?.calories_per_minute) || 5.5);
  const relativeLoad = safeWeightKg / safeBodyWeightKg;
  const loadFactor = Math.min(1.35, Math.max(0.9, 0.95 + relativeLoad * 1.1));
  const densityFactor = Math.min(1.2, Math.max(0.92, 0.9 + (workSeconds / Math.max(1, workSeconds + pauseSeconds)) * 0.32));
  return Math.max(6, Math.min(300, Math.round(basePerMinute * totalMinutes * loadFactor * densityFactor)));
};

const buildWeeklyWorkoutPlanRow = ({
  weeklyPlanId,
  dayIndex,
  item,
  orderIndex,
  exercise,
  bodyWeightKg
}: {
  weeklyPlanId: string;
  dayIndex: number;
  item: any;
  orderIndex: number;
  exercise?: any;
  bodyWeightKg: number;
}) => {
  const plannedSets = Math.max(1, Math.min(6, Number(item.sets) || 3));
  const plannedReps = String(item.reps || '10-12').slice(0, 20);
  const plannedWeightKg = Math.max(0, Number(item.weight_kg) || 0);
  const plannedRestSeconds = Math.max(30, Math.min(180, Number(item.rest_seconds) || 60));
  const targetRpe = Math.max(5, Math.min(10, Number(item.target_rpe) || 7));
  const estimatedKcal = estimatePlannedExerciseKcal({
    exercise,
    bodyWeightKg,
    sets: plannedSets,
    repsText: plannedReps,
    weightKg: plannedWeightKg,
    restSeconds: plannedRestSeconds
  });

  return {
    weekly_plan_id: weeklyPlanId,
    day_of_week: dayIndex,
    exercise_id: String(item.exercise_id || ''),
    sets: plannedSets,
    reps: plannedReps,
    weight_kg: plannedWeightKg,
    rest_seconds: plannedRestSeconds,
    order_index: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : orderIndex,
    is_rest_day: false,
    planned_sets: plannedSets,
    planned_reps: plannedReps,
    planned_weight_kg: plannedWeightKg,
    planned_rest_seconds: plannedRestSeconds,
    target_rpe: targetRpe,
    estimated_kcal: estimatedKcal,
    ai_note: String(item.note || '').slice(0, 200) || null,
    load_instruction: String(item.load_instruction || '').slice(0, 160) || null
  };
};

const buildDailyExerciseSessionRow = ({
  userId,
  logDate,
  exerciseId,
  orderIndex,
  weeklyPlanExerciseId,
  plannedSets,
  plannedReps,
  plannedWeightKg,
  plannedRestSeconds,
  targetRpe,
  estimatedKcal,
  loadAdjustmentNote
}: {
  userId: string;
  logDate: string;
  exerciseId: string;
  orderIndex: number;
  weeklyPlanExerciseId?: string | null;
  plannedSets: number;
  plannedReps: string;
  plannedWeightKg: number | null;
  plannedRestSeconds: number;
  targetRpe?: number | null;
  estimatedKcal?: number | null;
  loadAdjustmentNote?: string | null;
}) => ({
  user_id: userId,
  log_date: logDate,
  weekly_plan_exercise_id: weeklyPlanExerciseId || null,
  exercise_id: exerciseId,
  sets: plannedSets,
  reps: plannedReps,
  weight_kg: plannedWeightKg,
  rest_seconds: plannedRestSeconds,
  order_index: orderIndex,
  is_completed: false,
  planned_sets: plannedSets,
  planned_reps: plannedReps,
  planned_weight_kg: plannedWeightKg,
  planned_rest_seconds: plannedRestSeconds,
  actual_sets: plannedSets,
  actual_reps: plannedReps,
  actual_weight_kg: plannedWeightKg,
  actual_rest_seconds: plannedRestSeconds,
  target_rpe: Math.max(5, Math.min(10, Number(targetRpe) || 7)),
  estimated_kcal: Math.max(0, Number(estimatedKcal) || 0),
  actual_kcal_estimated: 0,
  completed_sets: 0,
  load_adjustment_note: loadAdjustmentNote || null
});

const buildWorkoutSessionExerciseRow = ({
  sessionId,
  dailyExerciseSession
}: {
  sessionId: string;
  dailyExerciseSession: any;
}) => ({
  session_id: sessionId,
  daily_exercise_session_id: dailyExerciseSession.id || null,
  weekly_plan_exercise_id: dailyExerciseSession.weekly_plan_exercise_id || null,
  exercise_id: dailyExerciseSession.exercise_id,
  sets: dailyExerciseSession.sets,
  reps: dailyExerciseSession.reps,
  weight_kg: dailyExerciseSession.weight_kg,
  rest_seconds: dailyExerciseSession.rest_seconds,
  order_index: dailyExerciseSession.order_index,
  is_completed: !!dailyExerciseSession.is_completed,
  planned_sets: dailyExerciseSession.planned_sets ?? dailyExerciseSession.sets,
  planned_reps: dailyExerciseSession.planned_reps ?? dailyExerciseSession.reps,
  planned_weight_kg: dailyExerciseSession.planned_weight_kg ?? dailyExerciseSession.weight_kg,
  planned_rest_seconds: dailyExerciseSession.planned_rest_seconds ?? dailyExerciseSession.rest_seconds,
  actual_sets: dailyExerciseSession.actual_sets ?? dailyExerciseSession.sets,
  actual_reps: dailyExerciseSession.actual_reps ?? dailyExerciseSession.reps,
  actual_weight_kg: dailyExerciseSession.actual_weight_kg ?? dailyExerciseSession.weight_kg,
  actual_rest_seconds: dailyExerciseSession.actual_rest_seconds ?? dailyExerciseSession.rest_seconds,
  target_rpe: Math.max(5, Math.min(10, Number(dailyExerciseSession.target_rpe) || 7)),
  estimated_kcal: Math.max(0, Number(dailyExerciseSession.estimated_kcal) || 0),
  actual_kcal_estimated: Math.max(0, Number(dailyExerciseSession.actual_kcal_estimated) || 0),
  completed_sets: Math.max(0, Number(dailyExerciseSession.completed_sets) || 0)
});

const DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT = `
  *,
  exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
`;

const getLatestBodyWeightKg = async (userId: string): Promise<number> => {
  const latestBodyMetricsRes = await supabase
    .from('body_metrics')
    .select('weight')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestBodyMetricsRes.error) throw latestBodyMetricsRes.error;
  return Math.max(40, Number(latestBodyMetricsRes.data?.weight) || 70);
};

const getExerciseMetaForKcal = async (exerciseId: string) => {
  const exerciseRes = await supabase
    .from('exercises')
    .select('id, calories_per_minute')
    .eq('id', exerciseId)
    .maybeSingle();
  if (exerciseRes.error) throw exerciseRes.error;
  if (!exerciseRes.data?.id) {
    throw new ApiRequestError(404, { error: 'Exercise not found' });
  }
  return exerciseRes.data;
};

const loadDailyExerciseSessionWithExerciseMeta = async (exerciseSessionId: string, userId: string) => {
  const sessionRes = await supabase
    .from('daily_exercise_sessions')
    .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
    .eq('id', exerciseSessionId)
    .eq('user_id', userId)
    .maybeSingle();
  if (sessionRes.error) throw sessionRes.error;
  if (!sessionRes.data) {
    throw new ApiRequestError(404, { error: 'Daily exercise session not found' });
  }
  return sessionRes.data;
};

const upsertWorkoutSessionExerciseFromDailySession = async ({
  userId,
  logDate,
  dailyExerciseSession
}: {
  userId: string;
  logDate: string;
  dailyExerciseSession: any;
}) => {
  const workoutSessionRes = await supabase
    .from('daily_workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workoutSessionRes.error) throw workoutSessionRes.error;
  if (!workoutSessionRes.data?.id) return null;

  const sessionId = String(workoutSessionRes.data.id);
  const row = buildWorkoutSessionExerciseRow({
    sessionId,
    dailyExerciseSession
  });
  const { session_id, ...updates } = row;

  const existingRes = await supabase
    .from('daily_workout_session_exercises')
    .select('id')
    .eq('session_id', sessionId)
    .eq('daily_exercise_session_id', dailyExerciseSession.id)
    .maybeSingle();
  if (existingRes.error) throw existingRes.error;

  if (existingRes.data?.id) {
    const updateRes = await supabase
      .from('daily_workout_session_exercises')
      .update(updates)
      .eq('id', existingRes.data.id)
      .select('id')
      .single();
    if (updateRes.error) throw updateRes.error;
    return updateRes.data;
  }

  const insertRes = await supabase
    .from('daily_workout_session_exercises')
    .insert(row)
    .select('id')
    .single();
  if (insertRes.error) throw insertRes.error;
  return insertRes.data;
};

class ApiRequestError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error || 'Request failed'));
    this.status = status;
    this.body = body;
  }
}

const hasExistingWeeklyCoachPlan = async (userId: string, weekStartKey: string) => {
  const [workoutRes, foodRes] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .limit(1),
    supabase
      .from('weekly_food_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .limit(1),
  ]);

  if (workoutRes.error) throw workoutRes.error;
  if (foodRes.error) throw foodRes.error;

  return Boolean(workoutRes.data?.length || foodRes.data?.length);
};

async function generateWeeklyCoachPlanForUser(params: {
  userId: string;
  weekStartKey: string;
  premiumOnly?: boolean;
  markFreeUsage?: boolean;
}) {
  const { userId, weekStartKey, premiumOnly = false, markFreeUsage = true } = params;

  const [
    profileRes,
    bodyMetricsRes,
    lifestyleRes,
    healthRes,
    exerciseCatalogRes,
    foodCatalogRes,
    recentSessionsRes,
    recentMealsRes
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('exercises')
      .select('id, name, body_part, target_muscle, equipment, difficulty, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
      .limit(80),
    supabase
      .from('foods')
      .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare')
      .limit(100),
    supabase
      .from('daily_exercise_sessions')
      .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(20),
    supabase
      .from('weekly_food_items')
      .select('day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, weekly_food_plans!inner(user_id), foods:food_id(name, category)')
      .eq('weekly_food_plans.user_id', userId)
      .limit(20)
  ]);

  const firstError = [
    profileRes.error,
    bodyMetricsRes.error,
    lifestyleRes.error,
    healthRes.error,
    exerciseCatalogRes.error,
    foodCatalogRes.error,
    recentSessionsRes.error,
    recentMealsRes.error
  ].find(Boolean);
  if (firstError) throw firstError;

  const profile = profileRes.data || {};
  const bodyMetrics = bodyMetricsRes.data || {};
  const lifestyle = lifestyleRes.data || {};
  const health = healthRes.data || {};
  const exercises = clampList(exerciseCatalogRes.data as any[], 80);
  const foods = clampList(foodCatalogRes.data as any[], 100);
  const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
  const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
  const foodById = new Map(foods.map((item: any) => [String(item.id), item]));
  const weeklyWorkoutDays = resolveWeeklyWorkouts(lifestyle.activity_level, lifestyle.weekly_workouts);
  const mealsPerDay = resolveMealsPerDay(lifestyle.meals_per_day);
  const mealSlots = getMealSlotsForCount(mealsPerDay);
  const accessState = getAiCoachAccessState(profile);

  if (!profileRes.data?.id) {
    throw new ApiRequestError(403, {
      code: 'PROFILE_REQUIRED',
      error: 'Vui long hoan thanh ho so de AI Coach co the tao lo trinh cho ban.'
    });
  }

  if (premiumOnly) {
    if (accessState.membershipTier !== 'premium') {
      throw new ApiRequestError(403, {
        code: 'PREMIUM_REQUIRED',
        error: 'Premium membership required for automatic weekly generation.',
        membershipTier: accessState.membershipTier,
      });
    }
  } else if (!accessState.canGenerate) {
    const error =
      accessState.freeUsedAt
        ? 'Ban Free da dung luot kich hoat AI Coach. Vui long nang cap Premium de tao lai khong gioi han.'
        : 'Thoi gian dung thu AI Coach mien phi da het. Vui long nang cap Premium de tiep tuc tao lo trinh.';

    throw new ApiRequestError(403, {
      code: 'PREMIUM_REQUIRED',
      error,
      membershipTier: accessState.membershipTier,
      trialEndsAt: accessState.trialEndsAt?.toISOString() || null,
      freeUsedAt: accessState.freeUsedAt?.toISOString() || null
    });
  }

  const exerciseCatalog = exercises
    .map((item: any) => `${item.id}|${truncateText(item.name, 40)}|body=${truncateText(item.body_part, 16)}|target=${truncateText(item.target_muscle, 20)}|equipment=${truncateText(item.equipment, 18)}|level=${truncateText(item.difficulty, 14)}|goals=${truncateText((item.goal_type || []).join(','), 36)}|avoid=${truncateText((item.contraindications || []).join(','), 36)}|duration_s=${item.estimated_duration_seconds || ''}|kcal_min=${item.calories_per_minute || ''}|pattern=${truncateText(item.movement_pattern, 14)}`)
    .join('\n');

  const foodCatalog = foods
    .map((item: any) => `${item.id}|${truncateText(item.name, 36)}|cat=${truncateText(item.category, 18)}|kcal=${item.calories || 0}|p=${item.protein || 0}|c=${item.carbs || 0}|f=${item.fat || 0}|u=${truncateText(item.serving_unit || '100g', 12)}|meals=${truncateText((item.meal_type || []).join(','), 28)}|goals=${truncateText((item.goal_type || []).join(','), 32)}|allergens=${truncateText((item.allergens || []).join(','), 32)}|price=${truncateText(item.price_level, 12)}|cook_min=${item.cooking_time_minutes || ''}|region=${truncateText(item.region, 14)}|easy=${item.is_easy_to_prepare ?? ''}`)
    .join('\n');

  const recentTraining = clampList(recentSessionsRes.data as any[], 12)
    .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
    .join('\n') || 'No recent training history.';

  const recentEating = clampList(recentMealsRes.data as any[], 12)
    .map((item: any) => `d=${item.day_of_week}|${item.meal_type}|${truncateText(item.foods?.name || item.food_id, 28)}|qty=${item.quantity}`)
    .join('\n') || 'No recent meal plan history.';

  const prompt = `
Generate one personalized 7-day workout plan and 7-day meal plan.
Use only ids from EXERCISE_CATALOG and FOOD_CATALOG. Return valid JSON only.

USER_PROFILE:
name=${truncateText(profile.full_name, 40)}
gender=${truncateText(profile.gender, 12)}
birthday=${truncateText(profile.birthday, 20)}
job=${truncateText(profile.job, 30)}
weight_kg=${bodyMetrics.weight || ''}
height_cm=${bodyMetrics.height || ''}
target_weight_kg=${bodyMetrics.target_weight || ''}
body_fat=${bodyMetrics.body_fat || bodyMetrics.body_fat_percentage || ''}
fitness_goal=${truncateText(lifestyle.fitness_goal, 40)}
experience_level=${truncateText(lifestyle.experience_level, 20)}
activity_level=${truncateText(lifestyle.activity_level, 20)}
weekly_workouts=${weeklyWorkoutDays}
workout_duration_minutes=${lifestyle.workout_duration || ''}
workout_location=${truncateText(lifestyle.workout_location, 24)}
equipment_available=${truncateText(lifestyle.equipment_available, 60)}
diet_preference=${truncateText(lifestyle.diet_preference, 24)}
current_diet=${truncateText(lifestyle.current_diet, 24)}
cooking_ability=${truncateText(lifestyle.cooking_ability, 16)}
budget_level=${truncateText(lifestyle.budget_level, 16)}
meals_per_day=${mealsPerDay}
target_calories=${lifestyle.target_calories || ''}
water_goal_liters=${lifestyle.daily_water_goal || ''}
health_condition=${truncateText(health.health_condition, 80)}
injuries=${truncateText(health.injuries, 80)}
medications=${truncateText(health.medications, 60)}
sleep_hours=${health.sleep_hours || ''}
sleep_quality=${truncateText(health.sleep_quality, 20)}
stress_level=${truncateText(health.stress_level, 20)}
allergies_or_medical_history=${truncateText(health.medical_history || health.allergies, 120)}

RECENT_TRAINING:
${recentTraining}

RECENT_MEAL_PLAN:
${recentEating}

EXERCISE_CATALOG:
${exerciseCatalog}

FOOD_CATALOG:
${foodCatalog}

Rules:
- Exactly 7 days, day_of_week 0..6 where 0 is Monday.
- Never create new exercises or foods. Pick only exercise_id values from EXERCISE_CATALOG and food_id values from FOOD_CATALOG.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Prefer foods whose meal_type, goal_type, allergens, price_level, cooking_time_minutes and region match the user profile.
- Avoid foods whose allergens conflict with allergies_or_medical_history.
- Training days should match weekly_workouts. Rest days: is_rest_day=true and no exercises.
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction, order_index.
- weight_kg should be conservative. Use 0 for bodyweight.
- Avoid exercises that conflict with injuries, health conditions, location, or equipment.
- Each day must include exactly ${mealsPerDay} meals.
- Allowed meal slots for each day: ${mealSlots.join(', ')}.
- Do not add extra meals beyond those slots.
- Use reasonable quantity multipliers.

JSON schema (fixed):
{
  "workout_plan": {
    "plan_name": "Beginner Fat Loss - Week 1",
    "goal": "fat_loss",
    "days": [
      {
        "day": "Monday",
        "type": "workout",
        "duration_minutes": 25,
        "exercises": [
          {
            "exercise_id": "exact id from catalog",
            "sets": 3,
            "reps": 12,
            "weight_kg": 12.5,
            "rest_seconds": 60,
            "target_rpe": 7,
            "load_instruction": "chon muc ta con du 2 reps",
            "note": "short coaching note"
          }
        ]
      }
    ],
    "explanation": "short explanation in Vietnamese"
  },
  "meal_plan": {
    "target_calories": 1800,
    "days": [
      {
        "day": "Monday",
        "meals": [
          {
            "meal_type": "breakfast",
            "food_ids": ["exact id from catalog"],
            "total_calories": 420
          }
        ]
      }
    ],
    "explanation": "short explanation in Vietnamese"
  }
}
`;

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.35,
      max_tokens: 2800,
      response_format: { type: 'json_object' }
    })
  });

  const groqResult: any = await groqResponse.json();
  if (!groqResponse.ok || groqResult.error) {
    throw new Error(groqResult?.error?.message || 'Groq AI request failed');
  }

  const parsed = parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || '');
  const normalizedPlan = normalizeAiPlanPayload(parsed);

  const existingWorkoutPlans = await supabase
    .from('weekly_plans')
    .select('id, created_at, updated_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .limit(20);
  if (existingWorkoutPlans.error) throw existingWorkoutPlans.error;

  const previousWorkoutPlanId = pickLatestByUpdatedAt(existingWorkoutPlans.data as any[])?.id || null;
  const createdWorkoutPlan = await supabase
    .from('weekly_plans')
    .insert({
      user_id: userId,
      name: normalizedPlan.workoutPlan.plan_name || 'AI Coach Week Plan',
      description: normalizedPlan.workoutPlan.explanation || '',
      week_start_date: weekStartKey,
      plan_status: 'active',
      generated_by: 'ai',
      ai_explanation: truncateText(normalizedPlan.workoutPlan.explanation || '', 500)
    })
    .select('id')
    .single();
  if (createdWorkoutPlan.error) throw createdWorkoutPlan.error;
  const weeklyPlanId = createdWorkoutPlan.data.id;

  if (previousWorkoutPlanId) {
    const markOldWorkoutPlan = await supabase
      .from('weekly_plans')
      .update({ plan_status: 'adjusted', updated_at: new Date().toISOString() })
      .eq('id', previousWorkoutPlanId);
    if (markOldWorkoutPlan.error) throw markOldWorkoutPlan.error;
  }

  const workoutRows: any[] = [];
  for (const day of normalizedPlan.workoutPlan.days || []) {
    const dayIndex = Math.max(0, Math.min(6, Number(day.day_of_week) || 0));
    if (day.is_rest_day || !Array.isArray(day.exercises) || day.exercises.length === 0) {
      workoutRows.push({
        weekly_plan_id: weeklyPlanId,
        day_of_week: dayIndex,
        exercise_id: null,
        sets: 0,
        reps: '0',
        weight_kg: 0,
        rest_seconds: 0,
        order_index: 0,
        is_rest_day: true
      });
      continue;
    }

    day.exercises.forEach((item: any, index: number) => {
      const exerciseId = String(item.exercise_id || '');
      if (!exerciseIds.has(exerciseId)) return;
      workoutRows.push({
        weekly_plan_id: weeklyPlanId,
        day_of_week: dayIndex,
        exercise_id: exerciseId,
        sets: Math.max(1, Math.min(6, Number(item.sets) || 3)),
        reps: String(item.reps || '10-12').slice(0, 20),
        weight_kg: Math.max(0, Number(item.weight_kg) || 0),
        rest_seconds: Math.max(30, Math.min(180, Number(item.rest_seconds) || 60)),
        order_index: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        is_rest_day: false
      });
    });
  }
  if (workoutRows.length > 0) {
    const insertedWorkout = await supabase.from('weekly_plan_exercises').insert(workoutRows);
    if (insertedWorkout.error) throw insertedWorkout.error;
  }

  const existingFoodPlans = await supabase
    .from('weekly_food_plans')
    .select('id, created_at, updated_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .limit(20);
  if (existingFoodPlans.error) throw existingFoodPlans.error;

  const previousFoodPlanId = pickLatestByUpdatedAt(existingFoodPlans.data as any[])?.id || null;
  const createdFoodPlan = await supabase
    .from('weekly_food_plans')
    .insert({
      user_id: userId,
      name: 'AI Coach Meal Plan',
      week_start_date: weekStartKey,
      plan_status: 'active',
      generated_by: 'ai',
      ai_explanation: truncateText(normalizedPlan.mealPlan.explanation || '', 500)
    })
    .select('id')
    .single();
  if (createdFoodPlan.error) throw createdFoodPlan.error;
  const foodPlanId = createdFoodPlan.data.id;

  if (previousFoodPlanId) {
    const markOldFoodPlan = await supabase
      .from('weekly_food_plans')
      .update({ plan_status: 'adjusted', updated_at: new Date().toISOString() })
      .eq('id', previousFoodPlanId);
    if (markOldFoodPlan.error) throw markOldFoodPlan.error;
  }

  const mealRows: any[] = [];
  const allowedMealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
  for (const day of normalizedPlan.mealPlan.days || []) {
    const dayIndex = Math.max(0, Math.min(6, Number(day.day_of_week) || 0));
    if (day.is_rest_day && (!Array.isArray(day.meals) || day.meals.length === 0)) {
      mealRows.push({
        food_plan_id: foodPlanId,
        day_of_week: dayIndex,
        meal_type: 'breakfast',
        is_rest_day: true,
        order_index: 0
      });
      continue;
    }

    const expandedMeals = (day.meals || []).flatMap((meal: any) => {
      const foodIds = Array.isArray(meal.food_ids) ? meal.food_ids : [];
      return foodIds.map((foodId: string, idx: number) => ({
        meal_type: meal.meal_type,
        food_id: foodId,
        quantity: 1,
        order_index: idx
      }));
    });
    const normalizedMeals = normalizeDayMeals(expandedMeals, mealsPerDay, foodById);
    normalizedMeals.forEach((item: any, index: number) => {
      const foodId = String(item.food_id || '');
      const food = foodById.get(foodId);
      if (!food) return;
      const quantity = Math.max(0.25, Math.min(6, Number(item.quantity) || 1));
      const mealType = allowedMealTypes.has(String(item.meal_type)) ? String(item.meal_type) : 'lunch';
      mealRows.push({
        food_plan_id: foodPlanId,
        day_of_week: dayIndex,
        meal_type: mealType,
        food_id: foodId,
        quantity,
        calories: Number(food.calories || 0),
        protein: Number(food.protein || 0),
        carbs: Number(food.carbs || 0),
        fat: Number(food.fat || 0),
        order_index: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        is_rest_day: false
      });
    });
  }
  if (mealRows.length > 0) {
    const insertedMeals = await supabase.from('weekly_food_items').insert(mealRows);
    if (insertedMeals.error) throw insertedMeals.error;
  }

  const recommendation = await supabase.from('ai_recommendations').insert({
    user_id: userId,
    plan_type: 'weekly_coach_plan',
    recommendation_content: normalizedPlan,
    status: 'active'
  });
  if (recommendation.error) console.warn('Failed to store ai_recommendations:', recommendation.error.message);

  if (previousWorkoutPlanId || previousFoodPlanId) {
    const planType = previousWorkoutPlanId && previousFoodPlanId ? 'both'
      : previousWorkoutPlanId ? 'workout' : 'meal';
    const adjustment = await supabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: planType,
      source_type: 'ai_coach_generate',
      old_plan_id: previousWorkoutPlanId || previousFoodPlanId,
      new_plan_id: weeklyPlanId,
      old_data: {
        workout_plan_id: previousWorkoutPlanId,
        food_plan_id: previousFoodPlanId
      },
      new_data: {
        workout_plan_id: weeklyPlanId,
        food_plan_id: foodPlanId,
        workout_plan_name: normalizedPlan.workoutPlan.plan_name,
        target_calories: normalizedPlan.mealPlan.target_calories
      },
      reason: truncateText(
        normalizedPlan.workoutPlan.explanation || normalizedPlan.mealPlan.explanation || 'AI regenerated plan.',
        300
      ),
      created_by: 'ai'
    });
    if (adjustment.error) {
      console.warn('Failed to store ai_plan_adjustments:', adjustment.error.message);
    }
  }

  if (markFreeUsage && accessState.membershipTier !== 'premium' && !accessState.freeUsedAt) {
    const freeUsageUpdate = await supabase
      .from('profiles')
      .update({
        ai_coach_free_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    if (freeUsageUpdate.error) {
      console.warn('Failed to mark AI Coach free usage:', freeUsageUpdate.error.message);
    }
  }

  return {
    weeklyPlanId,
    foodPlanId,
    workoutItems: workoutRows.length,
    mealItems: mealRows.length,
    weekStartDate: weekStartKey,
    membershipTier: accessState.membershipTier,
    ai_json: {
      workout_plan: normalizedPlan.workoutPlan,
      meal_plan: normalizedPlan.mealPlan
    }
  };
}

async function runPremiumMondayAutoPlanner(trigger: 'cron' | 'manual' = 'cron') {
  const weekStartKey = getWeekStartKey(new Date(`${getVietnamDateKey()}T00:00:00`));
  const premiumProfilesRes = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('membership_tier', 'premium');

  if (premiumProfilesRes.error) throw premiumProfilesRes.error;

  const premiumProfiles = premiumProfilesRes.data || [];
  const result = {
    trigger,
    weekStartDate: weekStartKey,
    totalPremium: premiumProfiles.length,
    generated: 0,
    skippedExisting: 0,
    skippedProfile: 0,
    failed: 0,
    failures: [] as Array<{ userId: string; error: string }>,
  };

  for (const profile of premiumProfiles) {
    const userId = String(profile.id || '');
    if (!userId) continue;

    try {
      const alreadyHasPlan = await hasExistingWeeklyCoachPlan(userId, weekStartKey);
      if (alreadyHasPlan) {
        result.skippedExisting += 1;
        continue;
      }

      await generateWeeklyCoachPlanForUser({
        userId,
        weekStartKey,
        premiumOnly: true,
        markFreeUsage: false,
      });
      result.generated += 1;
    } catch (error: any) {
      if (error instanceof ApiRequestError && error.body.code === 'PROFILE_REQUIRED') {
        result.skippedProfile += 1;
        continue;
      }

      result.failed += 1;
      result.failures.push({
        userId,
        error: error?.message || 'Unknown error',
      });
      console.error('[premium-auto-planner] Failed for one premium user:', error?.message || 'unknown_error');
    }
  }

  return result;
}

const PREMIUM_AUTO_PLAN_CRON = process.env.PREMIUM_AUTO_PLAN_CRON || '5 0 * * 1';
let premiumAutoPlannerScheduled = false;

function schedulePremiumMondayAutoPlanner() {
  if (!PREMIUM_AUTO_PLAN_ENABLED) {
    console.log('[premium-auto-planner] Disabled by PREMIUM_AUTO_PLAN_ENABLED=false');
    return;
  }
  if (premiumAutoPlannerScheduled) return;
  premiumAutoPlannerScheduled = true;

  cron.schedule(
    PREMIUM_AUTO_PLAN_CRON,
    async () => {
      console.log(`[premium-auto-planner] Running Monday auto generation at ${new Date().toISOString()}`);
      try {
        const result = await runPremiumMondayAutoPlanner('cron');
        console.log('[premium-auto-planner] Result:', JSON.stringify({
          trigger: result.trigger,
          weekStartDate: result.weekStartDate,
          totalPremium: result.totalPremium,
          generated: result.generated,
          skippedExisting: result.skippedExisting,
          skippedProfile: result.skippedProfile,
          failed: result.failed,
        }));
      } catch (error: any) {
        console.error('[premium-auto-planner] Failed:', error?.message || 'unknown_error');
      }
    },
    { timezone: VIETNAM_TIMEZONE }
  );

  console.log(`[premium-auto-planner] Scheduled with cron "${PREMIUM_AUTO_PLAN_CRON}" (${VIETNAM_TIMEZONE})`);
}

const telegramBot = initTelegramBot();

const defaultAllowedOrigins = [
  'https://fitly.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

const configuredOrigins = (
  (process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
    : defaultAllowedOrigins
  ).filter(Boolean)
);

const allowedOrigins = new Set(
  configuredOrigins.filter((origin) => !IS_PRODUCTION || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
);

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please try again later.' },
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const isLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
    const isPreviewVercel = /^https:\/\/.*\.vercel\.app$/i.test(origin);

    if (
      allowedOrigins.has(origin) ||
      (!IS_PRODUCTION && (isPreviewVercel || isLocalOrigin))
    ) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(generalLimiter);
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Fitly API is live!',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/profiles', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const isAdmin = await isAdminUser(authUserId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, gender, birthday, job, role, membership_tier, telegram_chat_id, created_at, updated_at');

    if (error) {
      console.error('[profiles] query failed:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Ket noi thanh cong!', data });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/workout/daily-exercises', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const logDate = String(req.body?.logDate || '').trim();
    const exerciseId = String(req.body?.exerciseId || '').trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }
    if (!exerciseId) {
      return res.status(400).json({ error: 'exerciseId is required' });
    }

    const defaultSets = Math.max(1, Math.min(6, Number(req.body?.sets) || 3));
    const defaultReps = truncateText(req.body?.reps || '12', 20) || '12';
    const rawWeightKg = req.body?.weightKg;
    const defaultWeightKg =
      rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === ''
        ? null
        : Math.max(0, Number(rawWeightKg) || 0);
    const defaultRestSeconds = Math.max(0, Math.min(300, Number(req.body?.restSeconds) || 60));
    const targetRpe = Math.max(5, Math.min(10, Number(req.body?.targetRpe) || 7));

    let orderIndex = Number(req.body?.orderIndex);
    if (!Number.isFinite(orderIndex)) {
      const latestOrderRes = await supabase
        .from('daily_exercise_sessions')
        .select('order_index')
        .eq('user_id', authUserId)
        .eq('log_date', logDate)
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestOrderRes.error) throw latestOrderRes.error;
      orderIndex = Number(latestOrderRes.data?.order_index ?? -1) + 1;
    }

    const [bodyWeightKg, exerciseMeta] = await Promise.all([
      getLatestBodyWeightKg(authUserId),
      getExerciseMetaForKcal(exerciseId)
    ]);
    const estimatedKcal = estimatePlannedExerciseKcal({
      exercise: exerciseMeta,
      bodyWeightKg,
      sets: defaultSets,
      repsText: defaultReps,
      weightKg: defaultWeightKg ?? 0,
      restSeconds: defaultRestSeconds
    });

    const insertRes = await supabase
      .from('daily_exercise_sessions')
      .insert(
        buildDailyExerciseSessionRow({
          userId: authUserId,
          logDate,
          exerciseId,
          orderIndex,
          weeklyPlanExerciseId: null,
          plannedSets: defaultSets,
          plannedReps: defaultReps,
          plannedWeightKg: defaultWeightKg,
          plannedRestSeconds: defaultRestSeconds,
          targetRpe,
          estimatedKcal,
          loadAdjustmentNote: null
        })
      )
      .select('id')
      .single();
    if (insertRes.error) throw insertRes.error;

    const dailyExerciseSession = await loadDailyExerciseSessionWithExerciseMeta(String(insertRes.data.id), authUserId);
    await upsertWorkoutSessionExerciseFromDailySession({
      userId: authUserId,
      logDate,
      dailyExerciseSession
    });
    return res.json({ exercise: dailyExerciseSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/create-daily-exercise] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to create daily exercise session' });
  }
});

app.post('/api/workout/daily-exercises/:exerciseSessionId/config', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) {
      return res.status(400).json({ error: 'exerciseSessionId is required' });
    }

    const existingSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    const nextSets = Math.max(1, Math.min(6, Number(req.body?.sets) || 1));
    const nextReps = truncateText(req.body?.reps || '12', 20) || '12';
    const rawWeightKg = req.body?.weightKg;
    const nextWeightKg =
      rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === ''
        ? null
        : Math.max(0, Number(rawWeightKg) || 0);
    const nextRestSeconds = Math.max(0, Math.min(300, Number(req.body?.restSeconds) || 0));
    const nextCompletedSetCount = Math.min(nextSets, Math.max(0, Number(existingSession.completed_sets) || 0));
    const nextIsCompleted = nextCompletedSetCount >= nextSets;

    const [bodyWeightKg, exerciseMeta] = await Promise.all([
      getLatestBodyWeightKg(authUserId),
      getExerciseMetaForKcal(String(existingSession.exercise_id || ''))
    ]);
    const estimatedKcal = estimatePlannedExerciseKcal({
      exercise: exerciseMeta,
      bodyWeightKg,
      sets: nextSets,
      repsText: nextReps,
      weightKg: nextWeightKg ?? 0,
      restSeconds: nextRestSeconds
    });
    const nextActualKcal = Math.max(
      0,
      Math.round(estimatedKcal * (nextCompletedSetCount / Math.max(1, nextSets)))
    );

    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update({
        sets: nextSets,
        reps: nextReps,
        weight_kg: nextWeightKg,
        rest_seconds: nextRestSeconds,
        is_completed: nextIsCompleted,
        actual_sets: nextSets,
        actual_reps: nextReps,
        actual_weight_kg: nextWeightKg,
        actual_rest_seconds: nextRestSeconds,
        estimated_kcal: estimatedKcal,
        actual_kcal_estimated: nextActualKcal,
        completed_sets: nextCompletedSetCount
      })
      .eq('id', exerciseSessionId)
      .eq('user_id', authUserId)
      .select('id')
      .single();
    if (updateRes.error) throw updateRes.error;

    const updatedSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    await upsertWorkoutSessionExerciseFromDailySession({
      userId: authUserId,
      logDate: String(updatedSession.log_date || ''),
      dailyExerciseSession: updatedSession
    });

    return res.json({ exercise: updatedSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/update-daily-exercise-config] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to update exercise config' });
  }
});

app.post('/api/workout/daily-exercises/:exerciseSessionId/complete-set', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) {
      return res.status(400).json({ error: 'exerciseSessionId is required' });
    }

    const restSeconds = Math.max(0, Math.min(300, Number(req.body?.restSeconds) || 0));
    const existingSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    const totalSets = Math.max(1, Number(existingSession.actual_sets ?? existingSession.sets) || 1);
    const nextCompletedSets = Math.min(totalSets, Math.max(0, Number(existingSession.completed_sets) || 0) + 1);
    const nextActualKcal = Math.max(
      0,
      Math.round((Math.max(0, Number(existingSession.estimated_kcal) || 0) * nextCompletedSets) / Math.max(1, totalSets))
    );
    const nextIsCompleted = nextCompletedSets >= totalSets;

    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update({
        completed_sets: nextCompletedSets,
        actual_kcal_estimated: nextActualKcal,
        is_completed: nextIsCompleted
      })
      .eq('id', exerciseSessionId)
      .eq('user_id', authUserId)
      .select('id')
      .single();
    if (updateRes.error) throw updateRes.error;

    const updatedSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    const workoutSessionExercise = await upsertWorkoutSessionExerciseFromDailySession({
      userId: authUserId,
      logDate: String(updatedSession.log_date || ''),
      dailyExerciseSession: updatedSession
    });

    const actualReps = parseAverageReps(String((updatedSession.actual_reps ?? updatedSession.reps) || '10'));
    const actualWeightKg =
      updatedSession.actual_weight_kg === null || updatedSession.actual_weight_kg === undefined
        ? updatedSession.weight_kg ?? null
        : Math.max(0, Number(updatedSession.actual_weight_kg) || 0);
    const plannedWeightKg =
      updatedSession.planned_weight_kg === null || updatedSession.planned_weight_kg === undefined
        ? updatedSession.weight_kg ?? null
        : Math.max(0, Number(updatedSession.planned_weight_kg) || 0);
    const setEstimatedKcal = Math.max(
      1,
      Math.round((Math.max(0, Number(updatedSession.estimated_kcal) || 0)) / Math.max(1, totalSets))
    );

    const setLogRes = await supabase
      .from('daily_exercise_set_logs')
      .upsert(
        {
          daily_exercise_session_id: updatedSession.id,
          workout_session_exercise_id: workoutSessionExercise?.id || null,
          set_number: nextCompletedSets,
          planned_reps: String((updatedSession.planned_reps ?? updatedSession.reps) || ''),
          target_weight_kg: plannedWeightKg,
          actual_reps: actualReps,
          actual_weight_kg: actualWeightKg,
          rest_seconds: restSeconds,
          estimated_kcal: setEstimatedKcal,
          is_completed: true
        },
        { onConflict: 'daily_exercise_session_id,set_number' }
      );
    if (setLogRes.error) throw setLogRes.error;

    return res.json({ exercise: updatedSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/complete-set] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to complete set' });
  }
});

app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  const startedAt = Date.now();
  const traceId = `ai-chat-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  let detectedIntent: string | undefined;
  let detectedActionType: string | null | undefined;
  try {
    authUserId = await getAuthUserId(req);
    const { message, selectedDayIndex, weekStartDate, clientHistory } = req.body || {};
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
    const normalizedClientHistory = Array.isArray(clientHistory)
      ? clientHistory
          .filter((item: any) => {
            const role = String(item?.role || '');
            const content = String(item?.content || '').trim();
            return (role === 'user' || role === 'assistant') && content.length > 0;
          })
          .slice(-10)
          .map((item: any) => ({
            role: String(item.role) === 'assistant' ? 'assistant' as const : 'user' as const,
            content: String(item.content || '').trim().slice(0, 1200)
          }))
      : [];
    const hasSelectedDayIndex = Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedDayIndex');
    const hasWeekStartDate = Object.prototype.hasOwnProperty.call(req.body || {}, 'weekStartDate');

    if (!normalizedMessage) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (normalizedMessage.length > 1000) {
      return res.status(400).json({ error: 'message is too long' });
    }
    if (hasSelectedDayIndex && !isValidDayIndex(Number(selectedDayIndex))) {
      return res.status(400).json({ error: 'selectedDayIndex must be an integer between 0 and 6' });
    }
    if (hasWeekStartDate) {
      const normalizedWeekStartDate = String(weekStartDate || '').trim();
      if (normalizedWeekStartDate && !DATE_KEY_REGEX.test(normalizedWeekStartDate)) {
        return res.status(400).json({ error: 'weekStartDate must match YYYY-MM-DD' });
      }
    }

    const today = new Date(`${getVietnamDateKey()}T00:00:00`);
    const day = today.getDay();
    const todayDayIndex = day === 0 ? 6 : day - 1;
    const requestDayIndex = isValidDayIndex(Number(selectedDayIndex)) ? Number(selectedDayIndex) : null;
    const referencedDayIndex = extractDayIndexFromText(normalizedMessage);
    const dayIndex = referencedDayIndex ?? requestDayIndex ?? todayDayIndex;
    const requestedWeekStartDate = String(weekStartDate || '').trim() || null;
    let trackingActionLog = '';
    let todayStatusContext = '';
    let coachDataContext = '';

    try {
      trackingActionLog = (await processNaturalTracking(authUserId, normalizedMessage)).actionLog;
    } catch (trackingError: any) {
      console.warn('[ai-chat] natural tracking skipped:', trackingError?.message || trackingError);
    }

    incrementMetric('totalChatRequests');
    const chatDayBounds = getVietnamDayBoundsUtc();
    const weeklyPlanQuery = requestedWeekStartDate
      ? supabase
          .from('weekly_plans')
          .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, exercises:exercise_id(name, body_part, target_muscle))')
          .eq('user_id', authUserId)
          .eq('week_start_date', requestedWeekStartDate)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from('weekly_plans')
          .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, exercises:exercise_id(name, body_part, target_muscle))')
          .eq('user_id', authUserId)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    const weeklyFoodPlanQuery = requestedWeekStartDate
      ? supabase
          .from('weekly_food_plans')
          .select('id, weekly_food_items(id, day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, foods:food_id(id, name, category, calories, protein, carbs, fat, meal_type))')
          .eq('user_id', authUserId)
          .eq('week_start_date', requestedWeekStartDate)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from('weekly_food_plans')
          .select('id, weekly_food_items(id, day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, foods:food_id(id, name, category, calories, protein, carbs, fat, meal_type))')
          .eq('user_id', authUserId)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    const [todayWorkoutRes, todayMealRes, weekPlanRes, feedbackRes, profileRes, bodyMetricsRes, healthRes, recentChatRes, dailyExerciseSessionsRes] = await Promise.all([
      weeklyPlanQuery,
      weeklyFoodPlanQuery,
      supabase
        .from('lifestyle_settings')
        .select('*')
        .eq('user_id', authUserId)
        .maybeSingle(),
      supabase
        .from('daily_workout_sessions')
        .select('id, status')
        .eq('user_id', authUserId)
        .eq('status', 'completed')
        .gte('log_date', getWeekStartKey(today)),
      supabase
        .from('profiles')
        .select('id, full_name, gender, birthday, membership_tier, created_at')
        .eq('id', authUserId)
        .maybeSingle(),
      supabase
        .from('body_metrics')
        .select('*')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('health_conditions')
        .select('*')
        .eq('user_id', authUserId)
        .maybeSingle(),
      supabase
        .from('ai_chat_messages')
        .select('role, content, created_at')
        .eq('user_id', authUserId)
        .gte('created_at', chatDayBounds.startIso)
        .lt('created_at', chatDayBounds.endIso)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('daily_exercise_sessions')
        .select('id, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', authUserId)
        .eq('log_date', getVietnamDateKey())
        .order('order_index', { ascending: true })
    ]);

    const workoutRows = (todayWorkoutRes.data as any)?.weekly_plan_exercises || [];
    const mealRows = (todayMealRes.data as any)?.weekly_food_items || [];
    const planWorkoutRows = workoutRows.filter((row: any) => Number(row.day_of_week) === dayIndex && row.exercise_id);
    const dailyWorkoutRows = ((dailyExerciseSessionsRes.data || []) as any[])
      .filter((row: any) => row.exercise_id)
      .map((row: any) => ({
        ...row,
        day_of_week: todayDayIndex
      }));
    const targetWorkoutRows =
      dayIndex === todayDayIndex && dailyWorkoutRows.length > 0 ? dailyWorkoutRows : planWorkoutRows;
    const targetMealRows = mealRows.filter((row: any) => Number(row.day_of_week) === dayIndex && row.food_id);
    try {
      [todayStatusContext, coachDataContext] = await Promise.all([
        buildTodayStatus(authUserId),
        buildCoachDataContext(authUserId)
      ]);
    } catch (contextError: any) {
      console.warn('[ai-chat] extended coach context skipped:', contextError?.message || contextError);
    }
    const dbChatHistory = ((recentChatRes.data || []) as any[])
      .reverse()
      .map((item: any) => ({
        role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
        content: String(item.content || '').trim(),
      }))
      .filter((item: any) => item.content);
    const mergedChatHistory = [...dbChatHistory, ...normalizedClientHistory]
      .reduce((items: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>, item) => {
        const previous = items[items.length - 1];
        if (!previous || previous.role !== item.role || previous.content !== item.content) {
          items.push(item);
        }
        return items;
      }, [])
      .slice(-10);

    const { intent, confidence } = detectIntent(normalizedMessage, {
      todayWorkoutCount: targetWorkoutRows.length,
      todayMealCount: targetMealRows.length,
      todayDayIndex: todayDayIndex,
      targetDayIndex: dayIndex
    });
    detectedIntent = intent;

    let aiResponse: AIChatResponse;
    if (intent === 'adjust_workout') {
      aiResponse = await workoutAdjusterService({
        dayOfWeek: dayIndex,
        todayExercises: targetWorkoutRows
      });
    } else if (intent === 'adjust_meal') {
      const currentMeal = targetMealRows[0] || null;
      const mealType = String(currentMeal?.meal_type || 'dinner');
      const candidateFoodsRes = await supabase
        .from('foods')
        .select('id, name, calories, protein, carbs, fat, meal_type')
        .contains('meal_type', [mealType])
        .limit(10);
      if (candidateFoodsRes.error) throw candidateFoodsRes.error;

      aiResponse = await mealAdjusterService({
        dayOfWeek: dayIndex,
        currentMeal,
        candidateFoods: (candidateFoodsRes.data || []).map((item: any) => ({
          id: String(item.id),
          name: String(item.name || ''),
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat
        }))
      });
    } else if (intent === 'create_workout_plan' || intent === 'create_meal_plan') {
      aiResponse = await aiPlannerService(intent, {
        weeklyWorkouts: Number((weekPlanRes.data as any)?.weekly_workouts || 3),
        mealsPerDay: Number((weekPlanRes.data as any)?.meals_per_day || 3),
        fitnessGoal: String((weekPlanRes.data as any)?.fitness_goal || 'general_fitness')
      });
    } else if (intent === 'analyze_progress') {
      aiResponse = await progressAnalyzerService({
        completedWorkouts: (feedbackRes.data || []).length,
        targetWorkouts: Number((weekPlanRes.data as any)?.weekly_workouts || 0),
        completedMeals: targetMealRows.length,
        targetMeals: Number((weekPlanRes.data as any)?.meals_per_day || 0)
      });
    } else {
      aiResponse = await aiChatService(normalizedMessage, intent, {
        todayWorkoutCount: targetWorkoutRows.length,
        todayMealCount: targetMealRows.length,
        todayDayIndex: todayDayIndex,
        targetDayIndex: dayIndex,
        targetDayLabel: AI_CHAT_DAY_LABELS[dayIndex] || 'Hom nay',
        profile: profileRes.data || null,
        bodyMetrics: bodyMetricsRes.data || null,
        lifestyle: weekPlanRes.data || null,
        health: healthRes.data || null,
        todayStatus: todayStatusContext,
        actionLog: trackingActionLog,
        extraContext: coachDataContext,
        chatHistory: mergedChatHistory,
        exercises: targetWorkoutRows.map((row: any) => ({
          exercise_id: row.exercise_id,
          name: row.exercises?.name || null,
          sets: row.sets,
          reps: row.reps,
          rest_seconds: row.rest_seconds,
          weight_kg: row.weight_kg,
          body_part: row.exercises?.body_part || null,
          target_muscle: row.exercises?.target_muscle || null
        })),
        meals: targetMealRows.map((row: any) => ({
          id: row.id,
          meal_type: row.meal_type,
          food_id: row.food_id,
          name: row.foods?.name || null,
          quantity: row.quantity,
          calories: row.calories,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat
        }))
      });
    }

    const normalizedResponse: AIChatResponse = {
      ...aiResponse,
      intent: aiResponse.intent || intent,
      responseMode: aiResponse.responseMode || getResponseModeForIntent(aiResponse.intent || intent),
      confidence: aiResponse.confidence || confidence
    };
    detectedActionType = normalizedResponse.actionType;
    if (!AI_ACTION_FLOW_ENABLED) {
      normalizedResponse.actionRequired = false;
      normalizedResponse.actionType = null;
      normalizedResponse.actionPayload = null;
    }

    const userChatInsert = await supabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'user',
      content: normalizedMessage.slice(0, 3000),
      intent
    }).select('id').maybeSingle();
    if (userChatInsert.error) {
      console.warn('Failed to save user ai chat message:', userChatInsert.error.message);
    }

    const payloadValidation = normalizedResponse.actionType
      ? validateActionPayload(normalizedResponse.actionType, normalizedResponse.actionPayload)
      : { valid: true };
    if (!payloadValidation.valid) {
      normalizedResponse.actionRequired = false;
      normalizedResponse.actionType = null;
      normalizedResponse.actionPayload = null;
      normalizedResponse.reply = `Mình chưa thể áp dụng thay đổi tự động: ${payloadValidation.message}.`;
    }

    const assistantChatInsert = await supabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'assistant',
      content: String(normalizedResponse.reply || '').slice(0, 5000),
      intent: normalizedResponse.intent,
      confidence: normalizedResponse.confidence,
      action_type: normalizedResponse.actionType,
      action_payload: normalizedResponse.actionPayload
    }).select('id').maybeSingle();
    if (assistantChatInsert.error) {
      console.warn('Failed to save assistant ai chat message:', assistantChatInsert.error.message);
    }

    let adjustmentId: string | undefined;
    if (normalizedResponse.actionRequired && normalizedResponse.actionType) {
      incrementMetric('actionRequiredCount');
      const oldData = isMealIntent(normalizedResponse.intent)
        ? {
            weekly_food_plan_id: (todayMealRes.data as any)?.id || null,
            day_of_week: dayIndex,
            meal_items: targetMealRows.map((row: any) => ({
              id: row.id,
              meal_type: row.meal_type,
              food_id: row.food_id,
              name: row.foods?.name || null,
              quantity: row.quantity,
              calories: row.calories,
              protein: row.protein,
              carbs: row.carbs,
              fat: row.fat,
            })),
          }
        : {
            weekly_plan_id: (todayWorkoutRes.data as any)?.id || null,
            day_of_week: dayIndex,
            exercises: targetWorkoutRows.map((row: any) => ({
              exercise_id: row.exercise_id,
              name: row.exercises?.name || null,
              sets: row.sets,
              reps: row.reps,
              rest_seconds: row.rest_seconds,
              weight_kg: row.weight_kg,
            })),
          };
      const adjustmentInsert = await supabase.from('ai_plan_adjustments').insert({
        user_id: authUserId,
        plan_type: isMealIntent(normalizedResponse.intent) ? 'meal' : 'workout',
        source_type: 'chat',
        old_data: oldData,
        new_data: normalizedResponse.actionPayload,
        reason: normalizedMessage.slice(0, 300),
        created_by: 'ai',
        status: 'proposed',
        chat_message_id: assistantChatInsert.data?.id || null
      }).select('id').maybeSingle();
      if (adjustmentInsert.error) {
        console.warn('Failed to save proposed ai adjustment:', adjustmentInsert.error.message);
      } else {
        adjustmentId = adjustmentInsert.data?.id;
      }
    }

    success = true;
    return res.json({
      ...normalizedResponse,
      adjustmentId: adjustmentId || null
    });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_chat_failed',
      intent: detectedIntent,
      actionType: detectedActionType,
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-chat] failed traceId=${traceId}:`, error?.message || 'unknown_error');
    return res.status(500).json({ error: error?.message || 'Failed to process AI chat' });
  } finally {
    logAIEvent({
      event: 'ai_chat',
      intent: detectedIntent,
      actionType: detectedActionType,
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
});

app.post('/api/ai/coach-command', aiLimiter, async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const command = String(req.body?.command || '').replace(/^\//, '').trim().toLowerCase();
    if (!command) {
      return res.status(400).json({ error: 'command is required' });
    }

    const result = await executeCoachCommand({
      userId: authUserId,
      command,
      amountMl: req.body?.amountMl,
      sleepHours: req.body?.sleepHours,
    });

    const userCommandText = req.body?.amountMl
      ? `/water +${Math.round(Number(req.body.amountMl))}ml`
      : req.body?.sleepHours
        ? `/sleep ${Number(req.body.sleepHours)}h`
        : `/${command}`;

    if (!result.clearHistory) {
      const userInsert = await supabase.from('ai_chat_messages').insert({
        user_id: authUserId,
        role: 'user',
        content: userCommandText.slice(0, 3000),
        intent: 'view_day_plan'
      });
      if (userInsert.error) {
        console.warn('Failed to save user coach command:', userInsert.error.message);
      }
    }

    const assistantInsert = await supabase.from('ai_chat_messages').insert({
      user_id: authUserId,
      role: 'assistant',
      content: String(result.reply || '').slice(0, 5000),
      intent: 'view_day_plan',
      confidence: 1
    });
    if (assistantInsert.error) {
      console.warn('Failed to save assistant coach command:', assistantInsert.error.message);
    }

    return res.json(result);
  } catch (error: any) {
    console.error('[ai-coach-command] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to process coach command' });
  }
});

app.post('/api/ai/apply-adjustment', aiLimiter, async (req, res) => {
  const startedAt = Date.now();
  const traceId = `ai-apply-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  try {
    authUserId = await getAuthUserId(req);
    const { adjustmentId } = req.body || {};
    const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adjustmentId) {
      return res.status(400).json({ error: 'adjustmentId is required' });
    }
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Idempotency-Key header is required' });
    }

    const adjustmentRes = await supabase
      .from('ai_plan_adjustments')
      .select('*')
      .eq('id', adjustmentId)
      .eq('user_id', authUserId)
      .maybeSingle();
    if (adjustmentRes.error) throw adjustmentRes.error;
    if (!adjustmentRes.data) return res.status(404).json({ error: 'Adjustment not found' });
    if (adjustmentRes.data.status === 'applied') return res.json({ success: true, adjustmentId, alreadyApplied: true });
    if (adjustmentRes.data.apply_idempotency_key && adjustmentRes.data.apply_idempotency_key !== idempotencyKey) {
      return res.status(409).json({ error: 'Adjustment already processed with another idempotency key' });
    }
    if (adjustmentRes.data.status !== 'proposed') {
      return res.status(409).json({ error: `Adjustment is already ${adjustmentRes.data.status}` });
    }

    const newData = adjustmentRes.data.new_data || {};
    const oldData = adjustmentRes.data.old_data || {};
    const actionType = adjustmentRes.data.plan_type === 'meal' ? 'replace_today_meal' : 'replace_today_workout';
    const payloadValidation = validateActionPayload(actionType, newData);
    if (!payloadValidation.valid) {
      return res.status(400).json({ error: payloadValidation.message || 'Invalid action payload' });
    }
    const dayOfWeek = Number(newData.day_of_week);

    if (adjustmentRes.data.plan_type === 'workout') {
      const requestedWorkoutPlanId = String((oldData as any).weekly_plan_id || '').trim();
      const planQuery = requestedWorkoutPlanId
        ? supabase
            .from('weekly_plans')
            .select('id, week_start_date')
            .eq('id', requestedWorkoutPlanId)
            .eq('user_id', authUserId)
            .maybeSingle()
        : supabase
            .from('weekly_plans')
            .select('id, week_start_date')
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
      const planRes = await planQuery;
      if (planRes.error) throw planRes.error;
      if (!planRes.data?.id) {
        return res.status(404).json({
          error: requestedWorkoutPlanId ? 'Original workout plan not found for user' : 'Active workout plan not found'
        });
      }
      const workoutPlanId = planRes.data.id;
      const workoutWeekStartKey = DATE_KEY_REGEX.test(String(planRes.data.week_start_date || ''))
        ? String(planRes.data.week_start_date)
        : getWeekStartKey(new Date(`${getVietnamDateKey()}T00:00:00`));
      const targetLogDate = getDateKeyFromWeekStartAndDayIndex(workoutWeekStartKey, dayOfWeek);

      const exercises = Array.isArray(newData.exercises) ? newData.exercises : [];
      const exerciseIds: string[] = [...new Set<string>(
        exercises
          .map((item: any) => String(item?.exercise_id || '').trim())
          .filter((id: string) => Boolean(id))
      )];
      const latestBodyMetricsRes = await supabase
        .from('body_metrics')
        .select('weight')
        .eq('user_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestBodyMetricsRes.error) throw latestBodyMetricsRes.error;
      const bodyWeightKg = Math.max(40, Number(latestBodyMetricsRes.data?.weight) || 70);
      const validExercisesRes = await supabase
        .from('exercises')
        .select('id, calories_per_minute')
        .in('id', exerciseIds);
      if (validExercisesRes.error) throw validExercisesRes.error;
      const exerciseMetaById = new Map<string, any>((validExercisesRes.data || []).map((item: any) => [String(item.id), item]));
      const existingExerciseIds = new Set<string>((validExercisesRes.data || []).map((item: any) => String(item.id)));
      const missingExerciseIds = exerciseIds.filter((id) => !existingExerciseIds.has(id));
      if (missingExerciseIds.length > 0) {
        return res.status(400).json({ error: `Invalid exercise_id: ${missingExerciseIds.join(', ')}` });
      }

      const rows = exercises
        .map((item: any, index: number) => {
          const exerciseId = String(item.exercise_id || '').trim();
          if (!exerciseId) return null;
          const plannedSets = Math.max(1, Number(item.sets || 2));
          const plannedReps = String(item.reps || '8-10').slice(0, 20);
          const plannedWeightKg = Math.max(0, Number(item.weight_kg || 0));
          const plannedRestSeconds = Math.max(30, Number(item.rest_seconds || 60));
          return buildDailyExerciseSessionRow({
            userId: String(authUserId),
            logDate: targetLogDate,
            exerciseId,
            orderIndex: index,
            plannedSets,
            plannedReps,
            plannedWeightKg,
            plannedRestSeconds,
            targetRpe: Math.max(5, Math.min(10, Number(item.target_rpe) || 7)),
            estimatedKcal: estimatePlannedExerciseKcal({
              exercise: exerciseMetaById.get(exerciseId),
              bodyWeightKg,
              sets: plannedSets,
              repsText: plannedReps,
              weightKg: plannedWeightKg,
              restSeconds: plannedRestSeconds
            }),
            loadAdjustmentNote: String(item.load_instruction || item.note || '').slice(0, 160) || null
          });
        })
        .filter(Boolean) as any[];

      const existingDailyRes = await supabase
        .from('daily_exercise_sessions')
        .select('id, is_completed')
        .eq('user_id', authUserId)
        .eq('log_date', targetLogDate);
      if (existingDailyRes.error) throw existingDailyRes.error;
      const hasStartedWorkout = (existingDailyRes.data || []).some((item: any) => !!item.is_completed);
      if (hasStartedWorkout) {
        return res.status(409).json({ error: 'Workout for this day has already started. Please adjust it inside the workout session.' });
      }

      if ((existingDailyRes.data || []).length > 0) {
        const removeDailyRes = await supabase
          .from('daily_exercise_sessions')
          .delete()
          .eq('user_id', authUserId)
          .eq('log_date', targetLogDate);
        if (removeDailyRes.error) throw removeDailyRes.error;
      }

      if (rows.length > 0) {
        const addDailyRes = await supabase.from('daily_exercise_sessions').insert(rows);
        if (addDailyRes.error) throw addDailyRes.error;
      }

      const dailyWorkoutSessionRes = await supabase
        .from('daily_workout_sessions')
        .select('id, status')
        .eq('user_id', authUserId)
        .eq('log_date', targetLogDate)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dailyWorkoutSessionRes.error) throw dailyWorkoutSessionRes.error;

      if (dailyWorkoutSessionRes.data?.status === 'completed') {
        return res.status(409).json({ error: 'Workout session for this day is already completed.' });
      }

      const estimatedDuration = Math.max(10, rows.reduce((sum: number, item: any) => sum + Math.max(1, Number(item.sets) || 1), 0) * 2);
      let dailyWorkoutSessionId = String(dailyWorkoutSessionRes.data?.id || '').trim();

      if (!dailyWorkoutSessionId) {
        const createDailyWorkoutSessionRes = await supabase
          .from('daily_workout_sessions')
          .insert({
            user_id: authUserId,
            weekly_plan_id: workoutPlanId,
            log_date: targetLogDate,
            title: `Buổi tập ${targetLogDate}`,
            duration_minutes: estimatedDuration,
            calories_burned: 0,
            status: 'planned'
          })
          .select('id')
          .single();
        if (createDailyWorkoutSessionRes.error) throw createDailyWorkoutSessionRes.error;
        dailyWorkoutSessionId = String(createDailyWorkoutSessionRes.data?.id || '');
      } else {
        const updateDailyWorkoutSessionRes = await supabase
          .from('daily_workout_sessions')
          .update({
            weekly_plan_id: workoutPlanId,
            title: `Buổi tập ${targetLogDate}`,
            duration_minutes: estimatedDuration,
            status: 'planned'
          })
          .eq('id', dailyWorkoutSessionId);
        if (updateDailyWorkoutSessionRes.error) throw updateDailyWorkoutSessionRes.error;
      }

      if (dailyWorkoutSessionId) {
        const removeDailyWorkoutExerciseRes = await supabase
          .from('daily_workout_session_exercises')
          .delete()
          .eq('session_id', dailyWorkoutSessionId);
        if (removeDailyWorkoutExerciseRes.error) throw removeDailyWorkoutExerciseRes.error;

        if (rows.length > 0) {
          const workoutSessionExerciseRows = rows.map((item: any) => ({
            session_id: dailyWorkoutSessionId,
            daily_exercise_session_id: null,
            weekly_plan_exercise_id: null,
            exercise_id: item.exercise_id,
            sets: item.sets,
            reps: item.reps,
            weight_kg: item.weight_kg,
            rest_seconds: item.rest_seconds,
            order_index: item.order_index,
            is_completed: false,
            planned_sets: item.planned_sets,
            planned_reps: item.planned_reps,
            planned_weight_kg: item.planned_weight_kg,
            planned_rest_seconds: item.planned_rest_seconds,
            actual_sets: item.actual_sets,
            actual_reps: item.actual_reps,
            actual_weight_kg: item.actual_weight_kg,
            actual_rest_seconds: item.actual_rest_seconds,
            target_rpe: item.target_rpe,
            estimated_kcal: item.estimated_kcal,
            actual_kcal_estimated: item.actual_kcal_estimated,
            completed_sets: item.completed_sets
          }));
          const addDailyWorkoutExerciseRes = await supabase
            .from('daily_workout_session_exercises')
            .insert(workoutSessionExerciseRows);
          if (addDailyWorkoutExerciseRes.error) throw addDailyWorkoutExerciseRes.error;
        }
      }
    } else if (adjustmentRes.data.plan_type === 'meal') {
      const requestedFoodPlanId = String((oldData as any).weekly_food_plan_id || '').trim();
      const planQuery = requestedFoodPlanId
        ? supabase
            .from('weekly_food_plans')
            .select('id')
            .eq('id', requestedFoodPlanId)
            .eq('user_id', authUserId)
            .maybeSingle()
        : supabase
            .from('weekly_food_plans')
            .select('id')
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
      const planRes = await planQuery;
      if (planRes.error) throw planRes.error;
      if (!planRes.data?.id) {
        return res.status(404).json({
          error: requestedFoodPlanId ? 'Original meal plan not found for user' : 'Active meal plan not found'
        });
      }
      const foodPlanId = planRes.data.id;

      const mealType = String(newData.meal_type || 'dinner');
      const oldWeeklyFoodItemId = String(newData.old_weekly_food_item_id || '');
      const newFoodId = String(newData.new_food_id || '');
      const existingMealRes = await supabase
        .from('weekly_food_items')
        .select('id, order_index')
        .eq('food_plan_id', foodPlanId)
        .eq('id', oldWeeklyFoodItemId)
        .maybeSingle();
      if (existingMealRes.error) throw existingMealRes.error;
      if (!existingMealRes.data?.id) {
        return res.status(404).json({ error: 'Original meal item not found' });
      }

      const foodRes = await supabase
        .from('foods')
        .select('id, calories, protein, carbs, fat')
        .eq('id', newFoodId)
        .maybeSingle();
      if (foodRes.error) throw foodRes.error;
      if (!foodRes.data?.id) {
        return res.status(400).json({ error: 'new_food_id does not exist' });
      }

      const updateMealRes = await supabase
        .from('weekly_food_items')
        .update({
          day_of_week: dayOfWeek,
          meal_type: mealType,
          food_id: newFoodId,
          quantity: Math.max(0.25, Number(newData.quantity || 1)),
          calories: Number(foodRes.data.calories || 0),
          protein: Number(foodRes.data.protein || 0),
          carbs: Number(foodRes.data.carbs || 0),
          fat: Number(foodRes.data.fat || 0),
          is_rest_day: false
        })
        .eq('food_plan_id', foodPlanId)
        .eq('id', oldWeeklyFoodItemId);
      if (updateMealRes.error) throw updateMealRes.error;
    }

    const updateRes = await supabase
      .from('ai_plan_adjustments')
      .update({
        status: 'applied',
        applied_at: new Date().toISOString(),
        apply_idempotency_key: idempotencyKey
      })
      .eq('id', adjustmentId)
      .eq('user_id', authUserId)
      .eq('status', 'proposed')
      .select('id')
      .maybeSingle();
    if (updateRes.error) throw updateRes.error;
    if (!updateRes.data?.id) {
      return res.status(409).json({ error: 'Adjustment is not in proposed status' });
    }

    success = true;
    return res.json({ success: true, adjustmentId });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_apply_failed',
      actionType: 'apply_adjustment',
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-apply] failed traceId=${traceId}:`, error?.message || 'unknown_error');
    return res.status(500).json({ error: error?.message || 'Failed to apply adjustment' });
  } finally {
    logAIEvent({
      event: 'ai_apply',
      actionType: 'apply_adjustment',
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
});

app.post('/api/ai/reject-adjustment', aiLimiter, async (req, res) => {
  const startedAt = Date.now();
  const traceId = `ai-reject-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  try {
    authUserId = await getAuthUserId(req);
    const { adjustmentId } = req.body || {};
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adjustmentId) {
      return res.status(400).json({ error: 'adjustmentId are required' });
    }

    const updateRes = await supabase
      .from('ai_plan_adjustments')
      .update({
        status: 'rejected',
        rejected_at: new Date().toISOString()
      })
      .eq('id', adjustmentId)
      .eq('user_id', authUserId)
      .eq('status', 'proposed')
      .select('id')
      .maybeSingle();

    if (updateRes.error) throw updateRes.error;
    if (!updateRes.data?.id) {
      return res.status(409).json({ error: 'Adjustment is not in proposed status' });
    }
    success = true;
    return res.json({ success: true, adjustmentId });
  } catch (error: any) {
    incrementMetric('errorCount');
    logAIEvent({
      event: 'ai_reject_failed',
      actionType: 'reject_adjustment',
      success: false,
      traceId,
      latencyMs: Date.now() - startedAt
    });
    console.error(`[ai-reject] failed traceId=${traceId}:`, error?.message || 'unknown_error');
    return res.status(500).json({ error: error?.message || 'Failed to reject adjustment' });
  } finally {
    logAIEvent({
      event: 'ai_reject',
      actionType: 'reject_adjustment',
      success,
      traceId,
      latencyMs: Date.now() - startedAt
    });
  }
});

app.get('/api/ai/metrics', async (req, res) => {
  const authUserId = await getAuthUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const isAdmin = await isAdminUser(authUserId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.json({
    success: true,
    data: snapshotAIMetrics(),
    actionFlowEnabled: AI_ACTION_FLOW_ENABLED
  });
});

app.post('/api/generate-plan', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    const { prompt } = req.body || {};

    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'Noi dung yeu cau (prompt) khong duoc de trong.' });
    }
    if (String(prompt).length > 4000) {
      return res.status(400).json({ error: 'Prompt qua dai. Gioi han 4000 ky tu.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Thieu GEMINI_API_KEY trong cau hinh server. Vui long kiem tra file .env' });
    }

    let userContext = '';

    if (authUserId) {
      const [profile, bodyMetrics, lifestyle, health] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', authUserId).single(),
        supabase.from('body_metrics').select('*').eq('user_id', authUserId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
        supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle()
      ]);

      const weeklyWorkoutDays = resolveWeeklyWorkouts(lifestyle.data?.activity_level, lifestyle.data?.weekly_workouts);

      userContext = `
Thong tin cuc ky chi tiet cua nguoi dung can duoc ca nhan hoa:
1. Thong tin co ban: ${profile.data?.full_name || 'Khong ro'} | Gioi tinh: ${profile.data?.gender || 'Khong ro'} | Tuoi/Nam sinh: ${profile.data?.birthday || 'Khong ro'}
2. Chi so co the & Voc dang: Can nang hien tai: ${bodyMetrics.data?.weight || '?'} kg | Chieu cao: ${bodyMetrics.data?.height || '?'} cm | Muc tieu muon dat: ${bodyMetrics.data?.target_weight || '?'} kg.
   Vong nguc: ${bodyMetrics.data?.chest || '?'} cm | Vong eo: ${bodyMetrics.data?.waist || '?'} cm | Vong mong: ${bodyMetrics.data?.hips || '?'} cm | Ty le mo (Body Fat): ${bodyMetrics.data?.body_fat || '?'}%.
3. Loi song & Thoi quen tap luyen:
   - Mong muon/Muc tieu: ${lifestyle.data?.fitness_goal || 'Tap luyen nang cao suc khoe'}.
   - Trinh do tap: ${lifestyle.data?.experience_level || 'Khong ro'} | Tan suat tap mong muon: ${lifestyle.data?.activity_level || 'Khong ro'} (${weeklyWorkoutDays} ngay/tuan).
   - Dia diem tap: ${lifestyle.data?.workout_location || 'Khong ro'} | Dung cu co san: ${lifestyle.data?.equipment_available || 'Khong ro'}.
   - Thoi gian ranh moi buoi: ${lifestyle.data?.workout_duration || '?'} phut | Hay tap luc: ${lifestyle.data?.workout_time || 'Bat ky'}.
   - LUU Y QUAN TRONG: Khi lap ke hoach tap luyen theo tuan, phan bo dung ${weeklyWorkoutDays} ngay tap va cac ngay con lai la ngay nghi/phuc hoi.
4. Dinh duong:
   - Che do an uu tien: ${lifestyle.data?.diet_preference || 'Binh thuong'} | Che do an hien tai: ${lifestyle.data?.current_diet || 'Khong ro'}.
   - Kha nang tu nau an: ${lifestyle.data?.cooking_ability || 'Khong ro'} | Tai chinh (Budget): ${lifestyle.data?.budget_level || 'Binh thuong'}.
   - Muc tieu nuoc uong: ${lifestyle.data?.daily_water_goal || 2} lit/ngay.
   - Di ung thuc pham: ${health.data?.allergies || 'Khong co'}.
5. Y te & Tinh than:
   - Benh ly nen: ${health.data?.health_condition || 'Hoan toan khoe manh'}.
   - Chan thuong: ${health.data?.injuries || 'Khong bi chan thuong'}.
   - Dang dung thuoc: ${health.data?.medications || 'Khong'}.
   - Thoi quen hut thuoc/uong ruou: ${health.data?.smoke_drink || 'Khong'}.
   - Muc do stress: ${health.data?.stress_level || 'Binh thuong'} | Giac ngu trung binh: ${health.data?.sleep_hours || 7} tieng/ngay.

Day la day du ho so cua nguoi dung lay truc tiep tu Database he thong (dua theo form khao sat ho da dien). Hay dung cac thong tin nay nhu mot chuyen gia de lap ke hoach chi tiet, chinh xac 100% phu hop voi tui tien, benh ly, va so do cua ho:

Hay dua vao cac thong tin ca nhan cuc ky chi tiet tren de lap ke hoach hoac tra loi yeu cau sau mot cach chinh xac va phu hop the trang nhat:
`;
    }

    const finalPrompt = `${userContext}\nYeu cau cua nguoi dung: ${prompt}`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const response = await model.generateContent(finalPrompt);
    const text = response.response.text();

    res.json({ success: true, data: text });
  } catch (error: any) {
    console.error('[generate-plan] failed:', error?.message || 'unknown_error');
    res.status(500).json({ error: 'Da co loi xay ra khi goi AI.' });
  }
});

app.post('/api/ai-coach/generate-weekly-plan', aiLimiter, async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { weekStartDate } = req.body || {};
    const userId = authUserId;
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'Missing GROQ_API_KEY in server config' });
    }

    const weekStartKey = weekStartDate || getWeekStartKey(new Date(`${getVietnamDateKey()}T00:00:00`));

    const [
      profileRes,
      bodyMetricsRes,
      lifestyleRes,
      healthRes,
      exerciseCatalogRes,
      foodCatalogRes,
      recentSessionsRes,
      recentMealsRes
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, equipment, difficulty, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
        .limit(80),
      supabase
        .from('foods')
        .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare')
        .limit(100),
      supabase
        .from('daily_exercise_sessions')
        .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .limit(20),
      supabase
        .from('weekly_food_items')
        .select('day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, weekly_food_plans!inner(user_id), foods:food_id(name, category)')
        .eq('weekly_food_plans.user_id', userId)
        .limit(20)
    ]);

    const firstError = [
      profileRes.error,
      bodyMetricsRes.error,
      lifestyleRes.error,
      healthRes.error,
      exerciseCatalogRes.error,
      foodCatalogRes.error,
      recentSessionsRes.error,
      recentMealsRes.error
    ].find(Boolean);
    if (firstError) throw firstError;

    const profile = profileRes.data || {};
    const bodyMetrics = bodyMetricsRes.data || {};
    const lifestyle = lifestyleRes.data || {};
    const health = healthRes.data || {};
    const exercises = clampList(exerciseCatalogRes.data as any[], 80);
    const foods = clampList(foodCatalogRes.data as any[], 100);
    const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const foodById = new Map(foods.map((item: any) => [String(item.id), item]));
    const weeklyWorkoutDays = resolveWeeklyWorkouts(lifestyle.activity_level, lifestyle.weekly_workouts);
    const mealsPerDay = resolveMealsPerDay(lifestyle.meals_per_day);
    const mealSlots = getMealSlotsForCount(mealsPerDay);
    const accessState = getAiCoachAccessState(profile);

    if (!profileRes.data?.id) {
      return res.status(403).json({
        code: 'PROFILE_REQUIRED',
        error: 'Vui long hoan thanh ho so de AI Coach co the tao lo trinh cho ban.'
      });
    }

    if (!accessState.canGenerate) {
      const error =
        accessState.freeUsedAt
          ? 'Ban Free da dung luot kich hoat AI Coach. Vui long nang cap Premium de tao lai khong gioi han.'
          : 'Thoi gian dung thu AI Coach mien phi da het. Vui long nang cap Premium de tiep tuc tao lo trinh.';

      return res.status(403).json({
        code: 'PREMIUM_REQUIRED',
        error,
        membershipTier: accessState.membershipTier,
        trialEndsAt: accessState.trialEndsAt?.toISOString() || null,
        freeUsedAt: accessState.freeUsedAt?.toISOString() || null
      });
    }

    const exerciseCatalog = exercises
      .map((item: any) => `${item.id}|${truncateText(item.name, 40)}|body=${truncateText(item.body_part, 16)}|target=${truncateText(item.target_muscle, 20)}|equipment=${truncateText(item.equipment, 18)}|level=${truncateText(item.difficulty, 14)}|goals=${truncateText((item.goal_type || []).join(','), 36)}|avoid=${truncateText((item.contraindications || []).join(','), 36)}|duration_s=${item.estimated_duration_seconds || ''}|kcal_min=${item.calories_per_minute || ''}|pattern=${truncateText(item.movement_pattern, 14)}`)
      .join('\n');

    const foodCatalog = foods
      .map((item: any) => `${item.id}|${truncateText(item.name, 36)}|cat=${truncateText(item.category, 18)}|kcal=${item.calories || 0}|p=${item.protein || 0}|c=${item.carbs || 0}|f=${item.fat || 0}|u=${truncateText(item.serving_unit || '100g', 12)}|meals=${truncateText((item.meal_type || []).join(','), 28)}|goals=${truncateText((item.goal_type || []).join(','), 32)}|allergens=${truncateText((item.allergens || []).join(','), 32)}|price=${truncateText(item.price_level, 12)}|cook_min=${item.cooking_time_minutes || ''}|region=${truncateText(item.region, 14)}|easy=${item.is_easy_to_prepare ?? ''}`)
      .join('\n');

    const recentTraining = clampList(recentSessionsRes.data as any[], 12)
      .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
      .join('\n') || 'No recent training history.';

    const recentEating = clampList(recentMealsRes.data as any[], 12)
      .map((item: any) => `d=${item.day_of_week}|${item.meal_type}|${truncateText(item.foods?.name || item.food_id, 28)}|qty=${item.quantity}`)
      .join('\n') || 'No recent meal plan history.';

    const prompt = `
Generate one personalized 7-day workout plan and 7-day meal plan.
Use only ids from EXERCISE_CATALOG and FOOD_CATALOG. Return valid JSON only.

USER_PROFILE:
name=${truncateText(profile.full_name, 40)}
gender=${truncateText(profile.gender, 12)}
birthday=${truncateText(profile.birthday, 20)}
job=${truncateText(profile.job, 30)}
weight_kg=${bodyMetrics.weight || ''}
height_cm=${bodyMetrics.height || ''}
target_weight_kg=${bodyMetrics.target_weight || ''}
body_fat=${bodyMetrics.body_fat || bodyMetrics.body_fat_percentage || ''}
fitness_goal=${truncateText(lifestyle.fitness_goal, 40)}
experience_level=${truncateText(lifestyle.experience_level, 20)}
activity_level=${truncateText(lifestyle.activity_level, 20)}
weekly_workouts=${weeklyWorkoutDays}
workout_duration_minutes=${lifestyle.workout_duration || ''}
workout_location=${truncateText(lifestyle.workout_location, 24)}
equipment_available=${truncateText(lifestyle.equipment_available, 60)}
diet_preference=${truncateText(lifestyle.diet_preference, 24)}
current_diet=${truncateText(lifestyle.current_diet, 24)}
cooking_ability=${truncateText(lifestyle.cooking_ability, 16)}
budget_level=${truncateText(lifestyle.budget_level, 16)}
meals_per_day=${mealsPerDay}
target_calories=${lifestyle.target_calories || ''}
water_goal_liters=${lifestyle.daily_water_goal || ''}
health_condition=${truncateText(health.health_condition, 80)}
injuries=${truncateText(health.injuries, 80)}
medications=${truncateText(health.medications, 60)}
sleep_hours=${health.sleep_hours || ''}
sleep_quality=${truncateText(health.sleep_quality, 20)}
stress_level=${truncateText(health.stress_level, 20)}
allergies_or_medical_history=${truncateText(health.medical_history || health.allergies, 120)}

RECENT_TRAINING:
${recentTraining}

RECENT_MEAL_PLAN:
${recentEating}

EXERCISE_CATALOG:
${exerciseCatalog}

FOOD_CATALOG:
${foodCatalog}

Rules:
- Exactly 7 days, day_of_week 0..6 where 0 is Monday.
- Never create new exercises or foods. Pick only exercise_id values from EXERCISE_CATALOG and food_id values from FOOD_CATALOG.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Prefer foods whose meal_type, goal_type, allergens, price_level, cooking_time_minutes and region match the user profile.
- Avoid foods whose allergens conflict with allergies_or_medical_history.
- Training days should match weekly_workouts. Rest days: is_rest_day=true and no exercises.
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction, order_index.
- weight_kg should be conservative. Use 0 for bodyweight.
- Avoid exercises that conflict with injuries, health conditions, location, or equipment.
- Each day must include exactly ${mealsPerDay} meals.
- Allowed meal slots for each day: ${mealSlots.join(', ')}.
- Do not add extra meals beyond those slots.
- Use reasonable quantity multipliers.

JSON schema (fixed):
{
  "workout_plan": {
    "plan_name": "Beginner Fat Loss - Week 1",
    "goal": "fat_loss",
    "days": [
      {
        "day": "Monday",
        "type": "workout",
        "duration_minutes": 25,
        "exercises": [
           {
             "exercise_id": "exact id from catalog",
             "sets": 3,
             "reps": 12,
             "weight_kg": 12.5,
             "rest_seconds": 60,
             "target_rpe": 7,
             "load_instruction": "chon muc ta con du 2 reps",
             "note": "short coaching note"
           }
        ]
      }
    ],
    "explanation": "short explanation in Vietnamese"
  },
  "meal_plan": {
    "target_calories": 1800,
    "days": [
      {
        "day": "Monday",
        "meals": [
          {
            "meal_type": "breakfast",
            "food_ids": ["exact id from catalog"],
            "total_calories": 420
          }
        ]
      }
    ],
    "explanation": "short explanation in Vietnamese"
  }
}
`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.35,
        max_tokens: 2800,
        response_format: { type: 'json_object' }
      })
    });

    const groqResult: any = await groqResponse.json();
    if (!groqResponse.ok || groqResult.error) {
      throw new Error(groqResult?.error?.message || 'Groq AI request failed');
    }

    const parsed = parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || '');
    const normalizedPlan = normalizeAiPlanPayload(parsed);

    const existingWorkoutPlans = await supabase
      .from('weekly_plans')
      .select('id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .limit(20);
    if (existingWorkoutPlans.error) throw existingWorkoutPlans.error;

    const previousWorkoutPlanId = pickLatestByUpdatedAt(existingWorkoutPlans.data as any[])?.id || null;
    const createdWorkoutPlan = await supabase
      .from('weekly_plans')
      .insert({
        user_id: userId,
        name: normalizedPlan.workoutPlan.plan_name || 'AI Coach Week Plan',
        description: normalizedPlan.workoutPlan.explanation || '',
        week_start_date: weekStartKey,
        plan_status: 'active',
        generated_by: 'ai',
        ai_explanation: truncateText(normalizedPlan.workoutPlan.explanation || '', 500)
      })
      .select('id')
      .single();
    if (createdWorkoutPlan.error) throw createdWorkoutPlan.error;
    const weeklyPlanId = createdWorkoutPlan.data.id;

    if (previousWorkoutPlanId) {
      const markOldWorkoutPlan = await supabase
        .from('weekly_plans')
        .update({ plan_status: 'adjusted', updated_at: new Date().toISOString() })
        .eq('id', previousWorkoutPlanId);
      if (markOldWorkoutPlan.error) throw markOldWorkoutPlan.error;
    }

    const workoutRows: any[] = [];
    for (const day of normalizedPlan.workoutPlan.days || []) {
      const dayIndex = Math.max(0, Math.min(6, Number(day.day_of_week) || 0));
      if (day.is_rest_day || !Array.isArray(day.exercises) || day.exercises.length === 0) {
        workoutRows.push({
          weekly_plan_id: weeklyPlanId,
          day_of_week: dayIndex,
          exercise_id: null,
          sets: 0,
          reps: '0',
          weight_kg: 0,
          rest_seconds: 0,
          order_index: 0,
          is_rest_day: true,
          planned_sets: 0,
          planned_reps: '0',
          planned_weight_kg: 0,
          planned_rest_seconds: 0,
          target_rpe: 0,
          estimated_kcal: 0,
          ai_note: null,
          load_instruction: null
        });
        continue;
      }

      day.exercises.forEach((item: any, index: number) => {
        const exerciseId = String(item.exercise_id || '');
        if (!exerciseIds.has(exerciseId)) return;
        workoutRows.push(
          buildWeeklyWorkoutPlanRow({
            weeklyPlanId,
            dayIndex,
            item: { ...item, exercise_id: exerciseId },
            orderIndex: index,
            exercise: exerciseById.get(exerciseId),
            bodyWeightKg: Number(bodyMetrics.weight || 70)
          })
        );
      });
    }
    if (workoutRows.length > 0) {
      const insertedWorkout = await supabase.from('weekly_plan_exercises').insert(workoutRows);
      if (insertedWorkout.error) throw insertedWorkout.error;
    }

    const existingFoodPlans = await supabase
      .from('weekly_food_plans')
      .select('id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .limit(20);
    if (existingFoodPlans.error) throw existingFoodPlans.error;

    const previousFoodPlanId = pickLatestByUpdatedAt(existingFoodPlans.data as any[])?.id || null;
    const createdFoodPlan = await supabase
      .from('weekly_food_plans')
      .insert({
        user_id: userId,
        name: 'AI Coach Meal Plan',
        week_start_date: weekStartKey,
        plan_status: 'active',
        generated_by: 'ai',
        ai_explanation: truncateText(normalizedPlan.mealPlan.explanation || '', 500)
      })
      .select('id')
      .single();
    if (createdFoodPlan.error) throw createdFoodPlan.error;
    const foodPlanId = createdFoodPlan.data.id;

    if (previousFoodPlanId) {
      const markOldFoodPlan = await supabase
        .from('weekly_food_plans')
        .update({ plan_status: 'adjusted', updated_at: new Date().toISOString() })
        .eq('id', previousFoodPlanId);
      if (markOldFoodPlan.error) throw markOldFoodPlan.error;
    }

    const mealRows: any[] = [];
    const allowedMealTypes = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
    for (const day of normalizedPlan.mealPlan.days || []) {
      const dayIndex = Math.max(0, Math.min(6, Number(day.day_of_week) || 0));
      if (day.is_rest_day && (!Array.isArray(day.meals) || day.meals.length === 0)) {
        mealRows.push({
          food_plan_id: foodPlanId,
          day_of_week: dayIndex,
          meal_type: 'breakfast',
          is_rest_day: true,
          order_index: 0
        });
        continue;
      }

      const expandedMeals = (day.meals || []).flatMap((meal: any) => {
        const foodIds = Array.isArray(meal.food_ids) ? meal.food_ids : [];
        return foodIds.map((foodId: string, idx: number) => ({
          meal_type: meal.meal_type,
          food_id: foodId,
          quantity: 1,
          order_index: idx
        }));
      });
      const normalizedMeals = normalizeDayMeals(expandedMeals, mealsPerDay, foodById);
      normalizedMeals.forEach((item: any, index: number) => {
        const foodId = String(item.food_id || '');
        const food = foodById.get(foodId);
        if (!food) return;
        const quantity = Math.max(0.25, Math.min(6, Number(item.quantity) || 1));
        const mealType = allowedMealTypes.has(String(item.meal_type)) ? String(item.meal_type) : 'lunch';
        mealRows.push({
          food_plan_id: foodPlanId,
          day_of_week: dayIndex,
          meal_type: mealType,
          food_id: foodId,
          quantity,
          calories: Number(food.calories || 0),
          protein: Number(food.protein || 0),
          carbs: Number(food.carbs || 0),
          fat: Number(food.fat || 0),
          order_index: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
          is_rest_day: false
        });
      });
    }
    if (mealRows.length > 0) {
      const insertedMeals = await supabase.from('weekly_food_items').insert(mealRows);
      if (insertedMeals.error) throw insertedMeals.error;
    }

    const recommendation = await supabase.from('ai_recommendations').insert({
      user_id: userId,
      plan_type: 'weekly_coach_plan',
      recommendation_content: normalizedPlan,
      status: 'active'
    });
    if (recommendation.error) console.warn('Failed to store ai_recommendations:', recommendation.error.message);

    if (previousWorkoutPlanId || previousFoodPlanId) {
      const planType = previousWorkoutPlanId && previousFoodPlanId ? 'both'
        : previousWorkoutPlanId ? 'workout' : 'meal';
      const adjustment = await supabase.from('ai_plan_adjustments').insert({
        user_id: userId,
        plan_type: planType,
        source_type: 'ai_coach_generate',
        old_plan_id: previousWorkoutPlanId || previousFoodPlanId,
        new_plan_id: weeklyPlanId,
        old_data: {
          workout_plan_id: previousWorkoutPlanId,
          food_plan_id: previousFoodPlanId
        },
        new_data: {
          workout_plan_id: weeklyPlanId,
          food_plan_id: foodPlanId,
          workout_plan_name: normalizedPlan.workoutPlan.plan_name,
          target_calories: normalizedPlan.mealPlan.target_calories
        },
        reason: truncateText(
          normalizedPlan.workoutPlan.explanation || normalizedPlan.mealPlan.explanation || 'AI regenerated plan.',
          300
        ),
        created_by: 'ai'
      });
      if (adjustment.error) {
        console.warn('Failed to store ai_plan_adjustments:', adjustment.error.message);
      }
    }

    if (accessState.membershipTier !== 'premium' && !accessState.freeUsedAt) {
      const freeUsageUpdate = await supabase
        .from('profiles')
        .update({
          ai_coach_free_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      if (freeUsageUpdate.error) {
        console.warn('Failed to mark AI Coach free usage:', freeUsageUpdate.error.message);
      }
    }

    return res.json({
      success: true,
      data: {
        weeklyPlanId,
        foodPlanId,
        workoutItems: workoutRows.length,
        mealItems: mealRows.length,
        weekStartDate: weekStartKey,
        membershipTier: accessState.membershipTier,
        ai_json: {
          workout_plan: normalizedPlan.workoutPlan,
          meal_plan: normalizedPlan.mealPlan
        }
      }
    });
  } catch (error: any) {
    console.error('[ai-coach-generate] failed:', error?.message || 'unknown_error');
    return res.status(500).json({ error: error?.message || 'Failed to generate AI Coach plan' });
  }
});

app.post('/api/telegram/link-token', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profileRes = await supabase
      .from('profiles')
      .select('id')
      .eq('id', authUserId)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data?.id) {
      return res.status(404).json({ error: 'Profile khong ton tai' });
    }

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'fitlyforbot';
    const token = createTelegramLinkToken(authUserId);
    return res.json({
      success: true,
      token,
      telegramLink: `https://t.me/${botUsername}?start=${token}`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.get('/api/telegram/status', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const isAdmin = await isAdminUser(authUserId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const status = await getTelegramReminderStatus();
    res.json({ success: true, data: status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post('/api/telegram/test-reminders', async (req, res) => {
  if (!hasValidCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!telegramBot) {
    return res.status(503).json({ error: 'Telegram bot chua duoc cau hinh' });
  }

  try {
    const type = String(req.query.type || 'all');
    const result: Record<string, unknown> = {};
    if (type === 'water' || type === 'all') {
      result.water = await sendWaterReminders(telegramBot, 0);
    }
    if (type === 'sleep' || type === 'all') {
      result.sleep = await sendSleepReminders(telegramBot);
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

app.post('/api/ai-coach/run-premium-auto-weekly', async (req, res) => {
  try {
    if (!hasValidCronSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await runPremiumMondayAutoPlanner('manual');
    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[premium-auto-planner] Manual trigger failed:', error?.message || 'unknown_error');
    return res.status(500).json({ error: error?.message || 'Failed to run premium auto planner' });
  }
});

app.get('/api/telegram/check-profile/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const isAdmin = await isAdminUser(authUserId);
    if (!isAdmin && authUserId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, telegram_chat_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!profile) {
      return res.json({
        success: false,
        error: 'Profile khong ton tai'
      });
    }

    return res.json({
      success: true,
      profile: {
        id: profile.id,
        telegram_linked: !!profile.telegram_chat_id
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

schedulePremiumMondayAutoPlanner();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!telegramBot) {
    console.warn('Telegram bot chua khoi dong; vui long kiem tra TELEGRAM_BOT_TOKEN.');
  }
});
