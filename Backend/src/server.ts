import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import { supabase } from './config/Supabase';
import { initTelegramBot } from './TelegramBot';
import { type TrainingPrescription } from './lib/TrainingPrescription';
import { synchronizeTrainingProfileContext } from './services/trainingProfileContextService';
import { detectIntent, extractDayIndexFromText, getResponseModeForIntent } from './services/ai/aiRouterService';
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
import { createTelegramLinkToken } from './lib/telegramLinkToken';
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

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Port 5000 is commonly occupied by macOS AirPlay Receiver.
const PORT = process.env.PORT || 5001;
const AI_ACTION_FLOW_ENABLED = process.env.AI_ACTION_FLOW_ENABLED !== 'false';
const PREMIUM_AUTO_PLAN_ENABLED = process.env.PREMIUM_AUTO_PLAN_ENABLED !== 'false';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AI_EXERCISE_CATALOG_LIMIT = 48;
const AI_EXERCISE_CATALOG_FETCH_LIMIT = 500;
const AI_FOOD_CATALOG_LIMIT = 72;
const AI_FOOD_CATALOG_FETCH_LIMIT = 320;
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
    query = query.eq('plan_type', 'workout');
  } else if (quotaKey === 'mealAdjustments') {
    query = query.eq('plan_type', 'meal');
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

// Weekly plans are stored Monday–Sunday so they can be materialized into
// calendar dates consistently. When a user creates a plan mid-week, rotate
// the AI's sequence so its first workout lands on today rather than leaving
// the user with a rest day on their first visit.
const startWorkoutPlanOnCreationDay = (
  workoutPlan: NormalizedAiPlan['workoutPlan'],
  planStartKey: string,
) => {
  const todayKey = getVietnamDateKey();
  if (planStartKey !== todayKey) return workoutPlan;

  const firstTrainingDay = [...workoutPlan.days]
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .find((day) => !day.is_rest_day && day.exercises.length > 0);
  if (!firstTrainingDay) return workoutPlan;

  const offset = (7 - firstTrainingDay.day_of_week) % 7;
  if (offset === 0) return workoutPlan;

  return {
    ...workoutPlan,
    days: workoutPlan.days.map((day) => ({
      ...day,
      day_of_week: (day.day_of_week + offset) % 7,
    })),
  };
};

const startMealPlanOnCreationDay = (
  mealPlan: NormalizedAiPlan['mealPlan'],
  planStartKey: string,
) => {
  const todayKey = getVietnamDateKey();
  if (planStartKey !== todayKey) return mealPlan;

  const firstMealDay = [...mealPlan.days]
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .find((day) => day.meals.length > 0);
  if (!firstMealDay) return mealPlan;

  const offset = (7 - firstMealDay.day_of_week) % 7;
  if (offset === 0) return mealPlan;

  return {
    ...mealPlan,
    days: mealPlan.days.map((day) => ({
      ...day,
      day_of_week: (day.day_of_week + offset) % 7,
    })),
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
    .map((item: any) => `d=${item.day_of_week || item.log_date || ''}|${item.meal_type}|${truncateText(item.foods?.name || item.custom_food_name || item.food_id, 28)}|qty=${item.quantity}`)
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

async function runPremiumMondayAutoPlanner() {
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
      console.error('[premium-auto-planner] Failed for one premium user:', error?.message || 'unknown_error');
    }
  }

  return result;
}

const PREMIUM_AUTO_PLAN_CRON = process.env.PREMIUM_AUTO_PLAN_CRON || '5 0 * * *';
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
      console.log(`[premium-auto-planner] Checking completed plan cycles at ${new Date().toISOString()}`);
      try {
        const result = await runPremiumMondayAutoPlanner();
        console.log('[premium-auto-planner] Result:', JSON.stringify({
          trigger: result.trigger,
          weekStartDate: result.weekStartDate,
          totalPremium: result.totalPremium,
          generated: result.generated,
          skippedExisting: result.skippedExisting,
          skippedNotDue: result.skippedNotDue,
          skippedWithoutPriorPlan: result.skippedWithoutPriorPlan,
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

// Telegram bot khởi tạo tự động trên Production (Render).
// Ở môi trường local dev, bot chỉ bật khi có TELEGRAM_FORCE_ENABLE=true hoặc TELEGRAM_ENABLE_POLLING=true để tránh lỗi Telegram 409 Conflict với Render server.
const shouldInitBot = process.env.TELEGRAM_BOT_ENABLED !== 'false' && (
  IS_PRODUCTION ||
  process.env.TELEGRAM_FORCE_ENABLE === 'true' ||
  process.env.TELEGRAM_ENABLE_POLLING === 'true'
);
const telegramBot = shouldInitBot ? initTelegramBot() : null;

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
      .select('id, full_name, email, gender, birthday, role, membership_tier, telegram_chat_id, created_at, updated_at');

    if (error) {
      console.error('[profiles] query failed:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Ket noi thanh cong!', data });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const addMonthsToUtcDate = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

app.post('/api/membership/renew', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const requestedTier = normalizeMembershipTier(req.body?.tier);
    if (requestedTier === 'free') {
      return res.status(400).json({ error: 'Vui lòng chọn gói Plus hoặc Pro để gia hạn.' });
    }

    const profileRes = await supabase
      .from('profiles')
      .select('id, membership_tier, membership_expires_at')
      .eq('id', authUserId)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;

    const now = new Date();
    const currentExpiresAt = profileRes.data?.membership_expires_at
      ? new Date(profileRes.data.membership_expires_at)
      : null;
    const baseDate = currentExpiresAt && currentExpiresAt > now ? currentExpiresAt : now;
    const nextExpiresAt = addMonthsToUtcDate(baseDate, 1).toISOString();

    const updateRes = await supabase
      .from('profiles')
      .update({
        membership_tier: requestedTier,
        membership_expires_at: nextExpiresAt,
        updated_at: now.toISOString()
      })
      .eq('id', authUserId)
      .select('id, membership_tier, membership_expires_at')
      .maybeSingle();
    if (updateRes.error) throw updateRes.error;

    res.json({
      success: true,
      data: updateRes.data
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Không thể gia hạn gói lúc này.' });
  }
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

const sendExercisePayloadError = (res: express.Response, error: any, fallback: string) => {
  if (error instanceof ExercisePayloadValidationError) {
    return res.status(400).json({ error: error.message, fields: error.fields });
  }
  if (String(error?.code || '') === '23505') {
    return res.status(400).json({
      error: 'Invalid exercise payload',
      fields: { id: ['already exists'] }
    });
  }
  return res.status(400).json({ error: error?.message || fallback });
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

app.get('/api/admin/overview', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const today = getVietnamDateKey();
    const sevenDaysAgo = addDays(new Date(), -7).toISOString();

    const [
      usersRes,
      premiumRes,
      newUsersRes,
      telegramLinkedRes,
      exercisesRes,
      foodsRes,
      aiProposedRes,
      aiAppliedRes,
      aiRejectedRes,
      workoutDoneRes,
      mealsDoneRes
    ] = await Promise.all([
      loadAdminCount('profiles', supabase.from('profiles').select('id', { count: 'exact', head: true })),
      loadAdminCount('premium profiles', supabase.from('profiles').select('id', { count: 'exact', head: true }).in('membership_tier', ['plus', 'pro', 'premium'])),
      loadAdminCount('new users', supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo)),
      loadAdminCount('telegram linked users', supabase.from('profiles').select('id', { count: 'exact', head: true }).not('telegram_chat_id', 'is', null)),
      loadAdminCount('exercises', supabase.from('exercises').select('id', { count: 'exact', head: true })),
      loadAdminCount('foods', supabase.from('foods').select('id', { count: 'exact', head: true })),
      loadAdminCount('ai proposed adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'proposed')),
      loadAdminCount('ai applied adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'applied')),
      loadAdminCount('ai rejected adjustments', supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'rejected')),
      loadAdminCount('today completed workouts', supabase.from('daily_exercise_sessions').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true)),
      loadAdminCount('today completed meals', supabase.from('daily_meal_logs').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true))
    ]);

    res.json({
      success: true,
      data: {
        users: usersRes,
        premiumUsers: premiumRes,
        newUsers7d: newUsersRes,
        telegramLinkedUsers: telegramLinkedRes,
        exercises: exercisesRes,
        foods: foodsRes,
        aiAdjustments: {
          proposed: aiProposedRes,
          applied: aiAppliedRes,
          rejected: aiRejectedRes
        },
        todayCompletedWorkouts: workoutDoneRes,
        todayCompletedMeals: mealsDoneRes
      }
    });
  } catch (error: any) {
    console.error('[admin-overview] failed:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
    const buildProfilesRequest = (columns: string) => {
      let request = supabase
        .from('profiles')
        .select(columns)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (query) {
        request = request.or(`full_name.ilike.%${query}%,email.ilike.%${query}%`);
      }

      return request;
    };

    const fullColumns = 'id, full_name, email, gender, birthday, role, membership_tier, membership_expires_at, telegram_chat_id, created_at, updated_at';
    const fallbackColumns = 'id, full_name, email, role, membership_tier, created_at, updated_at';
    let { data, error } = await buildProfilesRequest(fullColumns);

    if (error) {
      console.warn('[admin-users] full profile query failed, retrying with minimal columns:', error.message || error);
      const fallbackResult = await buildProfilesRequest(fallbackColumns);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.get('/api/admin/exercises', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase
      .from('exercises')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      request = request.or(`name.ilike.%${query}%,body_part.ilike.%${query}%,target_muscle.ilike.%${query}%,equipment.ilike.%${query}%`);
    }

    const { data, error } = await request;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.post('/api/admin/exercises', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const payload = sanitizeExercisePayload(req.body, true);
    await ensureExerciseIdAvailable(String(payload.id));
    await validateExerciseVariationReferences(payload);
    const { data, error } = await supabase.from('exercises').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    return sendExercisePayloadError(res, error, 'Failed to create exercise');
  }
});

app.put('/api/admin/exercises/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const exerciseId = String(req.params.id || '').trim();
    const payload = sanitizeExercisePayload(req.body, false, exerciseId);
    await validateExerciseVariationReferences(payload);
    payload.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('exercises')
      .update(payload)
      .eq('id', exerciseId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Exercise not found' });
    res.json({ success: true, data });
  } catch (error: any) {
    return sendExercisePayloadError(res, error, 'Failed to update exercise');
  }
});

app.delete('/api/admin/exercises/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const exerciseId = String(req.params.id || '').trim();
    const [weeklyUsage, dailyUsage] = await Promise.all([
      countCatalogUsage('weekly_plan_exercises', 'exercise_id', exerciseId),
      countCatalogUsage('daily_exercise_sessions', 'exercise_id', exerciseId)
    ]);
    if (weeklyUsage + dailyUsage > 0) {
      return res.status(409).json({
        error: 'Exercise is used in workout plans or logs and cannot be deleted safely.',
        usage: { weeklyUsage, dailyUsage }
      });
    }

    const { error } = await supabase.from('exercises').delete().eq('id', exerciseId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to delete exercise' });
  }
});

// Diet Plan's manual picker calls this before persisting. This closes the
// former direct-client write path with the same hard eligibility rules used by AI.
app.post('/api/meal-plans/validate-foods', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const foodIds: string[] = Array.from(new Set<string>(
      (Array.isArray(req.body?.food_ids) ? req.body.food_ids : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean),
    ));
    const recipeIds: string[] = Array.from(new Set<string>(
      (Array.isArray(req.body?.recipe_ids) ? req.body.recipe_ids : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean),
    ));
    if (foodIds.length === 0 && recipeIds.length === 0) return res.json({ success: true });

    const [profileRes, lifestyleRes, healthRes, foodsRes, recipesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('foods').select('id, name, category, allergens, dietary_tags, ingredient_metadata, animal_source, is_active, price_level, goal_type').in('id', foodIds),
      supabase.from('recipes').select('id, name, meal_type, dietary_restrictions, diet_styles, goal_type, price_level, calories, protein, carbs, fat, cooking_time_minutes, cooking_difficulty, allergens, instructions, is_active, recipe_ingredients(id, recipe_id, food_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index, foods:food_id(id, category, allergens, dietary_tags, ingredient_metadata, animal_source))').in('id', recipeIds),
    ]);
    const firstError = [profileRes.error, lifestyleRes.error, healthRes.error, foodsRes.error, recipesRes.error].find(Boolean);
    if (firstError) throw firstError;
    const context = { profile: profileRes.data || {}, lifestyle: lifestyleRes.data || {}, health: healthRes.data || {} };
    const byId = new Map((foodsRes.data || []).map((food: any) => [String(food.id), food]));
    const rejected = foodIds.flatMap((foodId) => {
      const decision = getFoodSafetyDecision(byId.get(foodId), context);
      return decision.allowed ? [] : [{ food_id: foodId, reasons: decision.reasons }];
    });
    const recipeContext = buildRecipeEligibilityContext(context);
    const recipeById = new Map((recipesRes.data || []).map((recipe: any) => [String(recipe.id), recipe]));
    recipeIds.forEach((recipeId) => {
      const decision = filterEligibleRecipes([recipeById.get(recipeId)].filter(Boolean), recipeContext);
      if (decision.length !== 1) rejected.push({ food_id: recipeId, reasons: ['ineligible_recipe'] });
    });
    if (rejected.length > 0) {
      return res.status(422).json({ error: 'One or more foods violate hard dietary or safety constraints.', rejected });
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Failed to validate meal foods' });
  }
});

const RECIPE_WITH_INGREDIENTS_SELECT = '*, recipe_ingredients(id, recipe_id, food_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index, foods:food_id(id, name, category, allergens, dietary_tags, ingredient_metadata, animal_source))';

const sanitizeRecipeAdminPayload = (source: unknown) => {
  const raw = source && typeof source === 'object' ? source as Record<string, unknown> : {};
  const normalized = normalizeRecipe(raw);
  const ingredients = (Array.isArray(raw.ingredients) ? raw.ingredients : [])
    .map((ingredient, order_index) => ({ ...normalizeRecipeIngredient(ingredient), recipe_id: normalized.id, order_index }));
  return { recipe: normalized, ingredients };
};

const withRecipeIngredientMetadata = async (ingredients: Array<Record<string, unknown>>) => {
  const ids = Array.from(new Set(ingredients.map((item) => String(item.food_id || '')).filter(Boolean)));
  if (!ids.length) return ingredients as RecipeIngredientWithFood[];
  const foods = await supabase.from('foods').select('id, category, allergens, dietary_tags, ingredient_metadata, animal_source').in('id', ids);
  if (foods.error) throw foods.error;
  const byId = new Map((foods.data || []).map((food: any) => [String(food.id), food]));
  return ingredients.map((ingredient) => ({ ...ingredient, food: byId.get(String(ingredient.food_id || '')) || null })) as RecipeIngredientWithFood[];
};

const recipeValidationResponse = (source: unknown, ingredients: RecipeIngredientWithFood[]) => {
  const validation = validateRecipe(source, ingredients);
  return validation.valid ? null : { error: 'Recipe validation failed', fields: { recipe: validation.errors }, warnings: validation.warnings };
};

app.get('/api/recipes/:id', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id || '').trim();
    const { data, error } = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Recipe not found' });
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Failed to load recipe' });
  }
});

