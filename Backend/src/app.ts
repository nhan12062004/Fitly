import express, { type RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { adminSupabase, supabase } from './config/Supabase';
import { requireAuth } from './auth/middleware';
import { type TrainingPrescription } from './lib/TrainingPrescription';
import { synchronizeTrainingProfileContext } from './services/trainingProfileContextService';
import { detectIntent, extractDayIndexFromText, getResponseModeForIntent, normalizeVietnameseText as normalizeVietForChat } from './services/ai/aiRouterService';
import { aiChatService } from './services/ai/aiChatService';
import { aiPlannerService } from './services/ai/aiPlannerService';
import { workoutAdjusterService } from './services/ai/workoutAdjusterService';
import { mealAdjusterService } from './services/ai/mealAdjusterService';
import { progressAnalyzerService } from './services/ai/progressAnalyzerService';
import { AIChatContext, AIChatResponse, AIIntent } from './services/ai/types';
import { WorkoutPrescription, estimateWorkoutKcal, prescribeWorkoutExercise } from './services/workoutPrescriptionService';
import { incrementMetric, logAIEvent, snapshotAIMetrics } from './lib/aiObservability';
import { validateActionPayload } from './services/ai/aiValidationService';
import { getAdjustmentApplyDecision } from './services/ai/adjustmentApplyGuard';
import { accountRouter } from './modules/account/accountRouter';
import { registerAdminRoutes } from './modules/admin/adminRoutes';
import { createAdminHandlers } from './modules/admin/adminHandlers';
import { registerAiCoachRoutes } from './modules/ai-coach/aiCoachRoutes';
import { createAiCoachHandlers } from './modules/ai-coach/aiCoachHandlers';
import { registerNutritionRoutes } from './modules/nutrition/nutritionRoutes';
import { createNutritionHandlers } from './modules/nutrition/nutritionHandlers';
import { registerWorkoutRoutes } from './modules/workout/workoutRoutes';
import { createWorkoutHandlers } from './modules/workout/workoutHandlers';
import {
  buildSafetyPromptAddendum,
  getFoodSafetyDecision,
  sanitizeWorkoutPlanForUser,
} from './services/ai/personalizationGuardService';
import {
  buildExerciseEligibilityContext,
  getExerciseEligibilityDecision,
  getEligibleExercises,
  rankExercises,
  validateExerciseProposal,
} from './services/exerciseCatalogService';
import {
  buildMealPlanningCatalog,
  calculateNutritionMacroTargets,
  classifyMealFoodComponent,
  completeAiMealDay,
  getMealSlotsForCount as getMealPlanningSlots,
  isMealFoodEligible,
  optimizeMealPlanQuantities,
  resolveMealsPerDay as resolveMealPlanningMealsPerDay,
} from './services/mealPlanningService';
import {
  buildCompactRecipeCatalog,
  buildRecipeEligibilityContext,
  filterEligibleRecipes,
  sanitizeAndBalanceRecipeProposal,
  validateRecipeMealProposal,
  type RecipeCandidate,
} from './services/recipeEligibilityService';
import {
  type ExerciseInstructions,
  isExerciseId,
  normalizeBodyPart,
  normalizeDifficulty,
  normalizeEquipment,
  normalizeExerciseInstructions,
  normalizeGoalType,
  normalizeMovementPattern,
  normalizeTrainingLocation,
} from '../../shared/exerciseCatalog';
import { normalizeAllergies } from '../../shared/dietaryPreferences';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from './http/errorHandler';
import { ExternalProviderError, InternalConfigurationError, ValidationError } from './http/errors';
import { legacyErrorContractMiddleware } from './http/legacyErrorContract';
import { requestIdMiddleware } from './http/requestId';
import { logOperational } from './lib/operationalLogger';
import { validateBody } from './http/validation';
import {
  normalizeRecipe,
  normalizeRecipeIngredient,
  validateRecipe,
  type RecipeIngredientWithFood,
} from '../../shared/recipeCatalog';
import {
  buildCoachDataContext,
  buildTodayStatus,
  executeCoachCommand,
  processNaturalTracking,
} from './services/coachCommandService';

dotenv.config();

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const AI_ACTION_FLOW_ENABLED = process.env.AI_ACTION_FLOW_ENABLED !== 'false';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AI_EXERCISE_CATALOG_LIMIT = 48;
const AI_EXERCISE_CATALOG_FETCH_LIMIT = 500;
const AI_FOOD_CATALOG_LIMIT = 72;
const AI_FOOD_CATALOG_FETCH_LIMIT = 320;
const DEFAULT_READY_TIMEOUT_MS = 3000;
const MIN_READY_TIMEOUT_MS = 10;
const MAX_READY_TIMEOUT_MS = 60_000;
type MembershipTier = 'free' | 'plus' | 'pro';
type AiQuotaKey = 'planGenerations' | 'workoutAdjustments' | 'mealAdjustments' | 'chatMessages';
const AI_QUOTAS_BY_TIER: Record<MembershipTier, Record<AiQuotaKey, number>> = {
  free: {
    planGenerations: 5,
    workoutAdjustments: 5,
    mealAdjustments: 5,
    chatMessages: 25
  },
  plus: {
    planGenerations: 4,
    workoutAdjustments: 30,
    mealAdjustments: 30,
    chatMessages: 200
  },
  pro: {
    planGenerations: 12,
    workoutAdjustments: 100,
    mealAdjustments: 100,
    chatMessages: 800
  }
};
const FREE_TRIAL_DAYS = 7;

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
const getDateKeyFromWeekStartAndDayIndex = (weekStartKey: string, dayIndex: number): string => {
  const safeDayIndex = Math.max(0, Math.min(6, Number(dayIndex) || 0));
  const baseDate = new Date(`${weekStartKey}T00:00:00`);
  return getVietnamDateKey(addDays(baseDate, safeDayIndex));
};

const getDayOffsetBetweenDateKeys = (startDateKey: string, endDateKey: string): number => {
  const start = Date.parse(`${startDateKey}T00:00:00Z`);
  const end = Date.parse(`${endDateKey}T00:00:00Z`);
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
};

const getDayIndexFromDateKey = (dateKey: string): number => {
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
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

type AiExerciseCatalog = {
  text: string;
  referenceIds: Map<string, string>;
};

/** UUIDs are easy for a model to mistype; resolve short model references before validation. */
const buildAiExerciseCatalog = (exercises: any[]): AiExerciseCatalog => {
  const referenceIds = new Map<string, string>();
  const text = exercises.map((item, index) => {
    const reference = `EX${String(index + 1).padStart(2, '0')}`;
    referenceIds.set(reference, String(item.id));
    return `${reference}|name=${truncateText(item.name, 34)}|body=${truncateText(item.body_part, 12)}|target=${truncateText(item.target_muscle, 16)}|secondary=${truncateText((item.secondary_muscles || []).join(','), 24)}|eq=${truncateText(item.equipment, 14)}|locations=${(item.training_locations || []).join(',')}|difficulty=${truncateText(item.difficulty, 16)}|min_months=${item.min_experience_months}|progression=${item.progression_level}|pattern=${truncateText(item.movement_pattern, 18)}|goals=${truncateText((item.goal_type || []).join(','), 24)}`;
  }).join('\n');
  return { text, referenceIds };
};

const resolveAiExerciseReferences = (proposal: any, referenceIds: Map<string, string>) => {
  const workout = proposal?.workout_plan || proposal?.workoutPlan || proposal;
  const days = Array.isArray(workout?.days) ? workout.days : [];
  days.forEach((day: any) => {
    if (!Array.isArray(day?.exercises)) return;
    day.exercises.forEach((exercise: any) => {
      if (!exercise || typeof exercise !== 'object') return;
      const exerciseId = referenceIds.get(String(exercise.exercise_id || '').trim().toUpperCase());
      if (exerciseId) exercise.exercise_id = exerciseId;
    });
  });
  return proposal;
};
const normalizeKeywordText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
const includesAnyKeyword = (value: string, keywords: string[]) => keywords.some((keyword) => value.includes(keyword));
const normalizeKeywordTokens = (value: unknown) =>
  normalizeKeywordText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const getBearerToken = (authorizationHeader: unknown): string | null => {
  const raw = String(authorizationHeader || '');
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim() || null;
};

class ReadinessTimeoutError extends Error {
  constructor() {
    super('Readiness check timed out');
  }
}

const getReadyTimeoutMs = (): number => {
  const configuredTimeout = Number(process.env.READY_TIMEOUT_MS);
  if (!Number.isSafeInteger(configuredTimeout)) return DEFAULT_READY_TIMEOUT_MS;
  if (configuredTimeout < MIN_READY_TIMEOUT_MS || configuredTimeout > MAX_READY_TIMEOUT_MS) {
    return DEFAULT_READY_TIMEOUT_MS;
  }
  return configuredTimeout;
};

const awaitWithTimeout = <T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ReadinessTimeoutError());
    }, timeoutMs);

    Promise.resolve(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
const getAuthUserId = async (req: express.Request): Promise<string | null> => {
  const token = getBearerToken(req.headers.authorization);
  if (!token) return null;
  const authRes = await supabase.auth.getUser(token);
  if (authRes.error || !authRes.data.user?.id) return null;
  return authRes.data.user.id;
};
const isAdminUser = async (userId: string): Promise<boolean> => {
  const userRes = await supabase.auth.admin.getUserById(userId);
  if (userRes.error || !userRes.data.user) return false;
  return String(userRes.data.user.app_metadata?.role || '').toLowerCase() === 'admin';
};
const requireAdminUserId = async (req: express.Request, res: express.Response): Promise<string | null> => {
  const authUserId = await getAuthUserId(req);
  if (!authUserId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const isAdmin = await isAdminUser(authUserId);
  if (!isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return authUserId;
};
const hasValidCronSecret = (req: express.Request): boolean => {
  const secret = String(req.headers['x-cron-secret'] || '').trim();
  return Boolean(process.env.CRON_SECRET && secret && secret === process.env.CRON_SECRET);
};

const normalizeMembershipTier = (value: unknown): MembershipTier => {
  const tier = String(value || '').trim().toLowerCase();
  if (tier === 'pro' || tier === 'premium') return 'pro';
  if (tier === 'plus') return 'plus';
  return 'free';
};

const getMonthlyQuotaStart = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const getAiQuotaWindow = (profile: any, membershipTier: MembershipTier) => {
  if (membershipTier === 'free') {
    const createdAt = profile?.created_at ? new Date(profile.created_at) : new Date();
    const safeStart = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
    return {
      startsAt: safeStart,
      endsAt: addDays(safeStart, FREE_TRIAL_DAYS)
    };
  }

  return {
    startsAt: getMonthlyQuotaStart(),
    endsAt: null as Date | null
  };
};

const applyQuotaWindow = (query: any, startsAt: Date, endsAt: Date | null) => {
  let nextQuery = query.gte('created_at', startsAt.toISOString());
  if (endsAt) nextQuery = nextQuery.lt('created_at', endsAt.toISOString());
  return nextQuery;
};

const getAiQuotaUsageCount = async (
  userId: string,
  quotaKey: AiQuotaKey,
  startsAt: Date,
  endsAt: Date | null
): Promise<number> => {
  if (quotaKey === 'chatMessages') {
    const chatRes = await applyQuotaWindow(
      supabase
        .from('ai_quota_usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('quota_key', 'chatMessages'),
      startsAt,
      endsAt
    );
    if (chatRes.error) throw chatRes.error;
    return chatRes.count || 0;
  }

  let query = supabase
    .from('ai_plan_adjustments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'applied');

  if (quotaKey === 'planGenerations') {
    query = query.eq('source_type', 'ai_coach_generate');
  } else if (quotaKey === 'workoutAdjustments') {
    query = query
      .eq('plan_type', 'workout')
      .not('source_type', 'eq', 'ai_coach_generate')
      .not('source_type', 'eq', 'premium_auto_generate')
      .not('source_type', 'eq', 'onboarding_meal_generate');
  } else if (quotaKey === 'mealAdjustments') {
    query = query
      .eq('plan_type', 'meal')
      .not('source_type', 'eq', 'ai_coach_generate')
      .not('source_type', 'eq', 'premium_auto_generate')
      .not('source_type', 'eq', 'onboarding_meal_generate');
  }

  const usageRes = await applyQuotaWindow(query, startsAt, endsAt);
  if (usageRes.error) throw usageRes.error;
  return usageRes.count || 0;
};

const recordAiQuotaUsage = async (userId: string, quotaKey: AiQuotaKey) => {
  const usageInsert = await supabase
    .from('ai_quota_usage_events')
    .insert({ user_id: userId, quota_key: quotaKey });
  if (usageInsert.error) throw usageInsert.error;
};

const getAiCoachAccessState = async (profile: any, userId: string) => {
  const membershipTier = normalizeMembershipTier(profile?.membership_tier);
  const quotaLimits = AI_QUOTAS_BY_TIER[membershipTier];
  const quotaWindow = getAiQuotaWindow(profile, membershipTier);
  const trialExpired = membershipTier === 'free' && !!quotaWindow.endsAt && new Date() >= quotaWindow.endsAt;

  const [
    planGenerations,
    workoutAdjustments,
    mealAdjustments,
    chatMessages
  ] = await Promise.all([
    getAiQuotaUsageCount(userId, 'planGenerations', quotaWindow.startsAt, quotaWindow.endsAt),
    getAiQuotaUsageCount(userId, 'workoutAdjustments', quotaWindow.startsAt, quotaWindow.endsAt),
    getAiQuotaUsageCount(userId, 'mealAdjustments', quotaWindow.startsAt, quotaWindow.endsAt),
    getAiQuotaUsageCount(userId, 'chatMessages', quotaWindow.startsAt, quotaWindow.endsAt)
  ]);

  const usage: Record<AiQuotaKey, number> = {
    planGenerations,
    workoutAdjustments,
    mealAdjustments,
    chatMessages
  };
  const remaining = Object.fromEntries(
    (Object.keys(quotaLimits) as AiQuotaKey[]).map((key) => [
      key,
      Math.max(0, quotaLimits[key] - usage[key])
    ])
  ) as Record<AiQuotaKey, number>;

  return {
    membershipTier,
    trialExpired,
    trialEndsAt: membershipTier === 'free' ? quotaWindow.endsAt?.toISOString() || null : null,
    quotaWindow: {
      startsAt: quotaWindow.startsAt.toISOString(),
      endsAt: quotaWindow.endsAt?.toISOString() || null
    },
    quotas: {
      limits: quotaLimits,
      usage,
      remaining
    },
    canGenerate: !trialExpired && remaining.planGenerations > 0,
    canChat: !trialExpired && remaining.chatMessages > 0,
    canUseWorkoutAdjustment: !trialExpired && remaining.workoutAdjustments > 0,
    canUseMealAdjustment: !trialExpired && remaining.mealAdjustments > 0,
    canUseAiChange: !trialExpired && (remaining.workoutAdjustments > 0 || remaining.mealAdjustments > 0),
    isUnlimited: false
  };
};

const AI_QUOTA_ERROR_MESSAGES: Record<AiQuotaKey, string> = {
  planGenerations: 'Ban da dung het luot tao lich tu dong trong goi hien tai. Vui long nang cap Plus hoac Pro de tao lich moi.',
  workoutAdjustments: 'Ban da dung het luot tao lai bai tap trong goi hien tai. Vui long nang cap Plus hoac Pro de tiep tuc.',
  mealAdjustments: 'Ban da dung het luot tao lai thuc don trong goi hien tai. Vui long nang cap Plus hoac Pro de tiep tuc.',
  chatMessages: 'Ban da dung het tin nhan AI Coach trong goi hien tai. Vui long nang cap Plus hoac Pro de tiep tuc.'
};

const buildAiQuotaLimitError = (
  accessState: Awaited<ReturnType<typeof getAiCoachAccessState>>,
  quotaKey: AiQuotaKey
) => ({
  code: 'AI_CHANGE_LIMIT_REACHED',
  error: accessState.trialExpired
    ? 'Free trial 7 ngay da ket thuc. Vui long nang cap Plus hoac Pro de tiep tuc dung AI Coach.'
    : AI_QUOTA_ERROR_MESSAGES[quotaKey],
  membershipTier: accessState.membershipTier,
  quotaKey,
  trialEndsAt: accessState.trialEndsAt,
  aiQuota: {
    limits: accessState.quotas.limits,
    usage: accessState.quotas.usage,
    remaining: accessState.quotas.remaining
  }
});

const buildAiChangeLimitError = (accessState: Awaited<ReturnType<typeof getAiCoachAccessState>>) =>
  buildAiQuotaLimitError(accessState, 'workoutAdjustments');

const buildAiQuotaSnapshot = (
  accessState: Awaited<ReturnType<typeof getAiCoachAccessState>>,
  incrementKey?: AiQuotaKey
) => {
  const usage = { ...accessState.quotas.usage };
  const remaining = { ...accessState.quotas.remaining };
  if (incrementKey) {
    usage[incrementKey] = usage[incrementKey] + 1;
    remaining[incrementKey] = Math.max(0, remaining[incrementKey] - 1);
  }

  return {
    limits: accessState.quotas.limits,
    usage,
    remaining,
    trialEndsAt: accessState.trialEndsAt
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
const AI_CHAT_DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
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

const readPositiveNumber = (...values: unknown[]): number => {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
};

const averagePositiveValues = (values: unknown[]): number => {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (numbers.length === 0) return 0;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
};

const buildAiCoachProgressSummary = ({
  todayKey,
  recentDateKeys,
  profile,
  bodyMetrics,
  lifestyle,
  health,
  progressLogs,
  exerciseSessions,
}: {
  todayKey: string;
  recentDateKeys: string[];
  profile?: any;
  bodyMetrics?: any;
  lifestyle?: any;
  health?: any;
  progressLogs?: any[];
  exerciseSessions?: any[];
}): AIChatContext['progressSummary'] => {
  const logs = Array.isArray(progressLogs) ? progressLogs : [];
  const sessions = Array.isArray(exerciseSessions) ? exerciseSessions : [];
  const todayLog = logs.find((item) => item?.log_date === todayKey) || {};
  const waterGoalMl = Math.round(readPositiveNumber(lifestyle?.daily_water_goal, 2) * 1000);
  const sleepTargetHours = readPositiveNumber(health?.sleep_hours, lifestyle?.sleep_hours, 8);
  const targetCalories = readPositiveNumber(lifestyle?.target_calories);

  const waterHitDays = logs.filter((item) => Number(item?.water_intake_ml || 0) >= waterGoalMl).length;
  const sleepHitDays = logs.filter((item) => Number(item?.sleep_hours || 0) >= sleepTargetHours).length;
  const sessionsByDate = new Map<string, any[]>();
  sessions.forEach((session) => {
    const key = String(session?.log_date || '');
    if (!key) return;
    const rows = sessionsByDate.get(key) || [];
    rows.push(session);
    sessionsByDate.set(key, rows);
  });

  const todaySessions = sessionsByDate.get(todayKey) || [];
  const todayCompletedExercises = todaySessions.filter((item) => item?.is_completed).length;
  const todayCompletedSets = todaySessions.reduce((sum, item) => sum + Number(item?.completed_sets || (item?.is_completed ? item?.sets : 0) || 0), 0);
  const todayPlannedSets = todaySessions.reduce((sum, item) => sum + Number(item?.planned_sets || item?.sets || 0), 0);
  const workoutDaysWithData = recentDateKeys.filter((dateKey) => (sessionsByDate.get(dateKey) || []).length > 0).length;
  const workoutCompletedDays = recentDateKeys.filter((dateKey) => {
    const rows = sessionsByDate.get(dateKey) || [];
    return rows.length > 0 && rows.every((item) => item?.is_completed || Number(item?.completed_sets || 0) >= Number(item?.planned_sets || item?.sets || 1));
  }).length;

  const goalText = normalizeKeywordText(lifestyle?.fitness_goal);
  const dietText = String(lifestyle?.diet_preference || lifestyle?.current_diet || '').trim();
  const equipmentText = String(lifestyle?.equipment_available || '').trim();
  const locationText = String(lifestyle?.workout_location || '').trim();
  const injuryText = String(health?.injuries || health?.health_condition || '').trim();
  const weight = readPositiveNumber(bodyMetrics?.weight, profile?.weight);
  const targetWeight = readPositiveNumber(bodyMetrics?.target_weight, profile?.target_weight);
  const notes: string[] = [];

  if (goalText) notes.push(`mục tiêu=${lifestyle?.fitness_goal}`);
  if (weight && targetWeight) {
    const direction = targetWeight < weight ? 'giảm cân' : targetWeight > weight ? 'tăng cân/tăng cơ' : 'giữ cân';
    notes.push(`cân nặng ${Math.round(weight * 10) / 10}kg -> mục tiêu ${Math.round(targetWeight * 10) / 10}kg (${direction})`);
  }
  if (dietText) notes.push(`chế độ ăn=${truncateText(dietText, 80)}`);
  if (equipmentText || locationText) notes.push(`tập ở ${locationText || 'chưa rõ'}, dụng cụ=${equipmentText || 'chưa rõ'}`);
  if (injuryText) notes.push(`cẩn thận với sức khỏe/chấn thương=${truncateText(injuryText, 100)}`);
  if (waterGoalMl && Number(todayLog?.water_intake_ml || 0) < Math.round(waterGoalMl * 0.5)) notes.push('hôm nay nước đang thấp, ưu tiên nhắc bù nước');
  if (sleepTargetHours && Number(todayLog?.sleep_hours || 0) > 0 && Number(todayLog?.sleep_hours || 0) < sleepTargetHours) notes.push('ngủ hôm nay thấp hơn mục tiêu, nên giảm tải hoặc ưu tiên phục hồi');
  if (todaySessions.length > 0 && todayCompletedExercises < todaySessions.length) notes.push('buổi tập hôm nay chưa hoàn thành hết');

  return {
    todayDate: todayKey,
    recentDays: recentDateKeys.length,
    waterGoalMl,
    waterTodayMl: Number(todayLog?.water_intake_ml || 0),
    averageWaterMl: averagePositiveValues(logs.map((item) => item?.water_intake_ml)),
    waterHitDays,
    sleepTargetHours,
    sleepTodayHours: Number(todayLog?.sleep_hours || 0),
    averageSleepHours: averagePositiveValues(logs.map((item) => item?.sleep_hours)),
    sleepHitDays,
    targetCalories,
    caloriesToday: Number(todayLog?.calories_consumed || 0),
    workoutDaysWithData,
    workoutCompletedDays,
    todayCompletedExercises,
    todayTotalExercises: todaySessions.length,
    todayCompletedSets,
    todayPlannedSets,
    planFitNotes: notes,
  };
};

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
        quantities?: number[];
        recipe_id?: string;
        servings?: number;
        notes?: string;
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

const normalizeAiPlanPayload = (raw: any, options: { requireMealPlan?: boolean } = {}): NormalizedAiPlan => {
  const requireMealPlan = options.requireMealPlan ?? true;
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
          quantities: Array.isArray(item.quantities)
            ? ids.map((_: string, index: number) => Math.max(0.25, Math.min(6, Number(item.quantities[index]) || 0)))
            : [],
          total_calories: Math.max(0, Number(item.total_calories) || 0),
          recipe_id: String(item.recipe_id || '').trim() || undefined,
          servings: item.recipe_id ? Math.max(0.25, Math.min(6, Number(item.servings) || 1)) : undefined,
          notes: String(item.notes || '').trim().slice(0, 300) || undefined,
        };
      })
    };
  });

  if (normalizedWorkoutDays.length === 0 || (requireMealPlan && normalizedMealDays.length === 0)) {
    throw new Error(requireMealPlan ? 'AI JSON missing workout_plan.days or meal_plan.days' : 'AI JSON missing workout_plan.days');
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

const enforceTrainingPrescription = (
  workoutPlan: NormalizedAiPlan['workoutPlan'],
  prescription: TrainingPrescription,
) => {
  const daysByIndex = new Map<number, NormalizedAiPlan['workoutPlan']['days'][number]>();
  for (const day of workoutPlan.days) {
    if (daysByIndex.has(day.day_of_week)) {
      throw new ApiRequestError(422, { error: 'AI workout proposal contains duplicate days.' });
    }
    daysByIndex.set(day.day_of_week, day);
  }
  if (daysByIndex.size !== 7 || Array.from({ length: 7 }, (_, day) => !daysByIndex.has(day)).some(Boolean)) {
    throw new ApiRequestError(422, { error: 'AI workout proposal must contain exactly one entry for every day of the week.' });
  }

  const activeDays = Array.from(daysByIndex.values()).filter((day) => !day.is_rest_day && day.exercises.length > 0);
  if (activeDays.length !== prescription.weeklyWorkouts) {
    throw new ApiRequestError(422, {
      error: `AI workout proposal must contain exactly ${prescription.weeklyWorkouts} training days.`,
    });
  }

  return {
    ...workoutPlan,
    days: Array.from({ length: 7 }, (_, dayIndex) => {
      const day = daysByIndex.get(dayIndex)!;
      const isTrainingDay = !day.is_rest_day && day.exercises.length > 0;
      return isTrainingDay
        ? { ...day, day_of_week: dayIndex, is_rest_day: false, duration_minutes: prescription.durationMinutes }
        : { ...day, day_of_week: dayIndex, is_rest_day: true, duration_minutes: 0, exercises: [] };
    }),
  };
};

const OPTIMAL_DAY_DISTRIBUTIONS: Record<number, number[]> = {
  1: [0],                  // Mon
  2: [1, 4],               // Tue, Fri
  3: [0, 2, 4],            // Mon, Wed, Fri (Work - Rest - Work - Rest - Work - Rest - Rest)
  4: [0, 1, 3, 4],         // Mon, Tue, Thu, Fri (Work - Work - Rest - Work - Work - Rest - Rest)
  5: [0, 1, 2, 4, 5],      // Mon, Tue, Wed, Fri, Sat (Work 3 - Rest 1 - Work 2 - Rest 1)
  6: [0, 1, 2, 3, 4, 5],   // Mon..Sat, Sun rest
  7: [0, 1, 2, 3, 4, 5, 6],
};

const balanceWorkoutDays = (workoutPlan: NormalizedAiPlan['workoutPlan'], weeklyWorkouts: number) => {
  const activeDays = workoutPlan.days.filter((d) => !d.is_rest_day && d.exercises.length > 0);
  if (activeDays.length !== weeklyWorkouts) return workoutPlan;

  const targetSlots = OPTIMAL_DAY_DISTRIBUTIONS[weeklyWorkouts] || Array.from({ length: weeklyWorkouts }, (_, i) => i);
  const targetSlotSet = new Set(targetSlots);

  let activeIdx = 0;
  const newDays = Array.from({ length: 7 }, (_, dayIndex) => {
    if (targetSlotSet.has(dayIndex) && activeIdx < activeDays.length) {
      const sourceDay = activeDays[activeIdx++];
      return {
        ...sourceDay,
        day_of_week: dayIndex,
        is_rest_day: false,
      };
    }
    return {
      day_of_week: dayIndex,
      is_rest_day: true,
      duration_minutes: 0,
      exercises: [],
      note: 'Recovery Day',
    };
  });

  return {
    ...workoutPlan,
    days: newDays,
  };
};

const getDayName = (dayIndex: number) => {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return names[Math.max(0, Math.min(6, dayIndex))] || 'Monday';
};

// Weekly plans are stored Monday–Sunday so they can be materialized into
// calendar dates consistently. When a user creates a plan mid-week,
// ensure no workouts are scheduled on days before creation date (past days),
// and assign training sessions starting directly on TODAY.
const startWorkoutPlanOnCreationDay = (
  workoutPlan: NormalizedAiPlan['workoutPlan'],
  _planStartKey?: string,
) => {
  const todayKey = getVietnamDateKey();
  const todayDate = new Date(`${todayKey}T00:00:00`);
  const day = todayDate.getDay();
  const todayDayIndex = day === 0 ? 6 : day - 1; // 0=Mon, 1=Tue, ..., 6=Sun

  // Extract all non-rest training days from AI proposal
  const trainingDays = workoutPlan.days.filter(
    (item) => !item.is_rest_day && Array.isArray(item.exercises) && item.exercises.length > 0
  );

  if (trainingDays.length === 0) return workoutPlan;

  // If created on Monday (0), no past days in this calendar week
  if (todayDayIndex === 0) {
    return {
      ...workoutPlan,
      days: workoutPlan.days.map((item, idx) => ({
        ...item,
        day_of_week: Number(item.day_of_week ?? idx),
      })),
    };
  }

  // Re-map 7 days (0..6):
  // Days < todayDayIndex (past days in current week) -> Forced rest days (no workouts in the past!)
  // Days >= todayDayIndex -> Assigned training sessions starting from TODAY
  const newDays = Array.from({ length: 7 }, (_, d) => {
    if (d < todayDayIndex) {
      return {
        day: getDayName(d),
        day_of_week: d,
        type: 'rest',
        duration_minutes: 0,
        is_rest_day: true,
        exercises: [],
      };
    }

    const trainingIdx = d - todayDayIndex;
    if (trainingIdx < trainingDays.length) {
      return {
        ...trainingDays[trainingIdx],
        day: getDayName(d),
        day_of_week: d,
      };
    }

    return {
      day: getDayName(d),
      day_of_week: d,
      type: 'rest',
      duration_minutes: 0,
      is_rest_day: true,
      exercises: [],
    };
  });

  return {
    ...workoutPlan,
    days: newDays,
  };
};

const startMealPlanOnCreationDay = (
  mealPlan: NormalizedAiPlan['mealPlan'],
  _planStartKey?: string,
) => {
  const todayKey = getVietnamDateKey();
  const todayDate = new Date(`${todayKey}T00:00:00`);
  const day = todayDate.getDay();
  const todayDayIndex = day === 0 ? 6 : day - 1;

  if (todayDayIndex === 0) return mealPlan;

  const validDays = mealPlan.days.filter(
    (item) => Array.isArray(item.meals) && item.meals.length > 0
  );

  if (validDays.length === 0) return mealPlan;

  const newDays = Array.from({ length: 7 }, (_, d) => {
    const mealIdx = (d - todayDayIndex + 7) % validDays.length;
    const sourceDay = validDays[mealIdx < validDays.length ? mealIdx : 0];

    return {
      ...sourceDay,
      day: getDayName(d),
      day_of_week: d,
    };
  });

  return {
    ...mealPlan,
    days: newDays,
  };
};

// Providers occasionally omit one of the seven meal-plan days. Keep the
// promise made to the user by filling a missing day from a valid generated
// day; the normal meal-enrichment step below then completes its meal slots.
const ensureSevenDayMealPlan = (mealPlan: NormalizedAiPlan['mealPlan']) => {
  const validDays = mealPlan.days.filter((day) => !day.is_rest_day && day.meals.length > 0);
  const fallbackDay = validDays[0];
  if (!fallbackDay) {
    throw new ApiRequestError(422, { error: 'AI meal proposal must contain meals for all 7 days.' });
  }

  const daysByIndex = new Map<number, NormalizedAiPlan['mealPlan']['days'][number]>();
  for (const day of validDays) {
    if (!daysByIndex.has(day.day_of_week)) daysByIndex.set(day.day_of_week, day);
  }

  return {
    ...mealPlan,
    days: Array.from({ length: 7 }, (_, dayIndex) => {
      const sourceDay = daysByIndex.get(dayIndex) || fallbackDay;
      return {
        ...sourceDay,
        day_of_week: dayIndex,
        is_rest_day: false,
        meals: sourceDay.meals.map((meal) => ({
          ...meal,
          food_ids: [...meal.food_ids],
          quantities: meal.quantities ? [...meal.quantities] : [],
        })),
      };
    }),
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

const buildWeeklyWorkoutPlanRow = ({
  weeklyPlanId,
  dayIndex,
  item,
  orderIndex,
  exercise,
  bodyWeightKg,
  prescription
}: {
  weeklyPlanId: string;
  dayIndex: number;
  item: any;
  orderIndex: number;
  exercise?: any;
  bodyWeightKg: number;
  prescription?: WorkoutPrescription;
}) => {
  const plannedSets = prescription?.sets ?? Math.max(1, Math.min(6, Number(item.sets) || 3));
  const plannedReps = prescription?.reps ?? String(item.reps || '10-12').slice(0, 20);
  const plannedWeightKg = prescription?.weightKg ?? Math.max(0, Number(item.weight_kg) || 0);
  const plannedRestSeconds = prescription?.restSeconds ?? Math.max(30, Math.min(180, Number(item.rest_seconds) || 60));
  const targetRpe = prescription?.targetRpe ?? Math.max(5, Math.min(10, Number(item.target_rpe) || 7));
  const estimatedKcal = prescription?.estimatedKcal ?? estimateWorkoutKcal({
    exercise,
    bodyWeightKg,
    sets: plannedSets,
    repsText: plannedReps,
    weightKg: plannedWeightKg ?? 0,
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
    load_instruction: String(item.load_instruction || prescription?.loadInstruction || '').slice(0, 160) || null
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
  sets: dailyExerciseSession.actual_sets ?? dailyExerciseSession.sets,
  reps: dailyExerciseSession.actual_reps ?? dailyExerciseSession.reps,
  weight_kg: dailyExerciseSession.actual_weight_kg ?? dailyExerciseSession.weight_kg,
  rest_seconds: dailyExerciseSession.actual_rest_seconds ?? dailyExerciseSession.rest_seconds,
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
  exercises:exercise_id (name, video_url, target_muscle, body_part, instructions, estimated_duration_seconds)
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
    .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, calories_per_minute')
    .eq('id', exerciseId)
    .maybeSingle();
  if (exerciseRes.error) throw exerciseRes.error;
  if (!exerciseRes.data?.id) {
    throw new ApiRequestError(404, { error: 'Exercise not found' });
  }
  return exerciseRes.data;
};

const calculateCompletedExerciseKcal = async ({
  userId,
  session,
  completedSets,
  restSeconds,
}: {
  userId: string;
  session: any;
  completedSets: number;
  restSeconds?: number;
}): Promise<number> => {
  const safeCompletedSets = Math.max(0, Number(completedSets) || 0);
  if (safeCompletedSets === 0) return 0;

  const actualWeightKg =
    session.actual_weight_kg === null || session.actual_weight_kg === undefined
      ? Math.max(0, Number(session.weight_kg) || 0)
      : Math.max(0, Number(session.actual_weight_kg) || 0);
  const effectiveRestSeconds = restSeconds === undefined
    ? Math.max(0, Number(session.actual_rest_seconds ?? session.rest_seconds) || 0)
    : Math.max(0, Number(restSeconds) || 0);
  const [bodyWeightKg, exerciseMeta] = await Promise.all([
    getLatestBodyWeightKg(userId),
    getExerciseMetaForKcal(String(session.exercise_id || '')),
  ]);

  return estimateWorkoutKcal({
    exercise: exerciseMeta,
    bodyWeightKg,
    sets: safeCompletedSets,
    repsText: String(session.actual_reps ?? session.reps ?? '10'),
    weightKg: actualWeightKg,
    restSeconds: effectiveRestSeconds,
  });
};

const suggestManualStartingWeightKg = ({
  exercise,
  bodyWeightKg
}: {
  exercise?: any;
  bodyWeightKg: number;
}): number => {
  const descriptor = normalizeKeywordText(
    `${exercise?.name || ''} ${exercise?.body_part || ''} ${exercise?.target_muscle || ''} ${exercise?.equipment || ''} ${exercise?.movement_pattern || ''}`
  );
  const equipment = normalizeKeywordText(exercise?.equipment);

  if (
    includesAnyKeyword(descriptor, ['cardio', 'aerobic', 'running', 'jump', 'nhay', 'chay']) ||
    includesAnyKeyword(equipment, ['khong dung cu', 'bodyweight', 'body weight', 'resistance band', 'band', 'day khang luc'])
  ) {
    return 0;
  }

  const safeBodyWeightKg = Math.max(40, Number(bodyWeightKg) || 70);
  const isLowerBody = includesAnyKeyword(descriptor, ['leg', 'legs', 'chan', 'dui', 'glute', 'mong', 'hamstring', 'quadriceps', 'calf']);
  const isLargeUpper = includesAnyKeyword(descriptor, ['chest', 'nguc', 'back', 'lung', 'lat', 'row', 'press']);
  const isSmallUpper = includesAnyKeyword(descriptor, ['shoulder', 'vai', 'arm', 'tay', 'bicep', 'tricep', 'forearm']);
  const isCore = includesAnyKeyword(descriptor, ['abs', 'core', 'bung', 'oblique']);
  const isBarbellOrMachine = includesAnyKeyword(equipment, ['barbell', 'thanh don', 'ta don lon', 'machine', 'may', 'smith']);
  const isDumbbellOrKettlebell = includesAnyKeyword(equipment, ['dumbbell', 'ta don', 'kettlebell', 'ta chuong']);
  const isCable = includesAnyKeyword(equipment, ['cable', 'cap']);
  const difficulty = normalizeKeywordText(exercise?.difficulty);

  let bodyWeightRatio = 0.08;
  if (isLowerBody) bodyWeightRatio = isBarbellOrMachine ? 0.35 : isDumbbellOrKettlebell ? 0.18 : isCable ? 0.14 : 0.16;
  else if (isLargeUpper) bodyWeightRatio = isBarbellOrMachine ? 0.22 : isDumbbellOrKettlebell ? 0.12 : isCable ? 0.10 : 0.12;
  else if (isSmallUpper) bodyWeightRatio = isBarbellOrMachine ? 0.12 : isDumbbellOrKettlebell ? 0.07 : isCable ? 0.06 : 0.07;
  else if (isCore) bodyWeightRatio = 0.05;

  const difficultyFactor = includesAnyKeyword(difficulty, ['advanced', 'kho', 'hard'])
    ? 1.15
    : includesAnyKeyword(difficulty, ['beginner', 'de', 'easy'])
      ? 0.75
      : 1;
  const rawWeight = safeBodyWeightKg * bodyWeightRatio * difficultyFactor;
  const roundedWeight = Math.round(rawWeight / 2.5) * 2.5;
  return Math.max(2.5, Math.min(80, roundedWeight));
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

const syncWorkoutCaloriesBurnedForDate = async (userId: string, logDate: string) => {
  if (!userId || !DATE_KEY_REGEX.test(logDate)) return;

  const sessionsRes = await supabase
    .from('daily_exercise_sessions')
    .select('actual_kcal_estimated, estimated_kcal, is_completed, actual_sets, sets, completed_sets')
    .eq('user_id', userId)
    .eq('log_date', logDate);
  if (sessionsRes.error) throw sessionsRes.error;

  const sessionRows = sessionsRes.data || [];
  const caloriesBurned = Math.max(
    0,
    Math.round(
      sessionRows.reduce((sum: number, item: any) => {
        const actualKcal = Math.max(0, Number(item.actual_kcal_estimated) || 0);
        if (actualKcal > 0) return sum + actualKcal;
        return sum + (item.is_completed ? Math.max(0, Number(item.estimated_kcal) || 0) : 0);
      }, 0)
    )
  );

  const progressRes = await supabase
    .from('daily_progress_logs')
    .upsert(
      { user_id: userId, log_date: logDate, calories_burned: caloriesBurned },
      { onConflict: 'user_id,log_date' }
    );
  if (progressRes.error) throw progressRes.error;

  const workoutSessionRes = await supabase
    .from('daily_workout_sessions')
    .select('id, started_at, completed_at')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (workoutSessionRes.error) throw workoutSessionRes.error;

  if (workoutSessionRes.data?.id) {
    const hasAnyProgress = sessionRows.some((item: any) =>
      item.is_completed ||
      Math.max(0, Number(item.completed_sets) || 0) > 0 ||
      Math.max(0, Number(item.actual_kcal_estimated) || 0) > 0
    );
    const allCompleted = sessionRows.length > 0 && sessionRows.every((item: any) => {
      if (item.is_completed) return true;
      const totalSets = Math.max(1, Number(item.actual_sets ?? item.sets) || 1);
      return Math.max(0, Number(item.completed_sets) || 0) >= totalSets;
    });
    const nextStatus = allCompleted ? 'completed' : hasAnyProgress ? 'in_progress' : 'planned';
    const nowIso = new Date().toISOString();
    const updateWorkoutSessionRes = await supabase
      .from('daily_workout_sessions')
      .update({
        calories_burned: caloriesBurned,
        status: nextStatus,
        started_at: hasAnyProgress ? (workoutSessionRes.data.started_at || nowIso) : workoutSessionRes.data.started_at,
        completed_at: allCompleted ? (workoutSessionRes.data.completed_at || nowIso) : null
      })
      .eq('id', workoutSessionRes.data.id);
    if (updateWorkoutSessionRes.error) throw updateWorkoutSessionRes.error;
  }
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

const isDatabaseMigrationRequiredError = (error: unknown): boolean => {
  const databaseError = error as { code?: unknown; message?: unknown } | null;
  const code = String(databaseError?.code || '');
  const message = String(databaseError?.message || error || '').toLowerCase();

  return code === '42703'
    || code === '42883'
    || code === '42P01'
    || code === 'PGRST202'
    || message.includes('could not find the function public.materialize_daily_workout_from_plan_atomically')
    || message.includes('training_locations does not exist');
};

const databaseMigrationRequiredResponse = {
  code: 'DATABASE_MIGRATION_REQUIRED',
  error: 'Hệ thống đang được cập nhật dữ liệu tập luyện. Vui lòng thử lại sau ít phút.'
};

const isGroqTokenLimitError = (message: unknown): boolean => {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('request too large')
    || normalized.includes('tokens per minute')
    || normalized.includes('tpm')
    || normalized.includes('rate_limit_exceeded');
};

const toAiProviderRequestError = (message: unknown) => {
  const rawMessage = String(message || 'Groq AI request failed');
  if (isGroqTokenLimitError(rawMessage)) {
    return new ApiRequestError(503, {
      code: 'AI_TOKEN_LIMIT',
      error: 'AI đang quá tải khi tạo lịch 7 ngày. Vui lòng thử lại sau ít phút.'
    });
  }

  return new ApiRequestError(502, {
    code: 'AI_PROVIDER_ERROR',
    error: 'AI chưa tạo được lịch 7 ngày lúc này. Vui lòng thử lại sau.'
  });
};

const hasExistingWeeklyCoachPlan = async (userId: string, weekStartKey: string) => {
  const [workoutRes, foodRes] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .eq('plan_status', 'active')
      .limit(1),
    supabase
      .from('weekly_food_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .eq('plan_status', 'active')
      .limit(1),
  ]);

  if (workoutRes.error) throw workoutRes.error;
  if (foodRes.error) throw foodRes.error;

  return Boolean(workoutRes.data?.length || foodRes.data?.length);
};

const getLatestCoachPlanCycleStart = async (userId: string): Promise<string | null> => {
  const [workoutRes, foodRes] = await Promise.all([
    supabase
      .from('weekly_plans')
      .select('week_start_date')
      .eq('user_id', userId)
      .eq('plan_status', 'active')
      .order('week_start_date', { ascending: false })
      .limit(1),
    supabase
      .from('weekly_food_plans')
      .select('week_start_date')
      .eq('user_id', userId)
      .eq('plan_status', 'active')
      .order('week_start_date', { ascending: false })
      .limit(1),
  ]);
  if (workoutRes.error) throw workoutRes.error;
  if (foodRes.error) throw foodRes.error;

  const cycleStarts = [workoutRes.data?.[0]?.week_start_date, foodRes.data?.[0]?.week_start_date]
    .map((value) => String(value || '').trim())
    .filter((value) => DATE_KEY_REGEX.test(value));
  return cycleStarts.sort().at(-1) || null;
};

const addDaysToDateKey = (dateKey: string, days: number): string =>
  getVietnamDateKey(addDays(new Date(`${dateKey}T00:00:00`), days));

async function generateWeeklyCoachPlanForUser(params: {
  userId: string;
  weekStartKey: string;
  premiumOnly?: boolean;
}) {
  const { userId, weekStartKey, premiumOnly = false } = params;

  const [
    profileRes,
    bodyMetricsRes,
    lifestyleRes,
    healthRes,
    exerciseCatalogRes,
    recipeCatalogRes,
    recentSessionsRes,
    recentMealsRes,
    recentMealLogsRes

  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('exercises')
      .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
      .limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
    supabase
      .from('recipes')
      .select('id, name, meal_type, dietary_restrictions, diet_styles, goal_type, price_level, calories, protein, carbs, fat, serving_unit, cooking_time_minutes, cooking_difficulty, allergens, instructions, image_url, is_active, recipe_ingredients(id, recipe_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index)')
      .eq('is_active', true)
      .limit(AI_FOOD_CATALOG_FETCH_LIMIT),
    supabase
      .from('daily_exercise_sessions')
      .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(20),
    supabase
      .from('weekly_food_items')
      .select('day_of_week, meal_type, recipe_id, quantity, calories, protein, carbs, fat, weekly_food_plans!inner(user_id), recipes:recipe_id(name, meal_type, price_level)')
      .eq('weekly_food_plans.user_id', userId)
      .eq('weekly_food_plans.plan_status', 'active')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('daily_meal_logs')
      .select('log_date, meal_type, quantity, calories, protein, carbs, fat, custom_food_name')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(40)
  ]);

  const firstError = [
    profileRes.error,
    bodyMetricsRes.error,
    lifestyleRes.error,
    healthRes.error,
    exerciseCatalogRes.error,
    recipeCatalogRes.error,
    recentSessionsRes.error,
    recentMealsRes.error,
    recentMealLogsRes.error
  ].find(Boolean);
  if (firstError) throw firstError;


  let profile = profileRes.data || {};
  const bodyMetrics = bodyMetricsRes.data || {};
  let lifestyle = lifestyleRes.data || {};
  let health = healthRes.data || {};
  const trainingContext = await synchronizeTrainingProfileContext({ userId, profile, lifestyle, health });
  profile = trainingContext.profile;
  lifestyle = trainingContext.lifestyle;
  health = trainingContext.health;
  const { safetyContext, trainingPrescription } = trainingContext;
  const eligibilityContext = buildExerciseEligibilityContext(safetyContext);
  const recentExerciseIds: Set<string> = new Set<string>(
    (recentSessionsRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean)
  );
  const exercises = rankExercises(
    getEligibleExercises(exerciseCatalogRes.data as unknown[], eligibilityContext),
    eligibilityContext,
    { recentExerciseIds },
  )
    .slice(0, AI_EXERCISE_CATALOG_LIMIT)
    .map(({ exercise }) => exercise);
  const recentMealHistory = [
    ...((recentMealLogsRes.data || []) as any[]),
    ...((recentMealsRes.data || []) as any[])
  ];
  const weeklyWorkoutDays = trainingPrescription.weeklyWorkouts;
  const mealsPerDay = resolveMealPlanningMealsPerDay(lifestyle.meals_per_day);
  const mealSlots = getMealPlanningSlots(mealsPerDay);
  const recipeRows = (recipeCatalogRes.data || []) as RecipeCandidate[];
  const recipeEligibilityContext = buildRecipeEligibilityContext(safetyContext, {
    recentRecipeIds: new Set((recentMealsRes.data || []).map((item: any) => String(item.recipe_id || '')).filter(Boolean)),
  });
  const eligibleRecipes = filterEligibleRecipes(recipeRows, recipeEligibilityContext);
  const recipeMode = recipeRows.length > 0 && eligibleRecipes.length > 0;

  const recipeById = new Map(recipeRows.map((recipe) => [String(recipe.id || ''), recipe]));
  const compactRecipes = buildCompactRecipeCatalog(eligibleRecipes, AI_FOOD_CATALOG_LIMIT);
  const foods = buildMealPlanningCatalog([], {

    profile,
    lifestyle,
    health,
    mealsPerDay,
    targetCalories: Number(lifestyle.target_calories || 0),
    recentMealFoodIds: recentMealHistory.map((item: any) => String(item.food_id || '')).filter(Boolean),
  }, AI_FOOD_CATALOG_LIMIT);
  const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
  const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
  const foodById = new Map(foods.map((item: any) => [String(item.id), item]));
  const accessState = await getAiCoachAccessState(profile, userId);

  if (!profileRes.data?.id) {
    throw new ApiRequestError(403, {
      code: 'PROFILE_REQUIRED',
      error: 'Vui long hoan thanh ho so de AI Coach co the tao lo trinh cho ban.'
    });
  }

  if (premiumOnly) {
    if (accessState.membershipTier === 'free') {
      throw new ApiRequestError(403, {
        code: 'PREMIUM_REQUIRED',
        error: 'Plus or Pro membership required for automatic weekly generation.',
        membershipTier: accessState.membershipTier,
      });
    }
  } else if (!accessState.canGenerate) {
    throw new ApiRequestError(403, buildAiQuotaLimitError(accessState, 'planGenerations'));
  }

  const { text: exerciseCatalog, referenceIds: exerciseReferenceIds } = buildAiExerciseCatalog(exercises);

  const foodCatalog = foods
    .map((item: any) => `${item.id}|${truncateText(item.name, 30)}|g=${classifyMealFoodComponent(item)}|k=${item.calories || 0}|p=${item.protein || 0}|c=${item.carbs || 0}|f=${item.fat || 0}|u=${truncateText(item.serving_unit || '100g', 10)}|meal=${truncateText((item.meal_type || []).join(','), 22)}|all=${truncateText((item.allergens || []).join(','), 24)}`)
    .join('\n');
  const recipeCatalog = compactRecipes
    .map((item) => `${item.id}|${truncateText(item.name, 30)}|meal=${item.meal_type.join(',')}|diet=${item.dietary_restrictions.join(',')}|style=${item.diet_styles.join(',')}|k=${item.calories}|p=${item.protein}|c=${item.carbs}|f=${item.fat}|price=${item.price_level}|time=${item.cooking_time_minutes}`)
    .join('\n');
  const mealCatalogLabel = recipeMode ? 'RECIPE_CATALOG' : 'FOOD_CATALOG';
  const mealCatalog = recipeMode ? recipeCatalog : foodCatalog;
  const recipeModeRules = recipeMode
    ? `RECIPE_MODE (highest priority): use only recipe_id from RECIPE_CATALOG. A recipe is a complete dish. Every meal object must be {meal_type, recipe_id, servings, notes?}; never emit food_ids or quantities and never add carb/protein/vegetable components.`
    : '';

  const recentTraining = clampList(recentSessionsRes.data as any[], 6)
    .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
    .join('\n') || 'No recent training history.';

  const recentEating = clampList(recentMealHistory, 6)
    .map((item: any) => `d=${item.day_of_week || item.log_date || ''}|${item.meal_type}|${truncateText(item.recipes?.name || item.foods?.name || item.custom_food_name || item.recipe_id || item.food_id, 28)}|qty=${item.quantity}`)
    .join('\n') || 'No recent meal plan history.';

  const prompt = `
Generate one personalized 7-day workout plan and 7-day meal plan.
Use only EX## references from EXERCISE_CATALOG and food ids from FOOD_CATALOG. Return valid JSON only.

USER_PROFILE:
name=${truncateText(profile.full_name, 40)}
gender=${truncateText(profile.gender, 12)}
birthday=${truncateText(profile.birthday, 20)}
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

${buildSafetyPromptAddendum(safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog || 'No safe exercise ids available after hard safety filtering. Use rest/recovery days only.'}

${mealCatalogLabel}:
${mealCatalog}

${recipeModeRules}

Rules:
- Respect SAFETY_CONSTRAINTS above. They override weekly_workouts and all other goals.
- Exactly 7 days, day_of_week 0..6 where 0 is the plan start date.
- Never create new exercises or foods. Use the EX## reference code from EXERCISE_CATALOG for every exercise_id, and a food_id from FOOD_CATALOG.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Prefer foods whose meal_type, goal_type, allergens, price_level, cooking_time_minutes and region match the user profile.
- Avoid foods whose allergens conflict with allergies_or_medical_history.
- FOOD_CATALOG is already ranked by meal slot, diet preference, budget and eating-history trends; earlier rows are better matches.
- Breakfast must use foods that support breakfast; lunch and dinner must use foods that support lunch/dinner; snack must use snack/breakfast-friendly foods.
- Use recent meal history to infer the user's preferred categories, protein/carb/vegetable balance, diet style and budget tendency.
- Repeating a liked food is allowed, but do not over-repeat the same exact food or same limited family more than 2-3 times in a week.
- Create exactly ${weeklyWorkoutDays} training days. All other days must be rest days with is_rest_day=true and no exercises.
- Every day must include an exercises array. For every rest day, return "exercises": [].
- Every training day must have duration_minutes exactly ${trainingPrescription.durationMinutes}; rest days must have duration_minutes=0.
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction, order_index.
- weight_kg should be conservative. Use 0 for bodyweight.
- Avoid exercises that conflict with injuries, health conditions, location, or equipment.
- Each day must include exactly ${mealsPerDay} meals.
- Allowed meal slots for each day: ${mealSlots.join(', ')}.
- Do not add extra meals beyond those slots.
- Do not put more than one food whose name starts with "Banh"/"Bánh" in the same day. Use varied staples, protein and real vegetables instead.
- A meal object is one complete eating occasion, not one single food.
- Lunch and dinner must have at least 3 food_ids: 1 group=carb/starch, 1 group=protein, and 1 group=vegetable. Example: rice + chicken/fish/tofu + vegetables.
- Breakfast should have at least 2 food_ids when possible: carb + protein/dairy.
- Snack can have 1-2 food_ids.
- Use reasonable quantity multipliers in "quantities". If serving_unit is 100g, vegetables should usually be 2-3 (200-300g), protein 1.2-2 (120-200g), carb 1-2 servings.
- The length of quantities must match food_ids. Do not make lunch or dinner with only one food_id.

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
            "exercise_id": "EX01",
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
            "quantities": [1],
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
    const groqMessage = groqResult?.error?.message || 'Groq AI request failed';
    console.warn('[ai-coach-generate] Groq provider error:', groqMessage);
    throw toAiProviderRequestError(groqMessage);
  }

  const parsed = resolveAiExerciseReferences(
    parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || ''),
    exerciseReferenceIds,
  );
  const proposalValidation = validateExerciseProposal(parsed, eligibilityContext, exercises, {
    allowEmpty: true,
    requireSevenDays: true,
  });
  if (!proposalValidation.valid) {
    throw new ApiRequestError(422, {
      error: 'AI workout proposal contains an ineligible or invalid exercise.',
      details: proposalValidation.errors,
    });
  }
  const normalizedPlan = normalizeAiPlanPayload(parsed);
  const guardedWorkout = sanitizeWorkoutPlanForUser(
    normalizedPlan.workoutPlan,
    safetyContext,
    exerciseById
  );
  if (guardedWorkout.removedCount > 0) {
    throw new ApiRequestError(422, {
      error: 'AI workout proposal failed safety revalidation.',
      details: guardedWorkout.warnings,
    });
  }
  normalizedPlan.workoutPlan = enforceTrainingPrescription(guardedWorkout.workoutPlan, trainingPrescription);
  normalizedPlan.workoutPlan = startWorkoutPlanOnCreationDay(normalizedPlan.workoutPlan, weekStartKey);
  if (Number(lifestyle.target_calories || 0) > 0) {
    normalizedPlan.mealPlan = { ...normalizedPlan.mealPlan, target_calories: Math.round(Number(lifestyle.target_calories)) };
  }
  if (recipeMode) {
    const dayByIndex = new Map(normalizedPlan.mealPlan.days.map((day) => [Number(day.day_of_week), day]));
    if (dayByIndex.size !== 7 || Array.from({ length: 7 }, (_, index) => !dayByIndex.has(index)).some(Boolean)) {
      throw new ApiRequestError(422, { error: 'AI recipe proposal must contain exactly one valid entry for every day.' });
    }
    for (const day of dayByIndex.values()) {
      const proposal = validateRecipeMealProposal(day.meals, compactRecipes.map((item) => recipeById.get(item.id)!).filter(Boolean), recipeEligibilityContext, mealSlots as any, normalizedPlan.mealPlan.target_calories);
      if (!proposal.valid) throw new ApiRequestError(422, { error: 'AI recipe proposal contains an ineligible or invalid recipe.', details: proposal.errors });
      day.meals = proposal.meals.map((item) => ({ ...item, food_ids: [], quantities: [], total_calories: 0 }));
      day.is_rest_day = false;
    }
  } else {
    normalizedPlan.mealPlan = ensureSevenDayMealPlan(normalizedPlan.mealPlan);
    normalizedPlan.mealPlan = startMealPlanOnCreationDay(normalizedPlan.mealPlan, weekStartKey);
  }

  const existingWorkoutPlans = await supabase
    .from('weekly_plans')
    .select('id, created_at, updated_at')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .eq('plan_status', 'active')
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
      plan_status: 'draft',
      generated_by: 'ai',
      ai_explanation: truncateText(normalizedPlan.workoutPlan.explanation || '', 500)
    })
    .select('id')
    .single();
  if (createdWorkoutPlan.error) throw createdWorkoutPlan.error;
  const weeklyPlanId = createdWorkoutPlan.data.id;

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

    for (const [index, item] of day.exercises.entries()) {
      const exerciseId = String(item.exercise_id || '');
      if (!exerciseIds.has(exerciseId)) {
        throw new ApiRequestError(422, { error: `AI selected an invalid exercise id: ${exerciseId}` });
      }
      const exercise = exerciseById.get(exerciseId);
      const prescription = await prescribeWorkoutExercise({
        userId,
        exerciseId,
        exercise,
        source: 'ai_plan',
        suggestedSets: item.sets,
        suggestedReps: item.reps,
        suggestedWeightKg: item.weight_kg,
        suggestedRestSeconds: item.rest_seconds,
        suggestedTargetRpe: item.target_rpe
      });
      workoutRows.push(
        buildWeeklyWorkoutPlanRow({
          weeklyPlanId,
          dayIndex,
          item: { ...item, exercise_id: exerciseId },
          orderIndex: index,
          exercise,
          bodyWeightKg: Number(bodyMetrics.weight || 70),
          prescription
        })
      );
    }
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
    .eq('plan_status', 'active')
    .limit(20);
  if (existingFoodPlans.error) throw existingFoodPlans.error;

  const previousFoodPlanId = pickLatestByUpdatedAt(existingFoodPlans.data as any[])?.id || null;
  const createdFoodPlan = await supabase
    .from('weekly_food_plans')
    .insert({
      user_id: userId,
      name: 'AI Coach Meal Plan',
      week_start_date: weekStartKey,
      plan_status: 'draft',
      generated_by: 'ai',
      ai_explanation: truncateText(normalizedPlan.mealPlan.explanation || '', 500)
    })
    .select('id')
    .single();
  if (createdFoodPlan.error) throw createdFoodPlan.error;
  const foodPlanId = createdFoodPlan.data.id;

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

    if (recipeMode) {
      (day.meals || []).forEach((item, index) => {
        const recipeId = String(item.recipe_id || '');
        const recipe = recipeById.get(recipeId);
        if (!recipe) throw new ApiRequestError(422, { error: `AI selected an invalid recipe id: ${recipeId}` });
        const servings = Math.max(0.25, Math.min(6, Number(item.servings) || 1));
        mealRows.push({
          food_plan_id: foodPlanId, day_of_week: dayIndex, meal_type: item.meal_type,
          food_id: null, recipe_id: recipeId, quantity: servings,
          calories: Number(recipe.calories || 0), protein: Number(recipe.protein || 0),
          carbs: Number(recipe.carbs || 0), fat: Number(recipe.fat || 0), order_index: index, is_rest_day: false,
        });
      });
      continue;
    }
    const nutritionTargets = calculateNutritionMacroTargets({
      targetCalories: normalizedPlan.mealPlan.target_calories || lifestyle.target_calories,
      fitnessGoal: lifestyle.fitness_goal,
      dietPreference: lifestyle.diet_preference,
      weightKg: bodyMetrics.weight,
    });
    const completedMeals = completeAiMealDay(day.meals || [], foods, mealsPerDay);
    optimizeMealPlanQuantities(completedMeals, foods, nutritionTargets, mealsPerDay).forEach((item, index) => {
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

  // Keep replacement plans invisible to active-plan queries until every
  // required child row has been persisted. Old plans are retained if any
  // write above fails, leaving a retry-safe draft instead of a broken active plan.
  const activatedAt = new Date().toISOString();
  const activateWorkoutPlan = await supabase
    .from('weekly_plans')
    .update({ plan_status: 'active', updated_at: activatedAt })
    .eq('id', weeklyPlanId)
    .eq('plan_status', 'draft');
  if (activateWorkoutPlan.error) throw activateWorkoutPlan.error;

  const activateFoodPlan = await supabase
    .from('weekly_food_plans')
    .update({ plan_status: 'active', updated_at: activatedAt })
    .eq('id', foodPlanId)
    .eq('plan_status', 'draft');
  if (activateFoodPlan.error) throw activateFoodPlan.error;

  if (previousWorkoutPlanId) {
    const markOldWorkoutPlan = await supabase
      .from('weekly_plans')
      .update({ plan_status: 'adjusted', updated_at: activatedAt })
      .eq('id', previousWorkoutPlanId)
      .eq('plan_status', 'active');
    if (markOldWorkoutPlan.error) throw markOldWorkoutPlan.error;
  }
  if (previousFoodPlanId) {
    const markOldFoodPlan = await supabase
      .from('weekly_food_plans')
      .update({ plan_status: 'adjusted', updated_at: activatedAt })
      .eq('id', previousFoodPlanId)
      .eq('plan_status', 'active');
    if (markOldFoodPlan.error) throw markOldFoodPlan.error;
  }

  const recommendation = await supabase.from('ai_recommendations').insert({
    user_id: userId,
    plan_type: 'weekly_coach_plan',
    recommendation_content: normalizedPlan,
    status: 'active'
  });
  if (recommendation.error) console.warn('Failed to store ai_recommendations:', recommendation.error.message);

  const planType = previousWorkoutPlanId && previousFoodPlanId ? 'both'
    : previousWorkoutPlanId ? 'workout'
      : previousFoodPlanId ? 'meal'
        : 'both';
  const adjustment = await supabase.from('ai_plan_adjustments').insert({
    user_id: userId,
    plan_type: planType,
    source_type: premiumOnly ? 'premium_auto_generate' : 'ai_coach_generate',
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
    created_by: 'ai',
    status: 'applied',
    applied_at: new Date().toISOString()
  });
  if (adjustment.error) {
    console.warn('Failed to store ai_plan_adjustments:', adjustment.error.message);
  }

  return {
    weeklyPlanId,
    foodPlanId,
    workoutItems: workoutRows.length,
    mealItems: mealRows.length,
    weekStartDate: weekStartKey,
    membershipTier: accessState.membershipTier,
    aiQuota: buildAiQuotaSnapshot(accessState, premiumOnly ? undefined : 'planGenerations'),
    ai_json: {
      workout_plan: normalizedPlan.workoutPlan,
      meal_plan: normalizedPlan.mealPlan
    }
  };
}

export async function runPremiumMondayAutoPlanner() {
  const todayKey = getVietnamDateKey();
  const weekStartKey = todayKey;
  const premiumProfilesRes = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('membership_tier', ['plus', 'pro', 'premium']);

  if (premiumProfilesRes.error) throw premiumProfilesRes.error;

  const premiumProfiles = premiumProfilesRes.data || [];
  const result = {
    trigger: 'cron',
    weekStartDate: weekStartKey,
    totalPremium: premiumProfiles.length,
    generated: 0,
    skippedExisting: 0,
    skippedNotDue: 0,
    skippedWithoutPriorPlan: 0,
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

      const latestCycleStart = await getLatestCoachPlanCycleStart(userId);
      if (!latestCycleStart) {
        // Plus/Pro continues the seven-day plan the member already received;
        // it does not silently create a first plan before onboarding is done.
        result.skippedWithoutPriorPlan += 1;
        continue;
      }

      const nextCycleDate = addDaysToDateKey(latestCycleStart, 7);
      if (todayKey < nextCycleDate) {
        result.skippedNotDue += 1;
        continue;
      }

      await generateWeeklyCoachPlanForUser({
        userId,
        weekStartKey,
        premiumOnly: true,
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
      logOperational({ level: 'error', event: 'job_item_failed', jobName: 'premium_auto_planner', status: 'failed', errorCode: 'PREMIUM_PLAN_FAILED', message: error });
    }
  }

  return result;
}

const defaultAllowedOrigins = [
  'https://trend-fit.vercel.app'
];

const configuredOrigins = (
  (process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
    : defaultAllowedOrigins
  ).filter(Boolean)
);

const allowedOrigins = new Set(configuredOrigins);

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

app.use(requestIdMiddleware);
app.use(legacyErrorContractMiddleware);
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true
}));

app.use(generalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use('/api', accountRouter);

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Fitly API is live!',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'fitly-api',
  });
});

app.get('/ready', async (_req, res) => {
  const missingEnvironment = [
    ...['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]),
    ...(!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY
      ? ['SUPABASE_PUBLISHABLE_KEY_OR_SUPABASE_ANON_KEY']
      : []),
  ];

  if (missingEnvironment.length > 0) {
    return res.status(503).json({
      status: 'not_ready',
      checks: {
        environment: 'missing_required_variables',
        database: 'skipped',
      },
    });
  }

  try {
    const readinessQuery = supabase
      .from('profiles')
      .select('id', { head: true })
      .limit(1);
    const { error } = await awaitWithTimeout(readinessQuery, getReadyTimeoutMs());

    if (error) throw error;

    return res.status(200).json({
      status: 'ready',
      checks: {
        environment: 'ok',
        database: 'ok',
      },
    });
  } catch (error) {
    const failureReason = error instanceof ReadinessTimeoutError ? 'timeout' : 'unavailable';
    logOperational({ level: 'error', event: 'readiness_failed', status: failureReason, errorCode: failureReason === 'timeout' ? 'READINESS_TIMEOUT' : 'READINESS_UNAVAILABLE', message: 'Supabase connectivity check failed' });
    return res.status(503).json({
      status: 'not_ready',
      checks: {
        environment: 'ok',
        database: 'unavailable',
      },
    });
  }
});

const listLegacyAdminProfiles: RequestHandler = async (_req, res) => {
  try {
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('id, full_name, email, gender, birthday, role, membership_tier, created_at, updated_at');

    if (error) {
      console.error('[profiles] query failed:', error.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    res.json({ message: 'Ket noi thanh cong!', data });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const emptyBodySchema = z.object({}).strict();
const adminPayloadSchema = z.object({}).passthrough();
const dateKeySchema = z.string().regex(DATE_KEY_REGEX);
const dailyExercisesFromPlanSchema = z.object({ logDate: dateKeySchema }).strict();
const aiChatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  selectedDayIndex: z.number().int().min(0).max(6).optional(),
  weekStartDate: dateKeySchema.optional().or(z.literal('')),
  clientHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(1200),
  }).strict()).max(10).optional(),
}).strict();

app.post('/api/membership/renew', requireAuth, validateBody(emptyBodySchema), (_req, res) => {
  return res.status(503).json({
    error: 'Thanh toán đang tạm khóa cho đến khi tích hợp xác thực hóa đơn từ App Store và Google Play.',
    code: 'PAYMENT_PROVIDER_NOT_CONFIGURED'
  });
});

const parseStringArrayInput = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
};

const parseOptionalNumberInput = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type ExerciseFieldErrors = Record<string, string[]>;

class ExercisePayloadValidationError extends Error {
  fields: ExerciseFieldErrors;

  constructor(fields: ExerciseFieldErrors) {
    super('Invalid exercise payload');
    this.name = 'ExercisePayloadValidationError';
    this.fields = fields;
  }
}

const isPlainPayloadObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const appendExerciseFieldError = (errors: ExerciseFieldErrors, field: string, message: string) => {
  if (!errors[field]) errors[field] = [];
  errors[field].push(message);
};

const hasExercisePayloadErrors = (errors: ExerciseFieldErrors): boolean => Object.keys(errors).length > 0;

const hasExercisePayloadField = (payload: Record<string, unknown>, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(payload, field);

const trimExerciseText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const parseExerciseStringArray = (value: unknown): string[] => Array.from(new Set(
  (parseStringArrayInput(value) || []).map((item) => item.trim()).filter(Boolean)
));

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Normalizes only submitted fields on updates so pre-existing legacy rows can
 * still be read and edited incrementally. New catalog entries must contain a
 * complete canonical taxonomy and all eligibility metadata.
 */
const sanitizeExercisePayload = (
  rawValue: unknown,
  isCreate: boolean,
  expectedExerciseId?: string,
): Record<string, unknown> => {
  if (!isPlainPayloadObject(rawValue)) {
    throw new ExercisePayloadValidationError({ payload: ['must be a JSON object'] });
  }

  const raw = rawValue;
  const payload: Record<string, unknown> = {};
  const errors: ExerciseFieldErrors = {};
  const hasField = (field: string) => hasExercisePayloadField(raw, field);

  if (isCreate) {
    const id = trimExerciseText(raw.id);
    if (!id) appendExerciseFieldError(errors, 'id', 'is required');
    else if (!isExerciseId(id)) appendExerciseFieldError(errors, 'id', 'must be lowercase kebab-case');
    else payload.id = id;
  } else if (hasField('id')) {
    const submittedId = trimExerciseText(raw.id);
    if (!submittedId || submittedId !== expectedExerciseId) {
      appendExerciseFieldError(errors, 'id', 'cannot be changed');
    }
  }

  if (isCreate || hasField('name')) {
    const name = trimExerciseText(raw.name);
    if (!name) appendExerciseFieldError(errors, 'name', 'is required');
    else payload.name = name;
  }

  const assignCanonicalTaxonomy = (
    field: string,
    normalize: (value: unknown) => string | null,
  ) => {
    if (!hasField(field)) {
      if (isCreate) appendExerciseFieldError(errors, field, 'is required');
      return;
    }
    const rawText = trimExerciseText(raw[field]);
    if (!rawText) {
      appendExerciseFieldError(errors, field, 'is required');
      return;
    }
    const normalized = normalize(rawText);
    if (!normalized) {
      appendExerciseFieldError(errors, field, 'must use a supported canonical taxonomy value');
      return;
    }
    payload[field] = normalized;
  };

  assignCanonicalTaxonomy('body_part', normalizeBodyPart);
  assignCanonicalTaxonomy('target_muscle', normalizeBodyPart);
  assignCanonicalTaxonomy('equipment', normalizeEquipment);
  assignCanonicalTaxonomy('difficulty', normalizeDifficulty);
  assignCanonicalTaxonomy('movement_pattern', normalizeMovementPattern);

  const assignCanonicalTaxonomyList = (
    field: string,
    normalize: (value: unknown) => string | null,
  ) => {
    if (!hasField(field)) {
      if (isCreate) payload[field] = [];
      return;
    }
    if (raw[field] !== null && !Array.isArray(raw[field]) && typeof raw[field] !== 'string') {
      appendExerciseFieldError(errors, field, 'must be an array or comma-separated string');
      return;
    }
    const normalized: string[] = [];
    parseExerciseStringArray(raw[field]).forEach((item) => {
      const canonicalValue = normalize(item);
      if (!canonicalValue) {
        appendExerciseFieldError(errors, field, `contains unsupported taxonomy value: ${item}`);
      } else if (!normalized.includes(canonicalValue)) {
        normalized.push(canonicalValue);
      }
    });
    if (!errors[field]) payload[field] = normalized;
  };

  assignCanonicalTaxonomyList('secondary_muscles', normalizeBodyPart);
  assignCanonicalTaxonomyList('goal_type', normalizeGoalType);

  if (Array.isArray(payload.secondary_muscles) && typeof payload.target_muscle === 'string' &&
    payload.secondary_muscles.includes(payload.target_muscle)) {
    appendExerciseFieldError(errors, 'secondary_muscles', 'must not include target_muscle');
  }

  if (!hasField('training_locations')) {
    if (isCreate) appendExerciseFieldError(errors, 'training_locations', 'is required');
  } else if (raw.training_locations !== null && !Array.isArray(raw.training_locations) && typeof raw.training_locations !== 'string') {
    appendExerciseFieldError(errors, 'training_locations', 'must be an array or comma-separated string');
  } else {
    const locations: string[] = [];
    parseExerciseStringArray(raw.training_locations).forEach((item) => {
      const location = normalizeTrainingLocation(item);
      if (!location) {
        appendExerciseFieldError(errors, 'training_locations', `contains unsupported location: ${item}`);
      } else if (!locations.includes(location)) {
        locations.push(location);
      }
    });
    if (locations.length === 0) appendExerciseFieldError(errors, 'training_locations', 'must include home or gym');
    if (!errors.training_locations) payload.training_locations = locations;
  }

  const assignIntegerMetadata = (field: string, min: number, max: number) => {
    if (!hasField(field)) {
      if (isCreate) appendExerciseFieldError(errors, field, 'is required');
      return;
    }
    const rawNumber = raw[field];
    if (rawNumber === null || rawNumber === '' || (typeof rawNumber === 'string' && !rawNumber.trim())) {
      appendExerciseFieldError(errors, field, 'is required');
      return;
    }
    const parsed = Number(rawNumber);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      appendExerciseFieldError(errors, field, `must be an integer from ${min} to ${max}`);
      return;
    }
    payload[field] = parsed;
  };

  assignIntegerMetadata('min_experience_months', 0, 120);
  assignIntegerMetadata('progression_level', 1, 5);

  if (hasField('contraindications')) {
    if (raw.contraindications !== null && !Array.isArray(raw.contraindications) && typeof raw.contraindications !== 'string') {
      appendExerciseFieldError(errors, 'contraindications', 'must be an array or comma-separated string');
    } else {
      payload.contraindications = parseExerciseStringArray(raw.contraindications);
    }
  } else if (isCreate) {
    payload.contraindications = [];
  }

  const assignOptionalNumber = (field: string, validate: (value: number) => boolean, message: string) => {
    if (!hasField(field)) return;
    const rawNumber = raw[field];
    if (rawNumber === null || rawNumber === '' || (typeof rawNumber === 'string' && !rawNumber.trim())) {
      payload[field] = null;
      return;
    }
    const parsed = Number(rawNumber);
    if (!Number.isFinite(parsed) || !validate(parsed)) {
      appendExerciseFieldError(errors, field, message);
      return;
    }
    payload[field] = parsed;
  };

  assignOptionalNumber(
    'estimated_duration_seconds',
    (value) => Number.isInteger(value) && value > 0,
    'must be a positive integer or null',
  );
  assignOptionalNumber(
    'calories_per_minute',
    (value) => value >= 0,
    'must be a non-negative number or null',
  );

  ['video_url'].forEach((field) => {
    if (!hasField(field)) return;
    const url = trimExerciseText(raw[field]);
    if (!url) {
      payload[field] = null;
    } else if (!isHttpUrl(url)) {
      appendExerciseFieldError(errors, field, 'must be a valid http(s) URL or null');
    } else {
      payload[field] = url;
    }
  });

  if (isCreate || hasField('instructions')) {
    const rawInstructions = hasField('instructions') ? raw.instructions : {};
    if (rawInstructions !== null && !Array.isArray(rawInstructions) && typeof rawInstructions !== 'string' && !isPlainPayloadObject(rawInstructions)) {
      appendExerciseFieldError(errors, 'instructions', 'must be an object, array, string, or null');
    } else {
      const instructions = normalizeExerciseInstructions(rawInstructions);
      const selfId = isCreate ? String(payload.id || '') : String(expectedExerciseId || '');
      (['easier_variation_id', 'harder_variation_id'] as const).forEach((field) => {
        const variationId = instructions[field];
        if (!variationId) return;
        if (!isExerciseId(variationId)) {
          appendExerciseFieldError(errors, `instructions.${field}`, 'must be lowercase kebab-case');
        } else if (variationId === selfId) {
          appendExerciseFieldError(errors, `instructions.${field}`, 'cannot reference this exercise');
        }
      });
      payload.instructions = instructions satisfies ExerciseInstructions;
    }
  }

  if (hasExercisePayloadErrors(errors)) throw new ExercisePayloadValidationError(errors);
  if (!isCreate && Object.keys(payload).length === 0) {
    throw new ExercisePayloadValidationError({ payload: ['must include at least one editable field'] });
  }
  return payload;
};

const validateExerciseVariationReferences = async (payload: Record<string, unknown>) => {
  const instructions = payload.instructions as ExerciseInstructions | undefined;
  if (!instructions) return;

  const references = (['easier_variation_id', 'harder_variation_id'] as const)
    .map((field) => ({ field: `instructions.${field}`, id: instructions[field] }))
    .filter((reference): reference is { field: string; id: string } => Boolean(reference.id));
  if (references.length === 0) return;

  const variationIds = Array.from(new Set(references.map((reference) => reference.id)));
  const existingRes = await supabase
    .from('exercises')
    .select('id')
    .in('id', variationIds);
  if (existingRes.error) throw existingRes.error;

  const existingIds = new Set((existingRes.data || []).map((exercise: any) => String(exercise.id || '')));
  const errors: ExerciseFieldErrors = {};
  references.forEach((reference) => {
    if (!existingIds.has(reference.id)) {
      appendExerciseFieldError(errors, reference.field, `references an exercise that does not exist: ${reference.id}`);
    }
  });
  if (hasExercisePayloadErrors(errors)) throw new ExercisePayloadValidationError(errors);
};

const ensureExerciseIdAvailable = async (exerciseId: string) => {
  const existingRes = await supabase
    .from('exercises')
    .select('id')
    .eq('id', exerciseId)
    .maybeSingle();
  if (existingRes.error) throw existingRes.error;
  if (existingRes.data?.id) {
    throw new ExercisePayloadValidationError({ id: ['already exists'] });
  }
};

const toExercisePayloadError = (error: unknown): ValidationError => {
  if (error instanceof ExercisePayloadValidationError || String((error as { code?: unknown } | undefined)?.code || '') === '23505') {
    return new ValidationError();
  }
  return new ValidationError();
};

const sanitizeFoodPayload = (raw: any) => {
  const payload: Record<string, unknown> = {};
  const textFields = [
    'name',
    'category',
    'serving_unit',
    'image_url',
    'price_level',
    'region'
  ];
  textFields.forEach((field) => {
    if (raw?.[field] !== undefined) payload[field] = String(raw[field] || '').trim() || null;
  });

  ['calories', 'protein', 'carbs', 'fat', 'cooking_time_minutes'].forEach((field) => {
    const value = parseOptionalNumberInput(raw?.[field]);
    if (value !== undefined) payload[field] = value;
  });

  const mealType = parseStringArrayInput(raw?.meal_type);
  if (mealType !== undefined) payload.meal_type = mealType;

  const goalType = parseStringArrayInput(raw?.goal_type);
  if (goalType !== undefined) payload.goal_type = goalType;

  const allergens = parseStringArrayInput(raw?.allergens);
  if (allergens !== undefined) payload.allergens = normalizeAllergies(allergens);

  ['dietary_tags', 'ingredient_metadata', 'animal_source'].forEach((field) => {
    const values = parseStringArrayInput(raw?.[field]);
    if (values !== undefined) payload[field] = values;
  });
  if (raw?.is_active !== undefined) payload.is_active = Boolean(raw.is_active);

  if (raw?.is_easy_to_prepare !== undefined) {
    payload.is_easy_to_prepare = Boolean(raw.is_easy_to_prepare);
  }

  if (!String(payload.name || '').trim()) {
    throw new Error('Food name is required');
  }

  return payload;
};

const countCatalogUsage = async (table: string, column: string, value: string): Promise<number> => {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  if (error) throw error;
  return count || 0;
};

const loadAdminCount = async (
  label: string,
  request: PromiseLike<{ count: number | null; error: any }>
): Promise<number> => {
  try {
    const { count, error } = await request;
    if (error) {
      console.warn(`[admin-overview] Failed to load ${label}:`, error.message || error);
      return 0;
    }
    return count || 0;
  } catch (error: any) {
    console.warn(`[admin-overview] Failed to load ${label}:`, error?.message || error);
    return 0;
  }
};

// Diet Plan's manual picker calls this before persisting. This closes the
// former direct-client write path with the same hard eligibility rules used by AI.
const RECIPE_WITH_INGREDIENTS_SELECT = '*, recipe_ingredients(id, recipe_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index)';

const sanitizeRecipeAdminPayload = (source: unknown) => {
  const raw = source && typeof source === 'object' ? source as Record<string, unknown> : {};
  const normalized = normalizeRecipe(raw);
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map((ingredient, order_index) => ({ ...normalizeRecipeIngredient(ingredient), recipe_id: normalized.id, order_index }));
  return { recipe: normalized, ingredients };
};

const withRecipeIngredientMetadata = async (ingredients: Array<Record<string, unknown>>) => {
  return ingredients as RecipeIngredientWithFood[];
};

const recipeValidationResponse = (source: unknown, ingredients: RecipeIngredientWithFood[]) => {
  const validation = validateRecipe(source, ingredients);
  return validation.valid ? null : { error: 'Recipe validation failed', fields: { recipe: validation.errors }, warnings: validation.warnings };
};

const nutritionHandlers = createNutritionHandlers({
  supabase,
  getAuthUserId,
  buildRecipeEligibilityContext,
  filterEligibleRecipes,
  ExternalProviderError,
  RECIPE_WITH_INGREDIENTS_SELECT,
});

registerNutritionRoutes(app, {
  validateFoods: nutritionHandlers.validateFoods,
  getRecipe: nutritionHandlers.getRecipe,
});

const adminHandlers = createAdminHandlers({
  supabase,
  getVietnamDateKey,
  addDays,
  getAuthUserId,
  isAdminUser,
  requireAdminUserId,
  loadAdminCount,
  sanitizeExercisePayload,
  validateExerciseVariationReferences,
  ensureExerciseIdAvailable,
  toExercisePayloadError,
  countCatalogUsage,
  sanitizeRecipeAdminPayload,
  recipeValidationResponse,
  withRecipeIngredientMetadata,
  RECIPE_WITH_INGREDIENTS_SELECT,
  ExternalProviderError,
});

registerAdminRoutes(app, {
  adminPayloadSchema,
  profileList: listLegacyAdminProfiles,
  overview: adminHandlers.overview,
  users: adminHandlers.users,
  listExercises: adminHandlers.listExercises,
  createExercise: adminHandlers.createExercise,
  updateExercise: adminHandlers.updateExercise,
  deleteExercise: adminHandlers.deleteExercise,
  listRecipes: adminHandlers.listRecipes,
  createRecipe: adminHandlers.createRecipe,
  updateRecipe: adminHandlers.updateRecipe,
  listFoods: adminHandlers.listFoods,
  createFood: adminHandlers.createFood,
  updateFood: adminHandlers.updateFood,
  deleteFood: adminHandlers.deleteFood,
});

const workoutHandlers = createWorkoutHandlers({ supabase, getAuthUserId, DATE_KEY_REGEX, DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT, addDaysToDateKey, getDayOffsetBetweenDateKeys, buildExerciseEligibilityContext, getExerciseEligibilityDecision, getLatestBodyWeightKg, estimateWorkoutKcal, buildDailyExerciseSessionRow, ApiRequestError, isDatabaseMigrationRequiredError, databaseMigrationRequiredResponse, ExternalProviderError, getAiCoachAccessState, buildAiQuotaLimitError, AI_EXERCISE_CATALOG_FETCH_LIMIT, normalizeKeywordText, getEligibleExercises, prescribeWorkoutExercise, recordAiQuotaUsage, buildAiQuotaSnapshot, truncateText, getExerciseMetaForKcal, loadDailyExerciseSessionWithExerciseMeta, upsertWorkoutSessionExerciseFromDailySession, syncWorkoutCaloriesBurnedForDate, calculateCompletedExerciseKcal, parseAverageReps });

registerWorkoutRoutes(app, {
  aiLimiter,
  dailyExercisesFromPlanSchema,
  materializeFromPlan: workoutHandlers.materializeFromPlan,
  replaceDailyExercise: workoutHandlers.replaceDailyExercise,
  createDailyExercise: workoutHandlers.createDailyExercise,
  updateDailyExerciseConfig: workoutHandlers.updateDailyExerciseConfig,
  updateDailyExerciseCompletion: workoutHandlers.updateDailyExerciseCompletion,
  completeDailyExerciseSet: workoutHandlers.completeDailyExerciseSet,
});

const aiCoachHandlers = createAiCoachHandlers({ addDays, AI_ACTION_FLOW_ENABLED, AI_CHAT_DAY_LABELS, AI_EXERCISE_CATALOG_FETCH_LIMIT, AI_EXERCISE_CATALOG_LIMIT, AI_FOOD_CATALOG_FETCH_LIMIT, aiChatService, aiPlannerService, ApiRequestError, balanceWorkoutDays, buildAiCoachProgressSummary, buildAiExerciseCatalog, buildAiQuotaLimitError, buildAiQuotaSnapshot, buildCoachDataContext, buildCompactRecipeCatalog, buildDailyExerciseSessionRow, buildExerciseEligibilityContext, buildMealPlanningCatalog, buildRecipeEligibilityContext, buildSafetyPromptAddendum, buildTodayStatus, buildWeeklyWorkoutPlanRow, buildWorkoutSessionExerciseRow, calculateNutritionMacroTargets, clampList, DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT, databaseMigrationRequiredResponse, DATE_KEY_REGEX, detectIntent, enforceTrainingPrescription, estimateWorkoutKcal, executeCoachCommand, ExternalProviderError, extractDayIndexFromText, filterEligibleRecipes, getAdjustmentApplyDecision, getAiCoachAccessState, getAuthUserId, getDateKeyFromWeekStartAndDayIndex, getEligibleExercises, getFoodSafetyDecision, getMealPlanningSlots, getResponseModeForIntent, getVietnamDateKey, getWeekStartKey, incrementMetric, InternalConfigurationError, isAdminUser, isDatabaseMigrationRequiredError, isMealFoodEligible, isMealIntent, isValidDayIndex, logAIEvent, mealAdjusterService, normalizeAiPlanPayload, normalizeVietForChat, parseJsonFromAiText, pickLatestByUpdatedAt, prescribeWorkoutExercise, processNaturalTracking, progressAnalyzerService, rankExercises, recordAiQuotaUsage, resolveAiExerciseReferences, resolveMealPlanningMealsPerDay, sanitizeAndBalanceRecipeProposal, sanitizeWorkoutPlanForUser, snapshotAIMetrics, startWorkoutPlanOnCreationDay, supabase, synchronizeTrainingProfileContext, toAiProviderRequestError, toDayOfWeekIndex, truncateText, validateActionPayload, validateExerciseProposal, workoutAdjusterService });

registerAiCoachRoutes(app, {
  aiLimiter,
  aiChatSchema,
  getQuota: aiCoachHandlers.getQuota,
  chat: aiCoachHandlers.chat,
  coachCommand: aiCoachHandlers.coachCommand,
  clearChat: aiCoachHandlers.clearChat,
  applyAdjustment: aiCoachHandlers.applyAdjustment,
  rejectAdjustment: aiCoachHandlers.rejectAdjustment,
  metrics: aiCoachHandlers.metrics,
  generateDailyWorkout: aiCoachHandlers.generateDailyWorkout,
  generateWeeklyPlan: aiCoachHandlers.generateWeeklyPlan,
  generateMealPlan: aiCoachHandlers.generateMealPlan,
  recordMealSwap: aiCoachHandlers.recordMealSwap,
  generateOnboardingMealPlan: aiCoachHandlers.generateOnboardingMealPlan,
});

app.use(notFoundHandler);
app.use(errorHandler);