app.get('/api/admin/recipes', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).order('updated_at', { ascending: false }).limit(limit);
    if (query) request = request.or(`id.ilike.%${query}%,name.ilike.%${query}%,name_en.ilike.%${query}%,region.ilike.%${query}%`);
    const { data, error } = await request;
    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load recipes' });
  }
});

app.post('/api/admin/recipes', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const { recipe, ingredients } = sanitizeRecipeAdminPayload(req.body);
    const validationError = recipeValidationResponse(recipe, await withRecipeIngredientMetadata(ingredients));
    if (validationError) return res.status(422).json(validationError);
    const { data, error } = await supabase.from('recipes').insert(recipe).select('*').single();
    if (error) throw error;
    if (ingredients.length) {
      const inserted = await supabase.from('recipe_ingredients').insert(ingredients);
      if (inserted.error) throw inserted.error;
    }
    const result = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', data.id).single();
    if (result.error) throw result.error;
    return res.status(201).json({ success: true, data: result.data });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Failed to create recipe' });
  }
});

app.put('/api/admin/recipes/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;
    const id = String(req.params.id || '').trim();
    const { recipe, ingredients } = sanitizeRecipeAdminPayload({ ...(req.body || {}), id });
    const validationError = recipeValidationResponse(recipe, await withRecipeIngredientMetadata(ingredients));
    if (validationError) return res.status(422).json(validationError);
    const updated = await supabase.from('recipes').update({ ...recipe, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return res.status(404).json({ error: 'Recipe not found' });
    const removed = await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
    if (removed.error) throw removed.error;
    if (ingredients.length) {
      const inserted = await supabase.from('recipe_ingredients').insert(ingredients);
      if (inserted.error) throw inserted.error;
    }
    const result = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', id).single();
    if (result.error) throw result.error;
    return res.json({ success: true, data: result.data });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Failed to update recipe' });
  }
});

app.get('/api/admin/foods', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 120));
    let request = supabase
      .from('foods')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      request = request.or(`name.ilike.%${query}%,category.ilike.%${query}%,region.ilike.%${query}%`);
    }

    const { data, error } = await request;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.post('/api/admin/foods', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const payload = sanitizeFoodPayload(req.body);
    const { data, error } = await supabase.from('foods').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to create food' });
  }
});

app.put('/api/admin/foods/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const foodId = String(req.params.id || '').trim();
    const payload = sanitizeFoodPayload(req.body);
    const { data, error } = await supabase
      .from('foods')
      .update(payload)
      .eq('id', foodId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Food not found' });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to update food' });
  }
});

app.delete('/api/admin/foods/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const foodId = String(req.params.id || '').trim();
    const [weeklyUsage, dailyUsage] = await Promise.all([
      countCatalogUsage('weekly_food_items', 'food_id', foodId),
      countCatalogUsage('daily_meal_logs', 'food_id', foodId)
    ]);
    if (weeklyUsage + dailyUsage > 0) {
      return res.status(409).json({
        error: 'Food is used in meal plans or logs and cannot be deleted safely.',
        usage: { weeklyUsage, dailyUsage }
      });
    }

    const { error } = await supabase.from('foods').delete().eq('id', foodId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to delete food' });
  }
});

app.post('/api/workout/daily-exercises/from-plan', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const logDate = String(req.body?.logDate || '').trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }

    const existingDailyRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (existingDailyRes.error) throw existingDailyRes.error;
    if ((existingDailyRes.data || []).length > 0) {
      return res.json({
        exercises: existingDailyRes.data || [],
        workoutSessionId: null,
        source: 'existing'
      });
    }

    const planRes = await supabase
      .from('weekly_plans')
      .select('id, week_start_date, created_at, updated_at')
      .eq('user_id', authUserId)
      .gte('week_start_date', addDaysToDateKey(logDate, -6))
      .lte('week_start_date', logDate)
      .eq('plan_status', 'active')
      .limit(20);
    if (planRes.error) throw planRes.error;

    const plan = [...((planRes.data || []) as any[])]
      .filter((item) => {
        const planStartKey = String(item.week_start_date || '');
        const dayOffset = getDayOffsetBetweenDateKeys(planStartKey, logDate);
        return DATE_KEY_REGEX.test(planStartKey) && dayOffset >= 0 && dayOffset <= 6;
      })
      .sort((a, b) => {
        const startComparison = String(b.week_start_date || '').localeCompare(String(a.week_start_date || ''));
        return startComparison || new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      })[0];
    if (!plan?.id) {
      return res.json({
        exercises: [],
        workoutSessionId: null,
        weeklyPlanId: null,
        source: 'no_plan'
      });
    }

    const dayIndex = getDayOffsetBetweenDateKeys(String(plan.week_start_date), logDate);

    const planExercisesRes = await supabase
      .from('weekly_plan_exercises')
      .select(`
        *,
        exercises:exercise_id (id, name, video_url, target_muscle, body_part, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, instructions, calories_per_minute)
      `)
      .eq('weekly_plan_id', plan.id)
      .eq('day_of_week', dayIndex)
      .order('order_index', { ascending: true });
    if (planExercisesRes.error) throw planExercisesRes.error;

    const planExercises = (planExercisesRes.data || []).filter((item: any) => item.exercise_id && !item.is_rest_day);
    if (planExercises.length === 0) {
      return res.json({
        exercises: [],
        workoutSessionId: null,
        weeklyPlanId: plan.id,
        source: 'rest_day'
      });
    }

    const [profileRes, lifestyleRes, healthRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
    ]);
    const eligibilityDataError = [profileRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
    if (eligibilityDataError) throw eligibilityDataError;
    const eligibilityContext = buildExerciseEligibilityContext({
      profile: profileRes.data || null,
      lifestyle: lifestyleRes.data || null,
      health: healthRes.data || null,
    });
    const ineligiblePlanExercises = planExercises
      .map((item: any) => ({
        exerciseId: String(item.exercise_id || ''),
        decision: getExerciseEligibilityDecision(item.exercises || { id: item.exercise_id }, eligibilityContext),
      }))
      .filter(({ decision }) => !decision.eligible);
    if (ineligiblePlanExercises.length > 0) {
      return res.status(422).json({
        error: 'Weekly plan includes an exercise that is no longer eligible for the current profile.',
        details: ineligiblePlanExercises.map(({ exerciseId, decision }) => ({
          exerciseId,
          reasons: decision.reasons,
        })),
      });
    }

    const bodyWeightKg = await getLatestBodyWeightKg(authUserId);
    const rows = planExercises.map((item: any, index: number) => {
      const plannedSets = Math.max(1, Math.min(8, Number(item.planned_sets ?? item.sets) || 3));
      const plannedReps = truncateText(item.planned_reps ?? item.reps ?? '10-12', 20) || '10-12';
      const rawWeightKg = item.planned_weight_kg ?? item.weight_kg;
      const plannedWeightKg =
        rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === ''
          ? null
          : Math.max(0, Number(rawWeightKg) || 0);
      const plannedRestSeconds = Math.max(30, Math.min(300, Number(item.planned_rest_seconds ?? item.rest_seconds) || 60));
      const plannedKcal = Math.max(0, Number(item.estimated_kcal) || 0);
      const estimatedKcal = plannedKcal > 0
        ? plannedKcal
        : estimateWorkoutKcal({
            exercise: item.exercises,
            bodyWeightKg,
            sets: plannedSets,
            repsText: plannedReps,
            weightKg: plannedWeightKg ?? 0,
            restSeconds: plannedRestSeconds
          });

      return buildDailyExerciseSessionRow({
        userId: authUserId,
        logDate,
        exerciseId: String(item.exercise_id),
        orderIndex: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        weeklyPlanExerciseId: item.id || null,
        plannedSets,
        plannedReps,
        plannedWeightKg,
        plannedRestSeconds,
        targetRpe: item.target_rpe ?? 7,
        estimatedKcal,
        loadAdjustmentNote: String(item.load_instruction || item.ai_note || '').slice(0, 160) || null
      });
    });

    const materializeRes = await supabase.rpc('materialize_daily_workout_from_plan_atomically', {
      p_user_id: authUserId,
      p_weekly_plan_id: plan.id,
      p_log_date: logDate,
      p_rows: rows,
    });
    if (materializeRes.error) {
      const message = materializeRes.error.message || 'Failed to materialize daily workout';
      if (/already started|already completed|active workout plan not found|invalid plan exercise|plan exercise no longer exists/i.test(message)) {
        return res.status(409).json({ error: message });
      }
      throw materializeRes.error;
    }

    const materializeResult = materializeRes.data as {
      already_materialized?: boolean;
      daily_workout_session_id?: string | null;
    } | null;
    const dailyRowsRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (dailyRowsRes.error) throw dailyRowsRes.error;
    const dailyRows = dailyRowsRes.data || [];
    const workoutSessionId = String(materializeResult?.daily_workout_session_id || '').trim() || null;

    return res.json({
      exercises: dailyRows,
      workoutSessionId,
      weeklyPlanId: plan.id,
      source: materializeResult?.already_materialized ? 'existing' : 'weekly_plan'
    });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/create-daily-exercises-from-plan] failed:', error?.message || error);
    if (isDatabaseMigrationRequiredError(error)) {
      return res.status(503).json(databaseMigrationRequiredResponse);
    }
    return res.status(500).json({ error: error?.message || 'Failed to create daily exercises from plan' });
  }
});

app.post('/api/workout/daily-exercises/:exerciseSessionId/replace', aiLimiter, async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized' });

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) return res.status(400).json({ error: 'exercise session id is required' });

    const currentSessionRes = await supabase
      .from('daily_exercise_sessions')
      .select('id, user_id, log_date, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe, is_completed, completed_sets')
      .eq('id', exerciseSessionId)
      .eq('user_id', authUserId)
      .maybeSingle();
    if (currentSessionRes.error) throw currentSessionRes.error;
    const currentSession = currentSessionRes.data;
    if (!currentSession) return res.status(404).json({ error: 'Exercise session not found' });
    if (currentSession.is_completed || Number(currentSession.completed_sets || 0) > 0) {
      return res.status(409).json({ error: 'Không thể đổi bài đã bắt đầu hoặc hoàn thành.' });
    }

    const [profileRes, lifestyleRes, healthRes, sameDayRes, catalogRes] = await Promise.all([
      supabase.from('profiles').select('id, gender, birthday, membership_tier').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('daily_exercise_sessions').select('exercise_id').eq('user_id', authUserId).eq('log_date', currentSession.log_date),
      supabase.from('exercises').select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern').limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
    ]);
    const dataError = [profileRes.error, lifestyleRes.error, healthRes.error, sameDayRes.error, catalogRes.error].find(Boolean);
    if (dataError) throw dataError;

    const accessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    if (!accessState.canUseWorkoutAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'workoutAdjustments'));
    }

    const sourceExercise = (catalogRes.data || []).find((exercise: any) => String(exercise.id) === String(currentSession.exercise_id));
    if (!sourceExercise) return res.status(404).json({ error: 'Original exercise is no longer in the catalog.' });

    const eligibilityContext = buildExerciseEligibilityContext({
      profile: profileRes.data || null,
      lifestyle: lifestyleRes.data || null,
      health: healthRes.data || null,
    });
    const occupiedExerciseIds = new Set((sameDayRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean));
    const sourceTarget = normalizeKeywordText(sourceExercise.target_muscle);
    const sourceBodyPart = normalizeKeywordText(sourceExercise.body_part);
    const sourceMovement = normalizeKeywordText(sourceExercise.movement_pattern);
    const candidate = getEligibleExercises(catalogRes.data as unknown[], eligibilityContext)
      .filter((exercise: any) => !occupiedExerciseIds.has(String(exercise.id)))
      .map((exercise: any) => {
        const sameTarget = sourceTarget && normalizeKeywordText(exercise.target_muscle) === sourceTarget;
        const sameBodyPart = sourceBodyPart && normalizeKeywordText(exercise.body_part) === sourceBodyPart;
        const sameMovement = sourceMovement && normalizeKeywordText(exercise.movement_pattern) === sourceMovement;
        return { exercise, score: (sameTarget ? 100 : 0) + (sameBodyPart ? 20 : 0) + (sameMovement ? 8 : 0) };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || String(a.exercise.name || '').localeCompare(String(b.exercise.name || '')))[0]?.exercise;
    if (!candidate) {
      return res.status(422).json({ error: 'Không tìm thấy bài thay thế cùng nhóm cơ, an toàn và không trùng trong buổi này.' });
    }

    const prescription = await prescribeWorkoutExercise({
      userId: authUserId,
      exerciseId: String(candidate.id),
      exercise: candidate,
      source: 'manual_add',
      suggestedSets: currentSession.actual_sets ?? currentSession.planned_sets ?? currentSession.sets,
      suggestedReps: currentSession.actual_reps ?? currentSession.planned_reps ?? currentSession.reps,
      suggestedWeightKg: currentSession.actual_weight_kg ?? currentSession.planned_weight_kg ?? currentSession.weight_kg,
      suggestedRestSeconds: currentSession.actual_rest_seconds ?? currentSession.planned_rest_seconds ?? currentSession.rest_seconds,
      suggestedTargetRpe: currentSession.target_rpe,
    });

    const updateValues = {
      exercise_id: String(candidate.id),
      sets: prescription.sets,
      reps: prescription.reps,
      weight_kg: prescription.weightKg,
      rest_seconds: prescription.restSeconds,
      planned_sets: prescription.sets,
      planned_reps: prescription.reps,
      planned_weight_kg: prescription.weightKg,
      planned_rest_seconds: prescription.restSeconds,
      actual_sets: prescription.sets,
      actual_reps: prescription.reps,
      actual_weight_kg: prescription.weightKg,
      actual_rest_seconds: prescription.restSeconds,
      target_rpe: prescription.targetRpe,
      estimated_kcal: prescription.estimatedKcal,
      actual_kcal_estimated: 0,
      completed_sets: 0,
      is_completed: false,
      load_adjustment_note: prescription.loadInstruction,
    };
    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update(updateValues)
      .eq('id', currentSession.id)
      .eq('user_id', authUserId)
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .single();
    if (updateRes.error) throw updateRes.error;

    const snapshotRes = await supabase
      .from('daily_workout_session_exercises')
      .update({
        exercise_id: String(candidate.id),
        sets: prescription.sets,
        reps: prescription.reps,
        weight_kg: prescription.weightKg,
        rest_seconds: prescription.restSeconds,
        planned_sets: prescription.sets,
        planned_reps: prescription.reps,
        planned_weight_kg: prescription.weightKg,
        planned_rest_seconds: prescription.restSeconds,
        actual_sets: prescription.sets,
        actual_reps: prescription.reps,
        actual_weight_kg: prescription.weightKg,
        actual_rest_seconds: prescription.restSeconds,
        target_rpe: prescription.targetRpe,
        estimated_kcal: prescription.estimatedKcal,
        actual_kcal_estimated: 0,
        completed_sets: 0,
        is_completed: false,
      })
      .eq('daily_exercise_session_id', currentSession.id);
    if (snapshotRes.error) throw snapshotRes.error;

    const auditRes = await supabase.from('ai_plan_adjustments').insert({
      user_id: authUserId,
      plan_type: 'workout',
      source_type: 'chat',
      source_id: currentSession.id,
      old_data: { log_date: currentSession.log_date, exercise_id: currentSession.exercise_id },
      new_data: { log_date: currentSession.log_date, exercise_id: candidate.id },
      reason: `Quick exercise replacement: ${sourceExercise.name} -> ${candidate.name}`.slice(0, 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString(),
    });
    if (auditRes.error) throw auditRes.error;

    return res.json({
      success: true,
      exercise: updateRes.data,
      replacedExerciseName: sourceExercise.name,
      aiQuota: buildAiQuotaSnapshot(accessState, 'workoutAdjustments'),
    });
  } catch (error: any) {
    console.error('[workout/replace-daily-exercise] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Không thể đổi bài tập.' });
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

    const [exerciseMeta, profileRes, lifestyleRes, healthRes] = await Promise.all([
      getExerciseMetaForKcal(exerciseId),
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
    ]);
    const eligibilityDataError = [profileRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
    if (eligibilityDataError) throw eligibilityDataError;

    const safetyContext = {
      profile: profileRes.data || {},
      lifestyle: lifestyleRes.data || {},
      health: healthRes.data || {},
    };
    const eligibilityContext = {
      ...buildExerciseEligibilityContext(safetyContext),
      safetyContext,
    };
    const eligibility = getExerciseEligibilityDecision(exerciseMeta, eligibilityContext);
    if (!eligibility.eligible) {
      throw new ApiRequestError(422, {
        error: 'Exercise is not eligible for the current profile.',
        code: 'EXERCISE_NOT_ELIGIBLE',
        reasons: eligibility.reasons,
      });
    }

    const hasManualWeight = !(rawWeightKg === null || rawWeightKg === undefined || String(rawWeightKg).trim() === '');
    const prescription = await prescribeWorkoutExercise({
      userId: authUserId,
      exerciseId,
      exercise: exerciseMeta,
      source: 'manual_add',
      suggestedSets: defaultSets,
      suggestedReps: defaultReps,
      suggestedWeightKg: rawWeightKg,
      suggestedRestSeconds: defaultRestSeconds,
      suggestedTargetRpe: targetRpe,
      forceManualWeight: hasManualWeight
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
          plannedSets: prescription.sets,
          plannedReps: prescription.reps,
          plannedWeightKg: prescription.weightKg,
          plannedRestSeconds: prescription.restSeconds,
          targetRpe: prescription.targetRpe,
          estimatedKcal: prescription.estimatedKcal,
          loadAdjustmentNote: hasManualWeight ? null : 'Tạ khởi điểm được hệ thống đề xuất tự động. Hãy giảm nếu mất form hoặc tăng nếu còn quá nhẹ.'
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
    const estimatedKcal = estimateWorkoutKcal({
      exercise: exerciseMeta,
      bodyWeightKg,
      sets: nextSets,
      repsText: nextReps,
      weightKg: nextWeightKg ?? 0,
      restSeconds: nextRestSeconds
    });
    const nextActualKcal = nextCompletedSetCount > 0
      ? estimateWorkoutKcal({
          exercise: exerciseMeta,
          bodyWeightKg,
          sets: nextCompletedSetCount,
          repsText: nextReps,
          weightKg: nextWeightKg ?? 0,
          restSeconds: nextRestSeconds,
        })
      : 0;

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
    await syncWorkoutCaloriesBurnedForDate(authUserId, String(updatedSession.log_date || ''));

    return res.json({ exercise: updatedSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/update-daily-exercise-config] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to update exercise config' });
  }
});

app.post('/api/workout/daily-exercises/:exerciseSessionId/completion', async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const exerciseSessionId = String(req.params.exerciseSessionId || '').trim();
    if (!exerciseSessionId) {
      return res.status(400).json({ error: 'exerciseSessionId is required' });
    }

    const isCompleted = req.body?.isCompleted === true;
    const existingSession = await loadDailyExerciseSessionWithExerciseMeta(exerciseSessionId, authUserId);
    const totalSets = Math.max(1, Number(existingSession.actual_sets ?? existingSession.sets) || 1);
    const nextCompletedSets = isCompleted ? totalSets : 0;
    const nextActualKcal = isCompleted
      ? await calculateCompletedExerciseKcal({
          userId: authUserId,
          session: existingSession,
          completedSets: nextCompletedSets,
        })
      : 0;

    const updateRes = await supabase
      .from('daily_exercise_sessions')
      .update({
        is_completed: isCompleted,
        completed_sets: nextCompletedSets,
        actual_kcal_estimated: nextActualKcal
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
    await syncWorkoutCaloriesBurnedForDate(authUserId, String(updatedSession.log_date || ''));

    if (isCompleted) {
      const actualReps = parseAverageReps(String((updatedSession.actual_reps ?? updatedSession.reps) || '10'));
      const actualWeightKg =
        updatedSession.actual_weight_kg === null || updatedSession.actual_weight_kg === undefined
          ? updatedSession.weight_kg ?? null
          : Math.max(0, Number(updatedSession.actual_weight_kg) || 0);
      const plannedWeightKg =
        updatedSession.planned_weight_kg === null || updatedSession.planned_weight_kg === undefined
          ? updatedSession.weight_kg ?? null
          : Math.max(0, Number(updatedSession.planned_weight_kg) || 0);
      const setEstimatedKcal = Math.max(1, Math.round(nextActualKcal / Math.max(1, totalSets)));
      const setRows = Array.from({ length: totalSets }).map((_, index) => ({
        daily_exercise_session_id: updatedSession.id,
        workout_session_exercise_id: workoutSessionExercise?.id || null,
        set_number: index + 1,
        planned_reps: String((updatedSession.planned_reps ?? updatedSession.reps) || ''),
        target_weight_kg: plannedWeightKg,
        actual_reps: actualReps,
        actual_weight_kg: actualWeightKg,
        rest_seconds: Math.max(0, Number(updatedSession.actual_rest_seconds ?? updatedSession.rest_seconds) || 0),
        estimated_kcal: setEstimatedKcal,
        is_completed: true
      }));
      const upsertLogsRes = await supabase
        .from('daily_exercise_set_logs')
        .upsert(setRows, { onConflict: 'daily_exercise_session_id,set_number' });
      if (upsertLogsRes.error) throw upsertLogsRes.error;
    } else {
      const deleteLogsRes = await supabase
        .from('daily_exercise_set_logs')
        .delete()
        .eq('daily_exercise_session_id', updatedSession.id);
      if (deleteLogsRes.error) throw deleteLogsRes.error;
    }

    return res.json({ exercise: updatedSession });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/update-daily-exercise-completion] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to update exercise completion' });
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
    const previousActualKcal = Math.max(0, Number(existingSession.actual_kcal_estimated) || 0);
    const nextActualKcal = await calculateCompletedExerciseKcal({
      userId: authUserId,
      session: existingSession,
      completedSets: nextCompletedSets,
    });
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
    await syncWorkoutCaloriesBurnedForDate(authUserId, String(updatedSession.log_date || ''));

    const actualReps = parseAverageReps(String((updatedSession.actual_reps ?? updatedSession.reps) || '10'));
    const actualWeightKg =
      updatedSession.actual_weight_kg === null || updatedSession.actual_weight_kg === undefined
        ? updatedSession.weight_kg ?? null
        : Math.max(0, Number(updatedSession.actual_weight_kg) || 0);
    const plannedWeightKg =
      updatedSession.planned_weight_kg === null || updatedSession.planned_weight_kg === undefined
        ? updatedSession.weight_kg ?? null
        : Math.max(0, Number(updatedSession.planned_weight_kg) || 0);
    const setEstimatedKcal = Math.max(1, nextActualKcal - previousActualKcal);

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

app.get('/api/ai/quota', aiLimiter, async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const profileRes = await supabase
      .from('profiles')
      .select('id, membership_tier, created_at, ai_coach_free_used_at')
      .eq('id', authUserId)
      .maybeSingle();
    if (profileRes.error) throw profileRes.error;

    const accessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    return res.json({
      membershipTier: accessState.membershipTier,
      canChat: accessState.canChat,
      trialExpired: accessState.trialExpired,
      aiQuota: buildAiQuotaSnapshot(accessState)
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load AI quota' });
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

    const todayKey = getVietnamDateKey();
    const today = new Date(`${todayKey}T00:00:00`);
    const recentDateKeys = Array.from({ length: 7 }, (_, index) => getVietnamDateKey(addDays(today, -index)));
    const day = today.getDay();
    const todayDayIndex = day === 0 ? 6 : day - 1;
    const requestDayIndex = isValidDayIndex(Number(selectedDayIndex)) ? Number(selectedDayIndex) : null;
    const referencedDayIndex = extractDayIndexFromText(normalizedMessage);
    const dayIndex = referencedDayIndex ?? requestDayIndex ?? todayDayIndex;
    const requestedWeekStartDate = String(weekStartDate || '').trim() || null;
    let trackingActionLog = '';
    let todayStatusContext = '';
    let coachDataContext = '';

    incrementMetric('totalChatRequests');
    const weeklyPlanQuery = requestedWeekStartDate
      ? supabase
          .from('weekly_plans')
          .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, target_rpe, estimated_kcal, load_instruction, exercises:exercise_id(name, body_part, target_muscle))')
          .eq('user_id', authUserId)
          .eq('week_start_date', requestedWeekStartDate)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from('weekly_plans')
          .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, target_rpe, estimated_kcal, load_instruction, exercises:exercise_id(name, body_part, target_muscle))')
          .eq('user_id', authUserId)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    const weeklyFoodPlanQuery = requestedWeekStartDate
      ? supabase
          .from('weekly_food_plans')
          .select('id, weekly_food_items(id, day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, foods:food_id(id, name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level))')
          .eq('user_id', authUserId)
          .eq('week_start_date', requestedWeekStartDate)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from('weekly_food_plans')
          .select('id, weekly_food_items(id, day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, foods:food_id(id, name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level))')
          .eq('user_id', authUserId)
          .eq('plan_status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
    const [
      todayWorkoutRes,
      todayMealRes,
      weekPlanRes,
      feedbackRes,
      profileRes,
      bodyMetricsRes,
      healthRes,
      recentChatRes,
      dailyExerciseSessionsRes,
      recentProgressLogsRes,
      recentExerciseSessionsRes,
      recentMealLogsRes,
    ] = await Promise.all([
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
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('daily_exercise_sessions')
        .select('id, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe, estimated_kcal, actual_kcal_estimated, completed_sets, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', authUserId)
        .eq('log_date', todayKey)
        .order('order_index', { ascending: true }),
      supabase
        .from('daily_progress_logs')
        .select('log_date, water_intake_ml, calories_consumed, calories_burned, sleep_hours')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys)
        .order('log_date', { ascending: false }),
      supabase
        .from('daily_exercise_sessions')
        .select('log_date, is_completed, sets, planned_sets, completed_sets')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys),
      supabase
        .from('daily_meal_logs')
        .select('log_date, meal_type, food_id, quantity, calories, protein, carbs, fat, custom_food_name, foods:food_id(id, name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level)')
        .eq('user_id', authUserId)
        .in('log_date', recentDateKeys)
        .order('log_date', { ascending: false })
    ]);

    const firstDataError = [
      todayWorkoutRes.error,
      todayMealRes.error,
      weekPlanRes.error,
      feedbackRes.error,
      profileRes.error,
      bodyMetricsRes.error,
      healthRes.error,
      recentChatRes.error,
      dailyExerciseSessionsRes.error,
      recentProgressLogsRes.error,
      recentExerciseSessionsRes.error,
      recentMealLogsRes.error
    ].find(Boolean);
    if (firstDataError) throw firstDataError;

    const chatTrainingContext = await synchronizeTrainingProfileContext({
      userId: authUserId,
      profile: profileRes.data,
      lifestyle: weekPlanRes.data,
      health: healthRes.data,
    });
    const normalizedChatLifestyle = chatTrainingContext.lifestyle;

    const chatAccessState = await getAiCoachAccessState(profileRes.data || {}, authUserId);
    if (!chatAccessState.canChat) {
      return res.status(403).json(buildAiQuotaLimitError(chatAccessState, 'chatMessages'));
    }

    try {
      trackingActionLog = (await processNaturalTracking(authUserId, normalizedMessage)).actionLog;
    } catch (trackingError: any) {
      console.warn('[ai-chat] natural tracking skipped:', trackingError?.message || trackingError);
    }

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
    const targetWorkoutContext = targetWorkoutRows.map((row: any) => ({
      exercise_id: row.exercise_id,
      name: row.exercises?.name || null,
      sets: row.actual_sets ?? row.planned_sets ?? row.sets,
      reps: row.actual_reps ?? row.planned_reps ?? row.reps,
      rest_seconds: row.actual_rest_seconds ?? row.planned_rest_seconds ?? row.rest_seconds,
      weight_kg: row.actual_weight_kg ?? row.planned_weight_kg ?? row.weight_kg,
      planned_sets: row.planned_sets ?? row.sets,
      planned_reps: row.planned_reps ?? row.reps,
      planned_weight_kg: row.planned_weight_kg ?? row.weight_kg,
      completed_sets: row.completed_sets ?? 0,
      estimated_kcal: row.estimated_kcal ?? 0,
      actual_kcal_estimated: row.actual_kcal_estimated ?? 0,
      target_rpe: row.target_rpe ?? null,
      body_part: row.exercises?.body_part || null,
      target_muscle: row.exercises?.target_muscle || null
    }));
    const aiCoachProgressSummary = buildAiCoachProgressSummary({
      todayKey,
      recentDateKeys,
      profile: profileRes.data || null,
      bodyMetrics: bodyMetricsRes.data || null,
      lifestyle: normalizedChatLifestyle,
      health: healthRes.data || null,
      progressLogs: (recentProgressLogsRes.data || []) as any[],
      exerciseSessions: (recentExerciseSessionsRes.data || []) as any[],
    });
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
    const chatSafetyContext = {
      profile: profileRes.data || null,
      lifestyle: normalizedChatLifestyle,
      health: healthRes.data || null
    };
    if (intent === 'adjust_workout') {
      aiResponse = await workoutAdjusterService({
        dayOfWeek: dayIndex,
        todayExercises: targetWorkoutContext,
        safetyContext: chatSafetyContext
      });
    } else if (intent === 'adjust_meal') {
      const currentMeal = targetMealRows[0] || null;
      const mealType = String(currentMeal?.meal_type || 'dinner');
      const candidateFoodsRes = await supabase
        .from('foods')
        .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, dietary_tags, ingredient_metadata, animal_source, is_active, price_level, cooking_time_minutes, region, is_easy_to_prepare')
        .contains('meal_type', [mealType])
        .order('created_at', { ascending: false })
        .limit(300);
      if (candidateFoodsRes.error) throw candidateFoodsRes.error;
      const candidateFoods = buildMealPlanningCatalog(candidateFoodsRes.data as any[], {
        profile: profileRes.data || {},
        lifestyle: normalizedChatLifestyle,
        health: healthRes.data || {},
        mealsPerDay: Number(normalizedChatLifestyle.meals_per_day || 3),
        recentMealFoodIds: [
          ...((recentMealLogsRes.data || []) as any[]),
          ...mealRows,
        ]
          .map((item: any) => String(item.food_id || ''))
          .filter((foodId) => foodId && foodId !== String(currentMeal?.food_id || '')),
      }, 24);

      aiResponse = await mealAdjusterService({
        dayOfWeek: dayIndex,
        currentMeal,
        candidateFoods: candidateFoods.map((item: any) => ({
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
        weeklyWorkouts: chatTrainingContext.trainingPrescription.weeklyWorkouts,
        mealsPerDay: Number(normalizedChatLifestyle.meals_per_day || 3),
        fitnessGoal: String(normalizedChatLifestyle.fitness_goal || 'general_fitness')
      });
    } else if (intent === 'analyze_progress') {
      aiResponse = await progressAnalyzerService({
        completedWorkouts: (feedbackRes.data || []).length,
        targetWorkouts: chatTrainingContext.trainingPrescription.weeklyWorkouts,
        completedMeals: targetMealRows.length,
        targetMeals: Number(normalizedChatLifestyle.meals_per_day || 0)
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
        lifestyle: normalizedChatLifestyle,
        health: healthRes.data || null,
        todayStatus: todayStatusContext,
        actionLog: trackingActionLog,
        extraContext: coachDataContext,
        progressSummary: aiCoachProgressSummary,
        chatHistory: mergedChatHistory,
        exercises: targetWorkoutContext,
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

    // This must be independent from ai_chat_messages: users can safely clear
    // their conversation without resetting their entitlement usage.
    await recordAiQuotaUsage(authUserId, 'chatMessages');

    const payloadValidation = normalizedResponse.actionType
      ? validateActionPayload(normalizedResponse.actionType, normalizedResponse.actionPayload)
      : { valid: true };
    if (!payloadValidation.valid) {
      normalizedResponse.actionRequired = false;
      normalizedResponse.actionType = null;
      normalizedResponse.actionPayload = null;
      normalizedResponse.reply = `Mình chưa thể áp dụng thay đổi tự động: ${payloadValidation.message}.`;
    }
    if (normalizedResponse.actionType === 'replace_today_workout' && normalizedResponse.actionPayload) {
      const workoutPayload = normalizedResponse.actionPayload as { exercises?: Array<{ exercise_id?: string }> };
      const proposedIds = (workoutPayload.exercises || [])
        .map((item) => String(item.exercise_id || '').trim())
        .filter(Boolean);
      const proposedCatalogRes = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications')
        .in('id', proposedIds);
      if (proposedCatalogRes.error) throw proposedCatalogRes.error;
      const proposalEligibility = validateExerciseProposal(
        normalizedResponse.actionPayload,
        buildExerciseEligibilityContext(chatSafetyContext),
        proposedCatalogRes.data as unknown[],
      );
      if (!proposalEligibility.valid) {
        normalizedResponse.actionRequired = false;
        normalizedResponse.actionType = null;
        normalizedResponse.actionPayload = null;
        normalizedResponse.reply = 'Mình chưa tạo đề xuất vì các bài được chọn không còn phù hợp với địa điểm, dụng cụ, kinh nghiệm hoặc điều kiện an toàn hiện tại.';
      }
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
            exercises: targetWorkoutContext,
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
      adjustmentId: adjustmentId || null,
      aiQuota: buildAiQuotaSnapshot(chatAccessState, 'chatMessages')
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

app.post('/api/ai/chat/clear', aiLimiter, async (req, res) => {
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { error } = await supabase
      .from('ai_chat_messages')
      .delete()
      .eq('user_id', authUserId);

    if (error) throw error;
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[ai-chat-clear] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to clear chat history' });
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
    const applyDecision = getAdjustmentApplyDecision({
      status: adjustmentRes.data.status,
      storedIdempotencyKey: adjustmentRes.data.apply_idempotency_key,
      idempotencyKey,
    });
    if (applyDecision.kind === 'already_applied') {
      return res.json({ success: true, adjustmentId, alreadyApplied: true });
    }
    if (applyDecision.kind === 'conflict') {
      return res.status(409).json({ error: applyDecision.message });
    }

    const newData = adjustmentRes.data.new_data || {};
    const oldData = adjustmentRes.data.old_data || {};
    const actionType = adjustmentRes.data.plan_type === 'meal' ? 'replace_today_meal' : 'replace_today_workout';
    const payloadValidation = validateActionPayload(actionType, newData);
    if (!payloadValidation.valid) {
      return res.status(400).json({ error: payloadValidation.message || 'Invalid action payload' });
    }
    const dayOfWeek = Number(newData.day_of_week);
    const [applyProfileRes, applyLifestyleRes, applyHealthRes] = await Promise.all([
      supabase.from('profiles').select('id, gender, birthday, membership_tier').eq('id', authUserId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle()
    ]);
    const applyFirstError = [applyProfileRes.error, applyLifestyleRes.error, applyHealthRes.error].find(Boolean);
    if (applyFirstError) throw applyFirstError;
    const applySafetyContext = {
      profile: applyProfileRes.data || null,
      lifestyle: applyLifestyleRes.data || null,
      health: applyHealthRes.data || null
    };
    const applyEligibilityContext = buildExerciseEligibilityContext(applySafetyContext);
    const applyAccessState = await getAiCoachAccessState(applyProfileRes.data || {}, authUserId);
    const adjustmentQuotaKey: AiQuotaKey = adjustmentRes.data.plan_type === 'meal'
      ? 'mealAdjustments'
      : 'workoutAdjustments';
    const canUseAdjustment = adjustmentQuotaKey === 'mealAdjustments'
      ? applyAccessState.canUseMealAdjustment
      : applyAccessState.canUseWorkoutAdjustment;
    if (!canUseAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(applyAccessState, adjustmentQuotaKey));
    }

    if (adjustmentRes.data.plan_type === 'workout') {
      const requestedWorkoutPlanId = String((oldData as any).weekly_plan_id || '').trim();
      const planQuery = requestedWorkoutPlanId
        ? supabase
            .from('weekly_plans')
            .select('id, week_start_date')
            .eq('id', requestedWorkoutPlanId)
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
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
      const validExercisesRes = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, movement_pattern, goal_type, contraindications, calories_per_minute')
        .in('id', exerciseIds);
      if (validExercisesRes.error) throw validExercisesRes.error;
      const exerciseMetaById = new Map<string, any>((validExercisesRes.data || []).map((item: any) => [String(item.id), item]));
      const existingExerciseIds = new Set<string>((validExercisesRes.data || []).map((item: any) => String(item.id)));
      const missingExerciseIds = exerciseIds.filter((id) => !existingExerciseIds.has(id));
      if (missingExerciseIds.length > 0) {
        return res.status(400).json({ error: `Invalid exercise_id: ${missingExerciseIds.join(', ')}` });
      }
      const proposalValidation = validateExerciseProposal(
        newData,
        applyEligibilityContext,
        validExercisesRes.data as unknown[],
      );
      if (!proposalValidation.valid) {
        return res.status(422).json({
          error: 'Adjustment failed current exercise eligibility validation.',
          details: proposalValidation.errors,
        });
      }

      const rows = (await Promise.all(
        exercises.map(async (item: any, index: number) => {
          const exerciseId = String(item.exercise_id || '').trim();
          if (!exerciseId) return null;
          const exerciseMeta = exerciseMetaById.get(exerciseId);
          const prescription = await prescribeWorkoutExercise({
            userId: String(authUserId),
            exerciseId,
            exercise: exerciseMeta,
            source: 'ai_adjustment',
            suggestedSets: item.sets,
            suggestedReps: item.reps,
            suggestedWeightKg: item.weight_kg,
            suggestedRestSeconds: item.rest_seconds,
            suggestedTargetRpe: item.target_rpe
          });
          return buildDailyExerciseSessionRow({
            userId: String(authUserId),
            logDate: targetLogDate,
            exerciseId,
            orderIndex: index,
            plannedSets: prescription.sets,
            plannedReps: prescription.reps,
            plannedWeightKg: prescription.weightKg,
            plannedRestSeconds: prescription.restSeconds,
            targetRpe: prescription.targetRpe,
            estimatedKcal: prescription.estimatedKcal,
            loadAdjustmentNote: String(item.load_instruction || item.note || prescription.loadInstruction || '').slice(0, 160) || null
          });
        })
      )).filter(Boolean) as any[];

      const atomicApplyRes = await supabase.rpc('apply_workout_adjustment_atomically', {
        p_adjustment_id: adjustmentId,
        p_user_id: authUserId,
        p_idempotency_key: idempotencyKey,
        p_weekly_plan_id: workoutPlanId,
        p_day_of_week: dayOfWeek,
        p_log_date: targetLogDate,
        p_rows: rows,
      });
      if (atomicApplyRes.error) {
        const message = atomicApplyRes.error.message || 'Failed to apply workout adjustment';
        if (/already started|already completed|not proposed|another idempotency/i.test(message)) {
          return res.status(409).json({ error: message });
        }
        throw atomicApplyRes.error;
      }

      const atomicResult = atomicApplyRes.data as { already_applied?: boolean } | null;
      success = true;
      return res.json({
        success: true,
        adjustmentId,
        alreadyApplied: Boolean(atomicResult?.already_applied),
        aiQuota: buildAiQuotaSnapshot(applyAccessState, adjustmentQuotaKey)
      });
    } else if (adjustmentRes.data.plan_type === 'meal') {
      const requestedFoodPlanId = String((oldData as any).weekly_food_plan_id || '').trim();
      const planQuery = requestedFoodPlanId
        ? supabase
            .from('weekly_food_plans')
            .select('id')
            .eq('id', requestedFoodPlanId)
            .eq('user_id', authUserId)
            .eq('plan_status', 'active')
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
        .select('id, name, category, calories, protein, carbs, fat, allergens, dietary_tags, ingredient_metadata, animal_source, is_active, price_level, goal_type')
        .eq('id', newFoodId)
        .maybeSingle();
      if (foodRes.error) throw foodRes.error;
      if (!foodRes.data?.id) {
        return res.status(400).json({ error: 'new_food_id does not exist' });
      }
      const foodSafety = getFoodSafetyDecision(foodRes.data as any, applySafetyContext);
      if (!foodSafety.allowed) {
        return res.status(400).json({
          error: `Adjustment blocked by food safety guard: ${foodSafety.reasons.join(', ')}`
        });
      }
      if (!isMealFoodEligible(foodRes.data as any, mealType, applySafetyContext)) {
        return res.status(400).json({
          error: 'Adjustment food is not eligible for this meal slot or profile.'
        });
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
    return res.json({
      success: true,
      adjustmentId,
      aiQuota: buildAiQuotaSnapshot(applyAccessState, adjustmentQuotaKey)
    });
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

app.post('/api/ai-coach/generate-daily-workout', aiLimiter, async (req, res) => {
  let createdWorkoutSessionId: string | null = null;
  let createdDailyExerciseIds: string[] = [];
  try {
    const authUserId = await getAuthUserId(req);
    if (!authUserId) return res.status(401).json({ error: 'Unauthorized' });

    const logDate = String(req.body?.logDate || getVietnamDateKey()).trim();
    if (!DATE_KEY_REGEX.test(logDate)) {
      return res.status(400).json({ error: 'logDate must be YYYY-MM-DD' });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'Missing GROQ_API_KEY in server config' });
    }

    const existingRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (existingRes.error) throw existingRes.error;
    if ((existingRes.data || []).length > 0) {
      return res.json({ success: true, data: { exercises: existingRes.data, logDate, source: 'existing' } });
    }

    const [profileRes, bodyMetricsRes, lifestyleRes, healthRes, catalogRes, recentRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle(),
      supabase.from('body_metrics').select('*').eq('user_id', authUserId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', authUserId).maybeSingle(),
      supabase.from('exercises').select('id, name, body_part, target_muscle, secondary_muscles, equipment, training_locations, difficulty, min_experience_months, progression_level, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern').limit(AI_EXERCISE_CATALOG_FETCH_LIMIT),
      supabase.from('daily_exercise_sessions').select('exercise_id').eq('user_id', authUserId).order('log_date', { ascending: false }).limit(20),
    ]);
    const firstError = [profileRes.error, bodyMetricsRes.error, lifestyleRes.error, healthRes.error, catalogRes.error, recentRes.error].find(Boolean);
    if (firstError) throw firstError;
    if (!profileRes.data?.id) {
      return res.status(403).json({ code: 'PROFILE_REQUIRED', error: 'Vui long hoan thanh ho so truoc khi tao lich tap.' });
    }

    let profile = profileRes.data || {};
    let lifestyle = lifestyleRes.data || {};
    let health = healthRes.data || {};
    const trainingContext = await synchronizeTrainingProfileContext({ userId: authUserId, profile, lifestyle, health });
    profile = trainingContext.profile;
    lifestyle = trainingContext.lifestyle;
    health = trainingContext.health;
    const accessState = await getAiCoachAccessState(profile, authUserId);
    if (!accessState.canGenerate) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'planGenerations'));
    }

    const eligibilityContext = buildExerciseEligibilityContext(trainingContext.safetyContext);
    const recentExerciseIds = new Set((recentRes.data || []).map((item: any) => String(item.exercise_id || '')).filter(Boolean));
    const exercises = rankExercises(
      getEligibleExercises(catalogRes.data as unknown[], eligibilityContext),
      eligibilityContext,
      { recentExerciseIds },
    ).slice(0, AI_EXERCISE_CATALOG_LIMIT).map(({ exercise }) => exercise);
    if (exercises.length === 0) {
      return res.status(422).json({ error: 'Khong co bai tap nao phu hop voi ho so va dieu kien an toan hien tai.' });
    }

    const { text: exerciseCatalog, referenceIds: exerciseReferenceIds } = buildAiExerciseCatalog(exercises);
    const durationMinutes = trainingContext.trainingPrescription.durationMinutes;
    const prompt = `
Generate exactly one personalized workout session for ${logDate}. Return valid JSON only.

USER_PROFILE:
gender=${truncateText(profile.gender, 12)}
fitness_goal=${truncateText(lifestyle.fitness_goal, 40)}
experience_level=${truncateText(lifestyle.experience_level, 20)}
workout_location=${truncateText(lifestyle.workout_location, 24)}
equipment_available=${truncateText(lifestyle.equipment_available, 60)}
injuries=${truncateText(health.injuries, 80)}
health_condition=${truncateText(health.health_condition, 80)}
target_duration_minutes=${durationMinutes}

${buildSafetyPromptAddendum(trainingContext.safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog}

Rules:
- Return exactly one entry in workout_plan.days; do not create a weekly plan.
- Use only EX## references from EXERCISE_CATALOG. Never invent exercises.
- Select 4 to 6 eligible exercises, suitable for the goal, equipment and safety constraints.
- duration_minutes must be exactly ${durationMinutes}.
- Every exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction and order_index.
- Use 3 or 4 sets and exactly "12-13" reps for every exercise. Distribute the exercises, rest and transitions so the complete session fits the target duration.
- Use conservative weight_kg; use 0 for bodyweight exercises.

JSON schema:
{
  "workout_plan": {
    "plan_name": "Lich tap hom nay",
    "explanation": "short Vietnamese explanation",
    "days": [{
      "day_of_week": 0,
      "type": "workout",
      "duration_minutes": ${durationMinutes},
      "exercises": [{
        "exercise_id": "EX01", "sets": 4, "reps": "12-13", "weight_kg": 0,
        "rest_seconds": 90, "target_rpe": 7, "load_instruction": "short cue", "order_index": 0
      }]
    }]
  }
}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.35,
        max_tokens: 1400,
        response_format: { type: 'json_object' },
      }),
    });
    const groqResult: any = await groqResponse.json();
    if (!groqResponse.ok || groqResult.error) {
      throw toAiProviderRequestError(groqResult?.error?.message || 'Groq AI request failed');
    }

    const parsed = resolveAiExerciseReferences(
      parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || ''),
      exerciseReferenceIds,
    );
    const proposalValidation = validateExerciseProposal(parsed, eligibilityContext, exercises);
    if (!proposalValidation.valid) {
      return res.status(422).json({ error: 'AI workout proposal contains an ineligible or invalid exercise.', details: proposalValidation.errors });
    }
    const normalizedPlan = normalizeAiPlanPayload(parsed, { requireMealPlan: false });
    if (normalizedPlan.workoutPlan.days.length !== 1) {
      return res.status(422).json({ error: 'AI must return exactly one workout day.' });
    }
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const guardedWorkout = sanitizeWorkoutPlanForUser(normalizedPlan.workoutPlan, trainingContext.safetyContext, exerciseById);
    if (guardedWorkout.removedCount > 0) {
      return res.status(422).json({ error: 'AI workout proposal failed safety revalidation.', details: guardedWorkout.warnings });
    }
    const workoutDay = guardedWorkout.workoutPlan.days[0];
    if (workoutDay.is_rest_day || workoutDay.exercises.length === 0) {
      return res.status(422).json({ error: 'AI must create at least one exercise for this daily workout.' });
    }

    const dailyWorkoutRes = await supabase
      .from('daily_workout_sessions')
      .insert({
        user_id: authUserId,
        weekly_plan_id: null,
        log_date: logDate,
        title: truncateText(guardedWorkout.workoutPlan.plan_name || 'AI Daily Workout', 120),
        duration_minutes: durationMinutes,
        calories_burned: 0,
        status: 'planned',
      })
      .select('id')
      .single();
    if (dailyWorkoutRes.error) throw dailyWorkoutRes.error;
    createdWorkoutSessionId = String(dailyWorkoutRes.data.id);

    const bodyWeightKg = Number(bodyMetricsRes.data?.weight || 70);
    const dailyRows = await Promise.all(workoutDay.exercises.map(async (item: any, index: number) => {
      const exerciseId = String(item.exercise_id || '');
      const exercise = exerciseById.get(exerciseId);
      if (!exercise) throw new ApiRequestError(422, { error: `AI selected an invalid exercise id: ${exerciseId}` });
      const prescription = await prescribeWorkoutExercise({
        userId: authUserId,
        exerciseId,
        exercise,
        source: 'ai_plan',
        suggestedSets: item.sets,
        suggestedReps: item.reps,
        suggestedWeightKg: item.weight_kg,
        suggestedRestSeconds: item.rest_seconds,
        suggestedTargetRpe: item.target_rpe,
      });
      return buildDailyExerciseSessionRow({
        userId: authUserId,
        logDate,
        exerciseId,
        orderIndex: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
        plannedSets: prescription.sets,
        plannedReps: prescription.reps,
        plannedWeightKg: prescription.weightKg,
        plannedRestSeconds: prescription.restSeconds,
        targetRpe: prescription.targetRpe,
        estimatedKcal: prescription.estimatedKcal || estimateWorkoutKcal({ exercise, bodyWeightKg, sets: prescription.sets, repsText: prescription.reps, weightKg: prescription.weightKg || 0, restSeconds: prescription.restSeconds }),
        loadAdjustmentNote: prescription.loadInstruction || String(item.load_instruction || item.note || '').slice(0, 160) || null,
      });
    }));
    const insertedDailyRes = await supabase.from('daily_exercise_sessions').insert(dailyRows).select('*');
    if (insertedDailyRes.error) throw insertedDailyRes.error;
    createdDailyExerciseIds = (insertedDailyRes.data || []).map((item: any) => String(item.id));

    const snapshotRes = await supabase.from('daily_workout_session_exercises').insert(
      (insertedDailyRes.data || []).map((dailyExerciseSession: any) => buildWorkoutSessionExerciseRow({
        sessionId: createdWorkoutSessionId!,
        dailyExerciseSession,
      })),
    );
    if (snapshotRes.error) throw snapshotRes.error;

    const quotaRes = await supabase.from('ai_plan_adjustments').insert({
      user_id: authUserId,
      plan_type: 'workout',
      source_type: 'ai_coach_generate',
      source_id: createdWorkoutSessionId,
      old_data: { log_date: logDate },
      new_data: { log_date: logDate, daily_workout_session_id: createdWorkoutSessionId },
      reason: truncateText(guardedWorkout.workoutPlan.explanation || 'AI created a daily workout.', 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString(),
    });
    if (quotaRes.error) throw quotaRes.error;

    const dailyRowsRes = await supabase
      .from('daily_exercise_sessions')
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT)
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('order_index', { ascending: true });
    if (dailyRowsRes.error) throw dailyRowsRes.error;
    const nextAccessState = await getAiCoachAccessState(profile, authUserId);
    return res.json({
      success: true,
      data: {
        exercises: dailyRowsRes.data || [],
        workoutSessionId: createdWorkoutSessionId,
        logDate,
        source: 'ai_daily_workout',
        aiQuota: buildAiQuotaSnapshot(nextAccessState, 'planGenerations'),
      },
    });
  } catch (error: any) {
    if (createdWorkoutSessionId) {
      await supabase.from('daily_workout_session_exercises').delete().eq('session_id', createdWorkoutSessionId);
    }
    if (createdDailyExerciseIds.length > 0) {
      await supabase.from('daily_exercise_sessions').delete().in('id', createdDailyExerciseIds);
    }
    if (createdWorkoutSessionId) {
      await supabase.from('daily_workout_sessions').delete().eq('id', createdWorkoutSessionId);
    }
    console.error('[ai-coach-generate-daily-workout] failed:', error?.message || 'unknown_error');
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    if (isDatabaseMigrationRequiredError(error)) return res.status(503).json(databaseMigrationRequiredResponse);
    return res.status(500).json({ code: 'AI_GENERATION_FAILED', error: 'Khong the tao lich tap hom nay. Vui long thu lai sau.' });
  }
});

const callGroqWithRetry = async (payload: {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}) => {
  const primaryModel = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const candidateModels = [
    primaryModel,
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
    'llama3-70b-8192',
    'llama-3.3-70b-versatile',
  ];
  const models = Array.from(new Set(candidateModels));

  let lastErrorMsg = 'Groq AI request failed';
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: payload.messages,
          temperature: payload.temperature ?? 0.35,
          max_tokens: payload.max_tokens ?? 1000,
          response_format: { type: 'json_object' },
        }),
      });

      const result: any = await response.json();
      if (response.ok && !result?.error) {
        return result;
      }
      lastErrorMsg = result?.error?.message || `Groq model ${model} failed with HTTP ${response.status}`;
      console.warn(`[GroqAPI] Attempt ${attempt + 1} (${model}) failed:`, lastErrorMsg);
    } catch (err: any) {
      lastErrorMsg = err?.message || `Groq model ${model} encountered network error`;
      console.warn(`[GroqAPI] Attempt ${attempt + 1} (${model}) network error:`, lastErrorMsg);
    }
    if (attempt < models.length - 1) {
      const isRateLimit = lastErrorMsg.toLowerCase().includes('rate limit');
      const waitMs = isRateLimit ? 1800 : 400;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw toAiProviderRequestError(lastErrorMsg);
};

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

    const weekStartKey = weekStartDate || getVietnamDateKey();

    const [
      profileRes,
      bodyMetricsRes,
      lifestyleRes,
      healthRes,
      exerciseCatalogRes,
      recentSessionsRes,
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
        .from('daily_exercise_sessions')
        .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .limit(20),
    ]);

    const firstError = [
      profileRes.error,
      bodyMetricsRes.error,
      lifestyleRes.error,
      healthRes.error,
      exerciseCatalogRes.error,
      recentSessionsRes.error,
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

    const weeklyWorkoutDays = trainingPrescription.weeklyWorkouts;
    const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const accessState = await getAiCoachAccessState(profile, userId);

    if (!profileRes.data?.id) {
      return res.status(403).json({
        code: 'PROFILE_REQUIRED',
        error: 'Vui long hoan thanh ho so de AI Coach co the tao lo trinh cho ban.'
      });
    }

    if (!accessState.canGenerate) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'planGenerations'));
    }

    const { text: exerciseCatalog, referenceIds: exerciseReferenceIds } = buildAiExerciseCatalog(exercises);

    const recentTraining = clampList(recentSessionsRes.data as any[], 6)
      .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
      .join('\n') || 'No recent training history.';

    const promptHeader = 'Generate one personalized 7-day workout plan only.\nUse only EX## references from EXERCISE_CATALOG. Return valid JSON only.';
    const rulesPrompt = `
Rules:
- Respect SAFETY_CONSTRAINTS above. They override weekly_workouts and all other goals.
- Exactly 7 days, day_of_week 0..6 where 0 is the plan start date.
- Never create new exercises. Use the EX## reference code from EXERCISE_CATALOG for every exercise_id.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Create exactly ${weeklyWorkoutDays} training days. All other days must be rest days with is_rest_day=true and no exercises.
- Every day must include an exercises array. For every rest day, return "exercises": [].
- Every training day must have duration_minutes exactly ${trainingPrescription.durationMinutes}; rest days must have duration_minutes=0.
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, target_rpe, load_instruction, order_index.
- weight_kg should be conservative. Use 0 for bodyweight.
- Do not include meal_plan. The app handles meals in a dedicated step.
`;
    const jsonSchemaPrompt = `
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
  }
}
`;

    const prompt = `
${promptHeader}

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
health_condition=${truncateText(health.health_condition, 80)}
injuries=${truncateText(health.injuries, 80)}
medications=${truncateText(health.medications, 60)}
sleep_hours=${health.sleep_hours || ''}
sleep_quality=${truncateText(health.sleep_quality, 20)}
stress_level=${truncateText(health.stress_level, 20)}

RECENT_TRAINING:
${recentTraining}

${buildSafetyPromptAddendum(safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog || 'No safe exercise ids available after hard safety filtering. Use rest/recovery days only.'}

${rulesPrompt}
${jsonSchemaPrompt}
`;

    const groqResult = await callGroqWithRetry({
      messages: [
        {
          role: 'system',
          content: 'You are Fitly AI Coach. Return valid JSON only, with no markdown or commentary.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.35,
      max_tokens: 1800,
    });

    const parsed = resolveAiExerciseReferences(
      parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || ''),
      exerciseReferenceIds,
    );
    const proposalValidation = validateExerciseProposal(parsed, eligibilityContext, exercises, {
      allowEmpty: true,
      requireSevenDays: true,
    });
    if (!proposalValidation.valid) {
      return res.status(422).json({
        error: 'AI workout proposal contains an ineligible or invalid exercise.',
        details: proposalValidation.errors,
      });
    }
    const normalizedPlan = normalizeAiPlanPayload(parsed, { requireMealPlan: false });
    const guardedWorkout = sanitizeWorkoutPlanForUser(
      normalizedPlan.workoutPlan,
      safetyContext,
      exerciseById
    );
    if (guardedWorkout.removedCount > 0) {
      return res.status(422).json({
        error: 'AI workout proposal failed safety revalidation.',
        details: guardedWorkout.warnings,
      });
    }
    normalizedPlan.workoutPlan = enforceTrainingPrescription(guardedWorkout.workoutPlan, trainingPrescription);
    normalizedPlan.workoutPlan = startWorkoutPlanOnCreationDay(normalizedPlan.workoutPlan, weekStartKey);

    const existingWorkoutPlans = await supabase
      .from('weekly_plans')
      .select('id, created_at, updated_at')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartKey)
      .eq('plan_status', 'active')
      .limit(20);
    if (existingWorkoutPlans.error) throw existingWorkoutPlans.error;

    const previousWorkoutPlanId = pickLatestByUpdatedAt(existingWorkoutPlans.data as any[])?.id || null;
    const replacementStartedAt = new Date().toISOString();
    if (previousWorkoutPlanId) {
      const archiveWorkoutPlan = await supabase
        .from('weekly_plans')
        .update({ plan_status: 'adjusted', updated_at: replacementStartedAt })
        .eq('id', previousWorkoutPlanId)
        .eq('plan_status', 'active');
      if (archiveWorkoutPlan.error) throw archiveWorkoutPlan.error;
    }
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
          return res.status(422).json({ error: `AI selected an invalid exercise id: ${exerciseId}` });
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

    const activatedAt = new Date().toISOString();
    const activateWorkoutPlan = await supabase
      .from('weekly_plans')
      .update({ plan_status: 'active', updated_at: activatedAt })
      .eq('id', weeklyPlanId)
      .eq('plan_status', 'draft');
    if (activateWorkoutPlan.error) throw activateWorkoutPlan.error;

    if (previousWorkoutPlanId) {
      const markOldWorkoutPlan = await supabase
        .from('weekly_plans')
        .update({ plan_status: 'adjusted', updated_at: activatedAt })
        .eq('id', previousWorkoutPlanId)
        .eq('plan_status', 'active');
      if (markOldWorkoutPlan.error) throw markOldWorkoutPlan.error;
    }

    const recommendation = await supabase.from('ai_recommendations').insert({
      user_id: userId,
      plan_type: 'weekly_workout_plan',
      recommendation_content: { workout_plan: normalizedPlan.workoutPlan },
      status: 'active'
    });
    if (recommendation.error) console.warn('Failed to store ai_recommendations:', recommendation.error.message);

    const adjustment = await supabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: 'workout',
      source_type: 'ai_coach_generate',
      old_plan_id: previousWorkoutPlanId,
      new_plan_id: weeklyPlanId,
      old_data: { workout_plan_id: previousWorkoutPlanId },
      new_data: { workout_plan_id: weeklyPlanId, workout_plan_name: normalizedPlan.workoutPlan.plan_name },
      reason: truncateText(normalizedPlan.workoutPlan.explanation || 'AI regenerated workout plan.', 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString()
    });
    if (adjustment.error) console.warn('Failed to store ai_plan_adjustments:', adjustment.error.message);

    return res.json({
      success: true,
      data: {
        weeklyPlanId,
        workoutItems: workoutRows.length,
        weekStartDate: weekStartKey,
        trainingPrescription,
        membershipTier: accessState.membershipTier,
        aiQuota: buildAiQuotaSnapshot(accessState, 'planGenerations'),
        ai_json: {
          workout_plan: normalizedPlan.workoutPlan
        }
      }
    });
  } catch (error: any) {
    console.error('[ai-coach-generate] failed:', error?.message || 'unknown_error');
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    if (isDatabaseMigrationRequiredError(error)) {
      return res.status(503).json(databaseMigrationRequiredResponse);
    }
    return res.status(500).json({
      code: 'AI_GENERATION_FAILED',
      error: 'Không thể tạo lịch AI 7 ngày lúc này. Vui lòng thử lại sau.'
    });
  }
});

type AiMealGenerationScope = 'day' | 'week';

// Shared meal-generation primitive. The survey asks it for a whole week while
// the Diet page asks for just the selected day; both use the same user context,
// safety filters, food catalog, prompt rules, and result normalisation.
const generateAiMealDraft = async (params: {
  userId: string;
  weekStartKey: string;
  scope: AiMealGenerationScope;
  targetDayIndex?: number;
}) => {
  const { userId, weekStartKey, scope } = params;
  const targetDayIndex = Math.max(0, Math.min(6, Number(params.targetDayIndex) || 0));
  if (!process.env.GROQ_API_KEY) {
    throw new ApiRequestError(500, { error: 'Missing GROQ_API_KEY in server config' });
  }

  const [profileRes, bodyMetricsRes, lifestyleRes, healthRes, recipeRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('body_metrics').select('weight').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('recipes')
      .select('id, name, name_en, description, meal_type, dietary_restrictions, diet_styles, goal_type, price_level, estimated_cost_min_vnd, estimated_cost_max_vnd, calories, protein, carbs, fat, serving_size, serving_unit, cooking_time_minutes, cooking_difficulty, allergens, instructions, image_url, region, is_active, recipe_ingredients(id, recipe_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index)')
      .eq('is_active', true)
      .limit(AI_FOOD_CATALOG_FETCH_LIMIT),
  ]);
  const firstError = [profileRes.error, bodyMetricsRes.error, lifestyleRes.error, healthRes.error, recipeRes.error].find(Boolean);
  if (firstError) throw firstError;

  if (!profileRes.data?.id) {
    throw new ApiRequestError(403, { code: 'PROFILE_REQUIRED', error: 'Vui lòng hoàn thành hồ sơ trước.' });
  }

  const lifestyle = lifestyleRes.data || {};
  const health = healthRes.data || {};
  const safetyContext = { profile: profileRes.data || {}, lifestyle, health };
  const mealsPerDay = resolveMealPlanningMealsPerDay(lifestyle.meals_per_day);
  const mealSlots = getMealPlanningSlots(mealsPerDay);
  // Recipe mode is selected only when the database has an active recipe catalog.
  // Once selected, an empty hard-filtered pool is an explicit error; it must not
  // fall through to the full foods catalog and undo an allergy/restriction gate.
  const recipeRows = (recipeRes.data || []) as RecipeCandidate[];
  const recipeContext = buildRecipeEligibilityContext(safetyContext);
  const eligibleRecipes = recipeRows.length > 0 ? filterEligibleRecipes(recipeRows, recipeContext) : [];

  if (recipeRows.length > 0 && eligibleRecipes.length > 0) {
    try {
      // Shuffle eligible recipes slightly to give varied recommendations when clicking generate multiple times
      const shuffledEligibleRecipes = [...eligibleRecipes].sort(() => Math.random() - 0.5);
      const compactRecipes = buildCompactRecipeCatalog(shuffledEligibleRecipes, 20);
      const recipeById = new Map(recipeRows.map((recipe) => [String(recipe.id || ''), recipe]));
      const dayRule = scope === 'week'
        ? 'exactly 7 days indexed 0..6, each day exactly once'
        : `exactly one day with day_of_week=${targetDayIndex}`;
      const requestLabel = scope === 'week' ? 'a 7-day recipe meal plan' : `the recipe meal plan for day index ${targetDayIndex}`;
      const recipeCatalog = compactRecipes.map((recipe) => (
        `${recipe.id}|${truncateText(recipe.name, 36)}|meal=${recipe.meal_type.join(',')}|diet=${recipe.dietary_restrictions.join(',')}|style=${recipe.diet_styles.join(',')}|k=${recipe.calories}|p=${recipe.protein}|c=${recipe.carbs}|f=${recipe.fat}|price=${recipe.price_level}|time=${recipe.cooking_time_minutes}`
      )).join('\n');
      const prompt = `Generate ${requestLabel} only. Return valid JSON only.\nUSER: cooking=${lifestyle.cooking_ability || ''}; budget=${lifestyle.budget_level || ''}; goal=${lifestyle.fitness_goal || ''}; target_calories=${lifestyle.target_calories || ''}; meals_per_day=${mealsPerDay}.\n${buildSafetyPromptAddendum(safetyContext)}\nRULES: ${dayRule}; exactly ${mealsPerDay} meals/day using only ${mealSlots.join(', ')}; use only RECIPE_CATALOG recipe_id values; select varied and diverse recipes across days/meals; a recipe is already a complete dish, so never return food_ids or add carb/protein/vegetable components; do not invent IDs.\nRECIPE_CATALOG:\n${recipeCatalog}\nJSON: {"meal_plan":{"target_calories":1800,"days":[{"day_of_week":${scope === 'week' ? 0 : targetDayIndex},"meals":[{"meal_type":"breakfast","recipe_id":"exact id from catalog","servings":1,"notes":"optional"}]}]}}`;
      const result = await callGroqWithRetry({
        messages: [
          { role: 'system', content: 'You are Fitly AI Coach. Return valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.65,
        max_tokens: scope === 'week' ? 950 : 400,
      });
      const mealPlan = parseJsonFromAiText(result.choices?.[0]?.message?.content || '')?.meal_plan || {};
      const rawDays = Array.isArray(mealPlan.days) ? mealPlan.days : [];
      const expectedDays = scope === 'week' ? [0, 1, 2, 3, 4, 5, 6] : [targetDayIndex];
      const compactRecipeCandidates = compactRecipes.map((item) => recipeById.get(item.id)!).filter(Boolean);
      const targetCalories = Number(lifestyle.target_calories || mealPlan.target_calories || 1800);

      const daysByExpectedIndex = new Map<number, any>();
      rawDays.forEach((rawDay: any, idx: number) => {
        let dayIndex = toDayOfWeekIndex(rawDay?.day_of_week ?? rawDay?.day);
        if (dayIndex < 0 || dayIndex > 6) dayIndex = expectedDays[idx % expectedDays.length];
        if (!daysByExpectedIndex.has(dayIndex)) {
          daysByExpectedIndex.set(dayIndex, rawDay);
        }
      });

      const firstRawDay = rawDays[0] || { meals: [] };
      const rows: any[] = [];
      const normalizedDays: any[] = [];

      for (const expectedDayIndex of expectedDays) {
        const rawDay = daysByExpectedIndex.get(expectedDayIndex) || firstRawDay;
        const repairedMeals = sanitizeAndBalanceRecipeProposal(
          rawDay?.meals,
          compactRecipeCandidates,
          recipeContext,
          mealSlots as any,
          targetCalories,
        );

        normalizedDays.push({ day_of_week: expectedDayIndex, is_rest_day: false, meals: repairedMeals });
        repairedMeals.forEach((item, index) => {
          const recipe = recipeById.get(item.recipe_id) || compactRecipeCandidates[0];
          if (!recipe) return;
          rows.push({
            day_of_week: expectedDayIndex, meal_type: item.meal_type, recipe_id: String(recipe.id),
            name: String(recipe.name || 'Món ăn AI chọn'), image_url: String(recipe.image_url || ''), category: 'recipe',
            serving_unit: String(recipe.serving_unit || 'serving'), quantity: item.servings,
            servings: item.servings, notes: item.notes || '', calories: Number(recipe.calories || 0),
            protein: Number(recipe.protein || 0), carbs: Number(recipe.carbs || 0), fat: Number(recipe.fat || 0),
            estimated_cost_min_vnd: recipe.estimated_cost_min_vnd === null || recipe.estimated_cost_min_vnd === undefined ? null : Number(recipe.estimated_cost_min_vnd),
            recipe_ingredients: Array.isArray(recipe.recipe_ingredients)
              ? recipe.recipe_ingredients.map((ing: any) => ({
                  ingredient_name: String(ing.ingredient_name || 'Nguyên liệu'),
                  amount: ing.amount === null || ing.amount === undefined ? null : Number(ing.amount),
                  unit: ing.unit || null,
                  preparation_note: ing.preparation_note || null,
                  food: ing.foods || null,
                }))
              : [],
            order_index: index, is_rest_day: false,
          });
        });
      }
      return {
        mealPlan: { target_calories: targetCalories, explanation: '', days: normalizedDays },
        rows,
        nutritionTargets: calculateNutritionMacroTargets({ targetCalories, fitnessGoal: lifestyle.fitness_goal, dietPreference: lifestyle.diet_preference, weightKg: bodyMetricsRes.data?.weight }),
        mode: 'recipe' as const,
      };
    } catch (recipeError: any) {
      if (recipeError instanceof ApiRequestError) throw recipeError;
      throw toAiProviderRequestError(recipeError?.message || 'Groq AI request failed');
    }
  }

  throw new ApiRequestError(500, { error: 'Không tìm thấy công thức ăn uống phù hợp trong danh mục.' });
};

app.post('/api/ai-coach/generate-meal-plan', aiLimiter, async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const profileRes = await supabase.from('profiles').select('id, membership_tier').eq('id', userId).maybeSingle();
    const accessState = await getAiCoachAccessState(profileRes.data || {}, userId);
    if (!accessState.canUseMealAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'mealAdjustments'));
    }

    const scope: AiMealGenerationScope = String(req.body?.scope || '').toLowerCase() === 'week' ? 'week' : 'day';
    const weekStartKey = req.body?.weekStartDate || getVietnamDateKey();
    const targetDayIndex = Math.max(0, Math.min(6, Number(req.body?.dayIndex) || 0));
    const draft = await generateAiMealDraft({ userId, weekStartKey, scope, targetDayIndex });

    await supabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: 'meal',
      source_type: 'ai_meal_generate',
      old_plan_id: null,
      new_plan_id: null,
      old_data: {},
      new_data: { day_index: targetDayIndex, scope },
      reason: 'Tạo thực đơn AI cho ngày',
      created_by: 'user',
      status: 'applied',
      applied_at: new Date().toISOString()
    });
    void recordAiQuotaUsage(userId, 'mealAdjustments').catch(() => null);

    return res.json({
      success: true,
      data: {
        scope,
        weekStartDate: weekStartKey,
        dayIndex: scope === 'day' ? targetDayIndex : null,
        mealItems: draft.rows,
        nutritionTargets: draft.nutritionTargets,
        ai_json: { meal_plan: draft.mealPlan },
      },
    });
  } catch (error: any) {
    console.error('[ai-coach-generate-meal] failed:', error?.message || 'unknown_error');
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return res.status(500).json({ code: 'AI_MEAL_GENERATION_FAILED', error: 'Không thể tạo thực đơn AI lúc này.' });
  }
});

app.post('/api/ai-coach/record-meal-swap', async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const profileRes = await supabase.from('profiles').select('id, membership_tier').eq('id', userId).maybeSingle();
    const accessState = await getAiCoachAccessState(profileRes.data || {}, userId);
    if (!accessState.canUseMealAdjustment) {
      return res.status(403).json(buildAiQuotaLimitError(accessState, 'mealAdjustments'));
    }

    const { oldFoodName, newFoodName } = req.body || {};
    await supabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: 'meal',
      source_type: 'single_meal_swap',
      old_plan_id: null,
      new_plan_id: null,
      old_data: { old_food_name: String(oldFoodName || '') },
      new_data: { new_food_name: String(newFoodName || '') },
      reason: `Đổi món ${oldFoodName || ''} sang ${newFoodName || ''}`,
      created_by: 'user',
      status: 'applied',
      applied_at: new Date().toISOString()
    });
    void recordAiQuotaUsage(userId, 'mealAdjustments').catch(() => null);

    return res.json({ success: true });
  } catch (error: any) {
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return res.status(500).json({ error: 'Không thể ghi nhận lượt đổi món.' });
  }
});

// The onboarding flow deliberately generates meals in a second, smaller request.
// Workout generation already happened after the training survey; regenerating it
// here wastes Groq tokens and replaces a plan the user has just reviewed.
app.post('/api/ai-coach/generate-onboarding-meal-plan', aiLimiter, async (req, res) => {
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'Missing GROQ_API_KEY in server config' });

    const weekStartKey = req.body?.weekStartDate || getVietnamDateKey();
    const [workoutPlanRes, foodPlanRes] = await Promise.all([
      supabase.from('weekly_plans').select('id').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(1),
      supabase.from('weekly_food_plans').select('id').eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active').limit(1),
    ]);
    const firstError = [workoutPlanRes.error, foodPlanRes.error].find(Boolean);
    if (firstError) throw firstError;
    if (foodPlanRes.data?.[0]?.id) {
      return res.status(409).json({ error: 'Weekly meal plan already exists.' });
    }

    const draft = await generateAiMealDraft({ userId, weekStartKey, scope: 'week' });
    const generatedPlan = await supabase
      .from('weekly_food_plans')
      .insert({
        user_id: userId,
        name: 'AI Coach Meal Plan',
        week_start_date: weekStartKey,
        plan_status: 'draft',
        generated_by: 'ai',
        ai_explanation: truncateText(draft.mealPlan.explanation || '', 500),
      })
      .select('id')
      .single();
    if (generatedPlan.error) throw generatedPlan.error;
    const foodPlanId = generatedPlan.data.id;
    const insertedItems = await supabase.from('weekly_food_items').insert(
      draft.rows.map((row: any) => ({
        food_plan_id: foodPlanId,
        day_of_week: Number(row.day_of_week || 0),
        meal_type: String(row.meal_type || 'lunch'),
        recipe_id: row.recipe_id ? String(row.recipe_id) : null,
        quantity: Number(row.quantity || row.servings || 1),
        calories: Number(row.calories || 0),
        protein: Number(row.protein || 0),
        carbs: Number(row.carbs || 0),
        fat: Number(row.fat || 0),
        order_index: Number(row.order_index || 0),
        is_rest_day: Boolean(row.is_rest_day),
      }))
    );
    if (insertedItems.error) throw insertedItems.error;
    const activatedPlan = await supabase
      .from('weekly_food_plans')
      .update({ plan_status: 'active', updated_at: new Date().toISOString() })
      .eq('id', foodPlanId)
      .eq('plan_status', 'draft');
    if (activatedPlan.error) throw activatedPlan.error;
    const adjustment = await supabase.from('ai_plan_adjustments').insert({
      user_id: userId,
      plan_type: 'meal',
      source_type: 'onboarding_meal_generate',
      old_plan_id: null,
      new_plan_id: workoutPlanRes.data?.[0]?.id || null,
      old_data: {},
      new_data: {
        workout_plan_id: workoutPlanRes.data?.[0]?.id || null,
        food_plan_id: foodPlanId,
        target_calories: draft.mealPlan.target_calories,
      },
      reason: truncateText(draft.mealPlan.explanation || 'AI created onboarding meal plan.', 300),
      created_by: 'ai',
      status: 'applied',
      applied_at: new Date().toISOString(),
    });
    if (adjustment.error) console.warn('Failed to store onboarding meal adjustment:', adjustment.error.message);
    return res.json({
      success: true,
      data: {
        weeklyPlanId: workoutPlanRes.data?.[0]?.id || null,
        foodPlanId,
        mealItems: draft.rows.length,
        weekStartDate: weekStartKey,
        nutritionTargets: draft.nutritionTargets,
        ai_json: { meal_plan: draft.mealPlan },
      },
    });

  } catch (error: any) {
    console.error('[ai-coach-onboarding-meal] failed:', error?.message || 'unknown_error');
    if (error instanceof ApiRequestError) return res.status(error.status).json(error.body);
    return res.status(500).json({ code: 'AI_MEAL_GENERATION_FAILED', error: 'Không thể tạo thực đơn AI 7 ngày lúc này.' });
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

schedulePremiumMondayAutoPlanner();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (IS_PRODUCTION && !telegramBot && process.env.TELEGRAM_BOT_ENABLED !== 'false') {
    console.warn('Telegram bot chua khoi dong; vui long kiem tra TELEGRAM_BOT_TOKEN.');
  }
});
