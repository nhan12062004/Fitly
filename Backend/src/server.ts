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
import { AIChatContext, AIChatResponse, AIIntent } from './services/ai/types';
import { WorkoutPrescription, prescribeWorkoutExercise } from './services/workoutPrescriptionService';
import { incrementMetric, logAIEvent, snapshotAIMetrics } from './lib/aiObservability';
import { validateActionPayload } from './services/ai/aiValidationService';
import { createTelegramLinkToken } from './lib/telegramLinkToken';
import {
  buildSafetyPromptAddendum,
  filterSafeExercisesForUser,
  filterSafeFoodsForUser,
  getFoodSafetyDecision,
  sanitizeWorkoutActionExercises,
  sanitizeWorkoutPlanForUser,
} from './services/ai/personalizationGuardService';
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
const AI_COACH_FREE_TRIAL_DAYS = 7;
const AI_ACTION_FLOW_ENABLED = process.env.AI_ACTION_FLOW_ENABLED !== 'false';
const PREMIUM_AUTO_PLAN_ENABLED = process.env.PREMIUM_AUTO_PLAN_ENABLED !== 'false';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const AI_EXERCISE_CATALOG_LIMIT = 48;
const AI_FOOD_CATALOG_LIMIT = 72;
const AI_FOOD_CATALOG_FETCH_LIMIT = 320;

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

type MealComponentGroup = 'protein' | 'carb' | 'vegetable' | 'fruit' | 'dairy' | 'fat' | 'snack' | 'other';

const AI_FOOD_COMPONENT_QUOTAS: Array<{ group: MealComponentGroup; maxItems: number }> = [
  { group: 'protein', maxItems: 42 },
  { group: 'carb', maxItems: 32 },
  { group: 'vegetable', maxItems: 32 },
  { group: 'fruit', maxItems: 20 },
  { group: 'dairy', maxItems: 14 },
  { group: 'snack', maxItems: 20 },
  { group: 'fat', maxItems: 8 },
  { group: 'other', maxItems: 12 },
];

type FoodCatalogPreference = {
  lifestyle?: any;
  health?: any;
  mealsPerDay?: number;
  mealTypes?: string[];
  recentMeals?: any[];
  currentFoodId?: string | null;
  targetCalories?: number | null;
};

const getFoodMealTypes = (food: any): string[] => {
  const raw = food?.meal_type;
  if (Array.isArray(raw)) return raw.map((item) => String(item || '').toLowerCase()).filter(Boolean);
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const foodMatchesMealType = (food: any, mealType: string): boolean => {
  const mealTypes = getFoodMealTypes(food);
  if (mealTypes.length === 0) return true;
  return mealTypes.includes(mealType) || mealTypes.includes('all') || mealTypes.includes('any');
};

const foodMatchesAnyMealType = (food: any, mealTypes: string[]): boolean => {
  if (mealTypes.length === 0) return true;
  return mealTypes.some((mealType) => foodMatchesMealType(food, mealType));
};

const getLimitedFoodFamilyKey = (food: any): string => {
  const name = normalizeKeywordTokens(food?.name);
  return name.startsWith('banh ') ? 'banh' : '';
};

const normalizeFoodGoalText = (food: any): string =>
  (Array.isArray(food?.goal_type) ? food.goal_type : String(food?.goal_type || '').split(','))
    .map((item: unknown) => normalizeKeywordText(item))
    .join('|');

const getUserDietPreferenceKey = (lifestyle: any): 'vegetarian' | 'clean' | 'high_protein' | 'low_carb' | 'normal' => {
  const text = normalizeKeywordText(`${lifestyle?.diet_preference || ''} ${lifestyle?.current_diet || ''}`);
  if (includesAnyKeyword(text, ['an chay', 'vegetarian', 'vegan'])) return 'vegetarian';
  if (includesAnyKeyword(text, ['eat clean', 'clean'])) return 'clean';
  if (includesAnyKeyword(text, ['nhieu dam', 'high protein', 'protein'])) return 'high_protein';
  if (includesAnyKeyword(text, ['low carb', 'keto'])) return 'low_carb';
  return 'normal';
};

const getUserBudgetPreferenceKey = (lifestyle: any): 'low' | 'medium' | 'high' => {
  const text = normalizeKeywordText(lifestyle?.budget_level);
  if (includesAnyKeyword(text, ['tiet kiem', 'sinh vien', 're'])) return 'low';
  if (includesAnyKeyword(text, ['thoai mai', 'cao cap', 'du loai'])) return 'high';
  return 'medium';
};

const getFoodPriceKey = (food: any): 'low' | 'medium' | 'high' => {
  const text = normalizeKeywordText(food?.price_level);
  if (includesAnyKeyword(text, ['tiet kiem', 'sinh vien', 're'])) return 'low';
  if (includesAnyKeyword(text, ['thoai mai', 'cao cap'])) return 'high';
  return 'medium';
};

const foodMatchesDietPreference = (food: any, dietKey: ReturnType<typeof getUserDietPreferenceKey>): boolean => {
  const goals = normalizeFoodGoalText(food);
  if (dietKey === 'vegetarian') return goals.includes('an chay');
  if (dietKey === 'clean') return goals.includes('eat clean');
  if (dietKey === 'high_protein') return goals.includes('nhieu dam') || Number(food?.protein || 0) >= 18;
  if (dietKey === 'low_carb') return goals.includes('low carb') || Number(food?.carbs || 0) <= 12;
  return true;
};

const getRecentFoodContext = (recentMeals: any[] | null | undefined) => {
  const idCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const componentCounts = new Map<MealComponentGroup, number>();
  const priceCounts = new Map<ReturnType<typeof getFoodPriceKey>, number>();
  const goalCounts = new Map<string, number>();

  (recentMeals || []).forEach((item) => {
    const foodId = String(item?.food_id || '').trim();
    if (foodId) idCounts.set(foodId, (idCounts.get(foodId) || 0) + 1);

    const food = item?.foods || item?.food || item;
    const familyKey = getLimitedFoodFamilyKey(food);
    if (familyKey) familyCounts.set(familyKey, (familyCounts.get(familyKey) || 0) + 1);

    const category = normalizeKeywordText(food?.category);
    if (category) categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

    const component = classifyFoodComponent({
      ...food,
      calories: food?.calories ?? item?.calories,
      protein: food?.protein ?? item?.protein,
      carbs: food?.carbs ?? item?.carbs,
      fat: food?.fat ?? item?.fat
    });
    componentCounts.set(component, (componentCounts.get(component) || 0) + 1);

    if (String(food?.price_level || '').trim()) {
      const priceKey = getFoodPriceKey(food);
      priceCounts.set(priceKey, (priceCounts.get(priceKey) || 0) + 1);
    }

    normalizeFoodGoalText(food)
      .split('|')
      .filter(Boolean)
      .forEach((goal) => goalCounts.set(goal, (goalCounts.get(goal) || 0) + 1));
  });

  return { idCounts, familyCounts, categoryCounts, componentCounts, priceCounts, goalCounts };
};

const ALLERGEN_GROUPS = [
  ['dau phong', 'lac', 'peanut'],
  ['sua', 'milk', 'lactose', 'dairy'],
  ['trung', 'egg'],
  ['tom', 'shrimp', 'shellfish', 'hai san', 'seafood'],
  ['ca', 'fish'],
  ['dau nanh', 'soy', 'soya'],
  ['lua mi', 'wheat', 'gluten'],
  ['me', 'sesame'],
  ['hat dieu', 'cashew'],
  ['hanh nhan', 'almond']
];

const getFoodAllergenText = (food: any): string =>
  normalizeKeywordText([
    food?.name,
    food?.category,
    Array.isArray(food?.allergens) ? food.allergens.join(' ') : food?.allergens
  ].filter(Boolean).join(' '));

const getUserAllergenGroups = (health: any): string[][] => {
  const text = normalizeKeywordText([
    health?.allergies,
    health?.medical_history,
    health?.health_condition
  ].filter(Boolean).join(' '));
  if (!text || includesAnyKeyword(text, ['khong di ung', 'khong co di ung', 'none', 'no allergy'])) return [];
  return ALLERGEN_GROUPS.filter((group) => includesAnyKeyword(text, group));
};

const foodConflictsWithUserAllergies = (food: any, preference: FoodCatalogPreference): boolean => {
  const groups = getUserAllergenGroups(preference.health);
  if (groups.length === 0) return false;
  const foodText = getFoodAllergenText(food);
  return groups.some((group) => includesAnyKeyword(foodText, group));
};

const getFoodCatalogLimit = (rows: any[], maxItems: number, preference: FoodCatalogPreference): number => {
  if (maxItems !== AI_FOOD_CATALOG_LIMIT) return Math.max(1, Math.min(maxItems, rows.length || maxItems));
  const lifestyle = preference.lifestyle || {};
  const mealsPerDay = resolveMealsPerDay(preference.mealsPerDay || lifestyle?.meals_per_day);
  const recentCount = (preference.recentMeals || []).length;
  const dietKey = getUserDietPreferenceKey(lifestyle);
  let target = mealsPerDay <= 2 ? 130 : mealsPerDay === 3 ? 160 : mealsPerDay === 4 ? 195 : 220;
  if (recentCount >= 28) target -= 30;
  else if (recentCount >= 12) target -= 15;
  else if (recentCount <= 3) target += 15;
  if (dietKey !== 'normal') target += 15;
  return Math.max(1, Math.min(maxItems, rows.length || maxItems, Math.round(target)));
};

const getMacroScoreAdjustment = (food: any, preference: FoodCatalogPreference): number => {
  const lifestyle = preference.lifestyle || {};
  const targetCalories = readPositiveNumber(preference.targetCalories, lifestyle?.target_calories);
  const goalText = normalizeKeywordText(`${lifestyle?.fitness_goal || ''} ${lifestyle?.diet_preference || ''} ${lifestyle?.current_diet || ''}`);
  const component = classifyFoodComponent(food);
  const calories = Number(food?.calories || 0);
  const protein = Number(food?.protein || 0);
  const carbs = Number(food?.carbs || 0);
  const fat = Number(food?.fat || 0);
  const proteinDensity = calories > 0 ? (protein * 100) / calories : 0;
  let score = 0;

  if (includesAnyKeyword(goalText, ['giam can', 'giam mo', 'fat loss', 'weight loss'])) {
    if (component === 'vegetable' || component === 'fruit') score += 18;
    if (proteinDensity >= 8) score += 18;
    if (calories > 450) score -= 30;
    if (fat > 18) score -= 12;
  }

  if (includesAnyKeyword(goalText, ['tang co', 'muscle', 'high protein', 'nhieu dam'])) {
    if (protein >= 18) score += 26;
    else if (protein >= 10) score += 12;
    if (component === 'protein') score += 18;
  }

  if (includesAnyKeyword(goalText, ['low carb', 'keto'])) {
    if (carbs <= 12) score += 26;
    if (carbs > 35) score -= 42;
  }

  if (targetCalories > 0) {
    const mealsPerDay = resolveMealsPerDay(preference.mealsPerDay || lifestyle?.meals_per_day);
    const averageMealCalories = targetCalories / mealsPerDay;
    const idealByComponent: Record<MealComponentGroup, number> = {
      protein: Math.min(260, averageMealCalories * 0.35),
      carb: Math.min(260, averageMealCalories * 0.32),
      vegetable: Math.min(110, averageMealCalories * 0.16),
      fruit: Math.min(150, averageMealCalories * 0.18),
      dairy: Math.min(190, averageMealCalories * 0.22),
      fat: Math.min(120, averageMealCalories * 0.14),
      snack: Math.min(220, averageMealCalories * 0.25),
      other: Math.min(220, averageMealCalories * 0.25)
    };
    const ideal = Math.max(40, idealByComponent[component] || 180);
    score += Math.max(-24, 18 - Math.abs(calories - ideal) / 8);
  }

  return score;
};

const getPreparationScoreAdjustment = (food: any, preference: FoodCatalogPreference): number => {
  const lifestyle = preference.lifestyle || {};
  const ability = normalizeKeywordText(`${lifestyle?.cooking_ability || ''} ${lifestyle?.workout_time || ''}`);
  const cookMinutes = Number(food?.cooking_time_minutes || 0);
  let score = 0;
  if (food?.is_easy_to_prepare) score += 10;
  if (includesAnyKeyword(ability, ['khong biet nau', 'ban ron', 'it thoi gian', 'de', 'nhanh'])) {
    if (cookMinutes > 0 && cookMinutes <= 15) score += 20;
    else if (cookMinutes > 30) score -= 30;
  } else if (cookMinutes > 0 && cookMinutes <= 25) {
    score += 8;
  }
  return score;
};

const applyHardFoodFilters = (rows: any[], maxItems: number, preference: FoodCatalogPreference): any[] => {
  const lifestyle = preference.lifestyle || {};
  const mealTypes = preference.mealTypes?.length
    ? preference.mealTypes
    : Array.from(new Set(getMealSlotsForCount(resolveMealsPerDay(preference.mealsPerDay || lifestyle?.meals_per_day))));
  const dietKey = getUserDietPreferenceKey(lifestyle);
  const budgetKey = getUserBudgetPreferenceKey(lifestyle);
  const minViable = Math.min(Math.max(40, maxItems), Math.max(1, rows.length));

  let source = rows.filter((food) => !foodConflictsWithUserAllergies(food, preference));
  if (source.length < minViable) source = rows;

  const mealScoped = source.filter((food) => foodMatchesAnyMealType(food, mealTypes));
  if (mealScoped.length >= minViable) source = mealScoped;

  if (dietKey === 'vegetarian') {
    const dietScoped = source.filter((food) => foodMatchesDietPreference(food, dietKey));
    if (dietScoped.length >= Math.min(minViable, 30)) source = dietScoped;
  }

  if (budgetKey === 'low') {
    const budgetScoped = source.filter((food) => getFoodPriceKey(food) !== 'high');
    if (budgetScoped.length >= minViable) source = budgetScoped;
  }

  return source;
};

const getFoodPreferenceScore = (
  food: any,
  preference: FoodCatalogPreference,
  recentContext = getRecentFoodContext(preference.recentMeals)
) => {
  const lifestyle = preference.lifestyle || {};
  const dietKey = getUserDietPreferenceKey(lifestyle);
  const budgetKey = getUserBudgetPreferenceKey(lifestyle);
  const priceKey = getFoodPriceKey(food);
  const mealTypes = preference.mealTypes?.length
    ? preference.mealTypes
    : Array.from(new Set(getMealSlotsForCount(resolveMealsPerDay(preference.mealsPerDay || lifestyle?.meals_per_day))));
  const goals = normalizeFoodGoalText(food);
  const component = classifyFoodComponent(food);
  const category = normalizeKeywordText(food?.category);
  let score = 0;

  if (foodConflictsWithUserAllergies(food, preference)) score -= 10000;

  if (foodMatchesAnyMealType(food, mealTypes)) score += 70;
  else score -= 90;

  if (dietKey === 'vegetarian') {
    score += foodMatchesDietPreference(food, dietKey) ? 120 : -1000;
  } else if (dietKey !== 'normal') {
    score += foodMatchesDietPreference(food, dietKey) ? 62 : -18;
  } else if (goals.includes('binh thuong') || goals.includes('giu dang')) {
    score += 16;
  }

  if (budgetKey === priceKey) score += 46;
  else if (budgetKey === 'low') score += priceKey === 'medium' ? -22 : -85;
  else if (budgetKey === 'medium') score += priceKey === 'low' ? 10 : -18;
  else score += priceKey === 'medium' ? 18 : 8;

  const foodId = String(food?.id || '');
  if (foodId && foodId === String(preference.currentFoodId || '')) score -= 1000;

  const foodRepeatCount = foodId ? recentContext.idCounts.get(foodId) || 0 : 0;
  if (foodRepeatCount === 1) score += 14;
  else if (foodRepeatCount === 2) score -= 18;
  else if (foodRepeatCount >= 3) score -= 90;

  const familyKey = getLimitedFoodFamilyKey(food);
  const familyRepeatCount = familyKey ? recentContext.familyCounts.get(familyKey) || 0 : 0;
  if (familyRepeatCount === 1) score += 6;
  else if (familyRepeatCount === 2) score -= 10;
  else if (familyRepeatCount >= 3) score -= 36;

  if (category) score += Math.min(36, (recentContext.categoryCounts.get(category) || 0) * 8);
  score += Math.min(24, (recentContext.componentCounts.get(component) || 0) * 5);
  score += Math.min(22, (recentContext.priceCounts.get(priceKey) || 0) * 5);
  goals
    .split('|')
    .filter(Boolean)
    .forEach((goal) => {
      score += Math.min(18, (recentContext.goalCounts.get(goal) || 0) * 4);
    });

  score += getMacroScoreAdjustment(food, preference);
  score += getPreparationScoreAdjustment(food, preference);

  return score;
};

const classifyFoodComponent = (food: any): MealComponentGroup => {
  const text = normalizeKeywordText(`${food?.category || ''} ${food?.name || ''}`);
  const protein = Number(food?.protein || 0);
  const carbs = Number(food?.carbs || 0);
  const fat = Number(food?.fat || 0);
  const calories = Number(food?.calories || 0);

  if (includesAnyKeyword(text, ['rau', 'salad', 'vegetable', 'greens', 'broccoli', 'spinach', 'cai', 'dua leo', 'ca chua'])) {
    return 'vegetable';
  }
  if (includesAnyKeyword(text, ['trai cay', 'fruit', 'chuoi', 'tao', 'cam', 'dau tay', 'berries'])) {
    return 'fruit';
  }
  if (includesAnyKeyword(text, ['carb', 'com', 'gao', 'rice', 'khoai', 'bun', 'pho', 'mi', 'pasta', 'banh mi', 'yen mach', 'oat'])) {
    return 'carb';
  }
  if (includesAnyKeyword(text, ['dam', 'protein', 'thit', 'ga', 'bo', 'ca ', 'ca_', 'tom', 'trung', 'dau hu', 'tofu', 'tempeh', 'whey'])) {
    return 'protein';
  }
  if (includesAnyKeyword(text, ['sua', 'yogurt', 'dairy', 'pho mai', 'cheese'])) {
    return protein >= carbs ? 'protein' : 'dairy';
  }
  if (includesAnyKeyword(text, ['hat', 'dau olive', 'bo dau phong', 'avocado']) || fat >= 10) {
    return 'fat';
  }
  if (includesAnyKeyword(text, ['snack', 'bua phu'])) {
    return 'snack';
  }
  if (protein >= 8 && protein >= carbs * 0.55) return 'protein';
  if (carbs >= 18 && carbs >= protein) return 'carb';
  if (calories <= 90 && carbs <= 14 && protein < 6) return 'vegetable';
  return 'other';
};

const selectBalancedFoodCatalog = (
  rows: any[] | null | undefined,
  maxItems = AI_FOOD_CATALOG_LIMIT,
  preference: FoodCatalogPreference = {}
) => {
  const recentContext = getRecentFoodContext(preference.recentMeals);
  const lifestyle = preference.lifestyle || {};
  const dietKey = getUserDietPreferenceKey(lifestyle);
  const baseSource = rows || [];
  const effectiveMaxItems = getFoodCatalogLimit(baseSource, maxItems, preference);
  const hardFilteredSource = applyHardFoodFilters(baseSource, effectiveMaxItems, preference);
  const dietScoped = dietKey === 'vegetarian'
    ? hardFilteredSource.filter((food) => foodMatchesDietPreference(food, dietKey))
    : hardFilteredSource;
  const scopedSource = dietScoped.length >= Math.min(effectiveMaxItems, 40) ? dietScoped : hardFilteredSource;
  const source = [...scopedSource].sort((a, b) =>
    getFoodPreferenceScore(b, preference, recentContext) - getFoodPreferenceScore(a, preference, recentContext)
  );
  const selected: any[] = [];
  const selectedIds = new Set<string>();
  const quotaBaseTotal = AI_FOOD_COMPONENT_QUOTAS.reduce((sum, item) => sum + item.maxItems, 0);
  const quotaScale = effectiveMaxItems / Math.max(1, quotaBaseTotal);

  const addRows = (candidates: any[], maxCount: number) => {
    for (const food of candidates) {
      if (selected.length >= effectiveMaxItems || maxCount <= 0) return;
      const id = String(food?.id || '');
      if (!id || selectedIds.has(id)) continue;
      selected.push(food);
      selectedIds.add(id);
      maxCount -= 1;
    }
  };

  AI_FOOD_COMPONENT_QUOTAS.forEach(({ group, maxItems: groupMaxItems }) => {
    addRows(source.filter((food) => classifyFoodComponent(food) === group), Math.max(4, Math.round(groupMaxItems * quotaScale)));
  });

  addRows(source, effectiveMaxItems - selected.length);
  return selected.slice(0, effectiveMaxItems);
};

const getDefaultMealQuantity = (food: any, group: MealComponentGroup, mealType: string): number => {
  const unit = normalizeKeywordText(food?.serving_unit);
  const name = normalizeKeywordText(food?.name);
  const isGramUnit = unit.includes('100g') || unit.includes('100 g') || unit === 'g' || unit.includes('gram');
  if (!isGramUnit) return 1;

  if (group === 'vegetable') return 2.5; // 250g rau/cu.
  if (group === 'protein') return mealType === 'breakfast' ? 1.2 : 1.5; // 120-150g thit/ca/trung/dau.
  if (group === 'carb') {
    if (includesAnyKeyword(name, ['com', 'rice', 'bun', 'pho', 'mi', 'banh mi'])) return 1.5;
    return mealType === 'breakfast' ? 0.8 : 1.5;
  }
  if (group === 'fruit') return 1.5;
  if (group === 'fat') return 0.3;
  return 1;
};

const getRequiredMealComponents = (mealType: string): MealComponentGroup[] => {
  if (mealType === 'lunch' || mealType === 'dinner') return ['carb', 'protein', 'vegetable'];
  if (mealType === 'breakfast') return ['carb', 'protein'];
  return [];
};

const pickFoodForComponent = (
  foods: any[],
  mealType: string,
  group: MealComponentGroup,
  usedFoodIds: Set<string>,
  usedLimitedFamilyKeys: Set<string> = new Set()
) => {
  const candidates = foods.filter((food) => {
    const id = String(food?.id || '');
    if (!id || usedFoodIds.has(id)) return false;
    return classifyFoodComponent(food) === group;
  });
  const scoped = candidates.filter((food) => foodMatchesMealType(food, mealType));
  const mealPool = scoped.length ? scoped : candidates;
  const familyScoped = mealPool.filter((food) => {
    const familyKey = getLimitedFoodFamilyKey(food);
    return !familyKey || !usedLimitedFamilyKeys.has(familyKey);
  });
  const pool = familyScoped.length ? familyScoped : mealPool;
  return [...pool].sort((a, b) => {
    const aEasy = a?.is_easy_to_prepare ? -8 : 0;
    const bEasy = b?.is_easy_to_prepare ? -8 : 0;
    const aMeal = foodMatchesMealType(a, mealType) ? -12 : 0;
    const bMeal = foodMatchesMealType(b, mealType) ? -12 : 0;
    const aFamily = getLimitedFoodFamilyKey(a) ? 18 : 0;
    const bFamily = getLimitedFoodFamilyKey(b) ? 18 : 0;
    const aCalories = Math.abs(Number(a?.calories || 0) - (group === 'vegetable' ? 45 : group === 'protein' ? 160 : 180));
    const bCalories = Math.abs(Number(b?.calories || 0) - (group === 'vegetable' ? 45 : group === 'protein' ? 160 : 180));
    return aEasy + aMeal + aFamily + aCalories - (bEasy + bMeal + bFamily + bCalories);
  })[0] || null;
};

const expandAiMealItems = (meals: any[], foodById: Map<string, any>) =>
  (Array.isArray(meals) ? meals : []).flatMap((meal: any) => {
    const foodIds = Array.isArray(meal.food_ids) ? meal.food_ids : [];
    return foodIds.map((foodId: string, index: number) => {
      const safeFoodId = String(foodId || '');
      const food = foodById.get(safeFoodId);
      const mealType = String(meal.meal_type || 'lunch').toLowerCase();
      const component = classifyFoodComponent(food);
      const rawQuantity = Array.isArray(meal.quantities) ? Number(meal.quantities[index]) : Number(meal.quantity);
      return {
        meal_type: mealType,
        food_id: safeFoodId,
        quantity: Number.isFinite(rawQuantity) && rawQuantity > 0
          ? Math.max(0.25, Math.min(6, rawQuantity))
          : getDefaultMealQuantity(food, component, mealType),
        order_index: index
      };
    });
  });

const rebalanceRepeatedFoodFamilies = (
  meals: any[],
  foodById: Map<string, any>,
  foods: any[],
  usedFoodIds: Set<string>
) => {
  const usedLimitedFamilyKeys = new Set<string>();

  return meals.map((item) => {
    const foodId = String(item?.food_id || '');
    const food = foodById.get(foodId);
    const familyKey = getLimitedFoodFamilyKey(food);
    if (!familyKey) return item;
    if (!usedLimitedFamilyKeys.has(familyKey)) {
      usedLimitedFamilyKeys.add(familyKey);
      return item;
    }

    const group = classifyFoodComponent(food);
    const searchUsedFoodIds = new Set(usedFoodIds);
    searchUsedFoodIds.delete(foodId);
    const replacement = pickFoodForComponent(
      foods,
      String(item.meal_type || 'lunch'),
      group,
      searchUsedFoodIds,
      usedLimitedFamilyKeys
    );
    if (!replacement?.id) return item;

    const replacementId = String(replacement.id);
    usedFoodIds.delete(foodId);
    usedFoodIds.add(replacementId);
    const replacementFamilyKey = getLimitedFoodFamilyKey(replacement);
    if (replacementFamilyKey) usedLimitedFamilyKeys.add(replacementFamilyKey);

    return {
      ...item,
      food_id: replacementId,
      quantity: getDefaultMealQuantity(replacement, classifyFoodComponent(replacement), String(item.meal_type || 'lunch'))
    };
  });
};

const enrichMealComponents = (rawMeals: any[], mealsPerDay: number, foodById: Map<string, any>, foods: any[]) => {
  const slots = Array.from(new Set(getMealSlotsForCount(mealsPerDay)));
  let result = (Array.isArray(rawMeals) ? rawMeals : [])
    .filter((item) => foodById.has(String(item?.food_id || '')))
    .map((item) => ({
      ...item,
      meal_type: String(item.meal_type || 'lunch').toLowerCase()
    }));
  const usedFoodIds = new Set(result.map((item) => String(item.food_id || '')).filter(Boolean));
  result = rebalanceRepeatedFoodFamilies(result, foodById, foods, usedFoodIds);
  const usedLimitedFamilyKeys = new Set(
    result
      .map((item) => getLimitedFoodFamilyKey(foodById.get(String(item.food_id || ''))))
      .filter(Boolean)
  );

  const addComponent = (mealType: string, group: MealComponentGroup) => {
    const candidate = pickFoodForComponent(foods, mealType, group, usedFoodIds, usedLimitedFamilyKeys);
    if (!candidate?.id) return;
    const foodId = String(candidate.id);
    usedFoodIds.add(foodId);
    const familyKey = getLimitedFoodFamilyKey(candidate);
    if (familyKey) usedLimitedFamilyKeys.add(familyKey);
    result.push({
      meal_type: mealType,
      food_id: foodId,
      quantity: getDefaultMealQuantity(candidate, group, mealType),
      order_index: 99
    });
  };

  slots.forEach((mealType) => {
    const requirements = getRequiredMealComponents(mealType);
    const existing = () => result.filter((item) => String(item.meal_type) === mealType && foodById.has(String(item.food_id || '')));
    requirements.forEach((group) => {
      if (!existing().some((item) => classifyFoodComponent(foodById.get(String(item.food_id))) === group)) {
        addComponent(mealType, group);
      }
    });

    if (mealType === 'snack' && existing().length === 0) {
      addComponent(mealType, 'fruit');
      if (existing().length === 0) addComponent(mealType, 'protein');
    }
  });

  return result;
};

const normalizeDayMeals = (rawMeals: any[], mealsPerDay: number, foodById: Map<string, any>) => {
  const slots = getMealSlotsForCount(mealsPerDay);
  const meals = Array.isArray(rawMeals) ? rawMeals : [];
  const validMeals = meals.filter((item) => foodById.has(String(item?.food_id || '')));
  if (validMeals.length === 0) return [];

  const normalized: any[] = [];
  const slotsSeen = new Set<string>();
  slots.forEach((mealType) => {
    if (slotsSeen.has(mealType)) return;
    slotsSeen.add(mealType);
    validMeals
      .filter((item) => String(item?.meal_type || '') === mealType)
      .forEach((source) => {
        normalized.push({
          ...source,
          meal_type: mealType,
          order_index: normalized.length
        });
      });
  });

  if (normalized.length > 0) return normalized;

  return validMeals.map((source, index) => ({
    ...source,
    meal_type: slots[Math.min(index, slots.length - 1)] || 'lunch',
    order_index: index
  }));
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
          quantities: Array.isArray(item.quantities)
            ? ids.map((_: string, index: number) => Math.max(0.25, Math.min(6, Number(item.quantities[index]) || 0)))
            : [],
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
  const estimatedKcal = prescription?.estimatedKcal ?? estimatePlannedExerciseKcal({
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
    .select('id, name, body_part, target_muscle, equipment, difficulty, movement_pattern, calories_per_minute')
    .eq('id', exerciseId)
    .maybeSingle();
  if (exerciseRes.error) throw exerciseRes.error;
  if (!exerciseRes.data?.id) {
    throw new ApiRequestError(404, { error: 'Exercise not found' });
  }
  return exerciseRes.data;
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
  const isBarbellOrMachine = includesAnyKeyword(equipment, ['barbell', 'ta don lon', 'machine', 'may', 'smith']);
  const isDumbbellOrKettlebell = includesAnyKeyword(equipment, ['dumbbell', 'ta don', 'kettlebell']);
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
    recentMealsRes,
    recentMealLogsRes
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('exercises')
      .select('id, name, body_part, target_muscle, equipment, difficulty, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
      .limit(AI_EXERCISE_CATALOG_LIMIT),
    supabase
      .from('foods')
      .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare')
      .order('created_at', { ascending: false })
      .limit(AI_FOOD_CATALOG_FETCH_LIMIT),
    supabase
      .from('daily_exercise_sessions')
      .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(20),
    supabase
      .from('weekly_food_items')
      .select('day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, weekly_food_plans!inner(user_id), foods:food_id(name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level)')
      .eq('weekly_food_plans.user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('daily_meal_logs')
      .select('log_date, meal_type, food_id, quantity, calories, protein, carbs, fat, custom_food_name, foods:food_id(name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level)')
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
    foodCatalogRes.error,
    recentSessionsRes.error,
    recentMealsRes.error,
    recentMealLogsRes.error
  ].find(Boolean);
  if (firstError) throw firstError;

  const profile = profileRes.data || {};
  const bodyMetrics = bodyMetricsRes.data || {};
  const lifestyle = lifestyleRes.data || {};
  const health = healthRes.data || {};
  const safetyContext = { profile, lifestyle, health };
  const exercises = filterSafeExercisesForUser(clampList(exerciseCatalogRes.data as any[], AI_EXERCISE_CATALOG_LIMIT), safetyContext);
  const recentMealHistory = [
    ...((recentMealLogsRes.data || []) as any[]),
    ...((recentMealsRes.data || []) as any[])
  ];
  const weeklyWorkoutDays = resolveWeeklyWorkouts(lifestyle.activity_level, lifestyle.weekly_workouts);
  const mealsPerDay = resolveMealsPerDay(lifestyle.meals_per_day);
  const mealSlots = getMealSlotsForCount(mealsPerDay);
  const safeFoodSource = filterSafeFoodsForUser(foodCatalogRes.data as any[], safetyContext);
  const foods = selectBalancedFoodCatalog(safeFoodSource, AI_FOOD_CATALOG_LIMIT, {
    lifestyle,
    health,
    mealsPerDay,
    mealTypes: Array.from(new Set(mealSlots)),
    recentMeals: recentMealHistory,
    targetCalories: Number(lifestyle.target_calories || 0)
  });
  const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
  const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
  const foodById = new Map(foods.map((item: any) => [String(item.id), item]));
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
    .map((item: any) => `${item.id}|${truncateText(item.name, 34)}|body=${truncateText(item.body_part, 12)}|target=${truncateText(item.target_muscle, 16)}|eq=${truncateText(item.equipment, 14)}|level=${truncateText(item.difficulty, 10)}|pattern=${truncateText(item.movement_pattern, 12)}`)
    .join('\n');

  const foodCatalog = foods
    .map((item: any) => `${item.id}|${truncateText(item.name, 30)}|g=${classifyFoodComponent(item)}|k=${item.calories || 0}|p=${item.protein || 0}|c=${item.carbs || 0}|f=${item.fat || 0}|u=${truncateText(item.serving_unit || '100g', 10)}|meal=${truncateText((item.meal_type || []).join(','), 22)}|all=${truncateText((item.allergens || []).join(','), 24)}`)
    .join('\n');

  const recentTraining = clampList(recentSessionsRes.data as any[], 6)
    .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
    .join('\n') || 'No recent training history.';

  const recentEating = clampList(recentMealHistory, 6)
    .map((item: any) => `d=${item.day_of_week || item.log_date || ''}|${item.meal_type}|${truncateText(item.foods?.name || item.custom_food_name || item.food_id, 28)}|qty=${item.quantity}`)
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

${buildSafetyPromptAddendum(safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog || 'No safe exercise ids available after hard safety filtering. Use rest/recovery days only.'}

FOOD_CATALOG:
${foodCatalog}

Rules:
- Respect SAFETY_CONSTRAINTS above. They override weekly_workouts and all other goals.
- Exactly 7 days, day_of_week 0..6 where 0 is Monday.
- Never create new exercises or foods. Pick only exercise_id values from EXERCISE_CATALOG and food_id values from FOOD_CATALOG.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Prefer foods whose meal_type, goal_type, allergens, price_level, cooking_time_minutes and region match the user profile.
- Avoid foods whose allergens conflict with allergies_or_medical_history.
- FOOD_CATALOG is already ranked by meal slot, diet preference, budget and eating-history trends; earlier rows are better matches.
- Breakfast must use foods that support breakfast; lunch and dinner must use foods that support lunch/dinner; snack must use snack/breakfast-friendly foods.
- Use recent meal history to infer the user's preferred categories, protein/carb/vegetable balance, diet style and budget tendency.
- Repeating a liked food is allowed, but do not over-repeat the same exact food or same limited family more than 2-3 times in a week.
- Training days should match weekly_workouts. Rest days: is_rest_day=true and no exercises.
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

  const parsed = parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || '');
  const normalizedPlan = normalizeAiPlanPayload(parsed);
  const guardedWorkout = sanitizeWorkoutPlanForUser(
    normalizedPlan.workoutPlan,
    safetyContext,
    exerciseById
  );
  normalizedPlan.workoutPlan = guardedWorkout.workoutPlan;

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

    for (const [index, item] of day.exercises.entries()) {
      const exerciseId = String(item.exercise_id || '');
      if (!exerciseIds.has(exerciseId)) continue;
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

    const expandedMeals = expandAiMealItems(day.meals || [], foodById);
    const enrichedMeals = enrichMealComponents(expandedMeals, mealsPerDay, foodById, foods);
    const normalizedMeals = normalizeDayMeals(enrichedMeals, mealsPerDay, foodById);
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

// Telegram polling và reminder cron chỉ chạy trên môi trường deploy (Render).
// Backend local không khởi tạo Telegram runtime.
const telegramBot = IS_PRODUCTION ? initTelegramBot() : null;

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

const parseStringArrayInput = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
};

const parseInstructionsInput = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'object' && value !== null) return value;
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/\n+/).map((item) => item.trim()).filter(Boolean);
};

const parseOptionalNumberInput = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const createCatalogId = (name: unknown, prefix: string): string => {
  const slug = String(name || prefix)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || prefix;
  return `${slug}-${Date.now().toString(36)}`;
};

const sanitizeExercisePayload = (raw: any, isCreate: boolean) => {
  const payload: Record<string, unknown> = {};
  if (isCreate) {
    payload.id = String(raw?.id || createCatalogId(raw?.name, 'exercise')).trim();
  }

  const textFields = [
    'name',
    'body_part',
    'equipment',
    'target_muscle',
    'gif_url',
    'image_url',
    'difficulty',
    'movement_pattern'
  ];
  textFields.forEach((field) => {
    if (raw?.[field] !== undefined) payload[field] = String(raw[field] || '').trim() || null;
  });

  const instructions = parseInstructionsInput(raw?.instructions);
  if (instructions !== undefined) payload.instructions = instructions;

  const secondaryMuscles = parseStringArrayInput(raw?.secondary_muscles);
  if (secondaryMuscles !== undefined) payload.secondary_muscles = secondaryMuscles;

  const goalType = parseStringArrayInput(raw?.goal_type);
  if (goalType !== undefined) payload.goal_type = goalType;

  const contraindications = parseStringArrayInput(raw?.contraindications);
  if (contraindications !== undefined) payload.contraindications = contraindications;

  const estimatedDuration = parseOptionalNumberInput(raw?.estimated_duration_seconds);
  if (estimatedDuration !== undefined) payload.estimated_duration_seconds = estimatedDuration;

  const caloriesPerMinute = parseOptionalNumberInput(raw?.calories_per_minute);
  if (caloriesPerMinute !== undefined) payload.calories_per_minute = caloriesPerMinute;

  if (!String(payload.name || '').trim()) {
    throw new Error('Exercise name is required');
  }
  if (isCreate && !String(payload.id || '').trim()) {
    throw new Error('Exercise id is required');
  }

  return payload;
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
  if (allergens !== undefined) payload.allergens = allergens;

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
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('membership_tier', 'premium'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).not('telegram_chat_id', 'is', null),
      supabase.from('exercises').select('id', { count: 'exact', head: true }),
      supabase.from('foods').select('id', { count: 'exact', head: true }),
      supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'proposed'),
      supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'applied'),
      supabase.from('ai_plan_adjustments').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabase.from('daily_exercise_sessions').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true),
      supabase.from('daily_meal_logs').select('id', { count: 'exact', head: true }).eq('log_date', today).eq('is_completed', true)
    ]);

    const firstError = [
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
    ].find((item) => item.error)?.error;
    if (firstError) throw firstError;

    res.json({
      success: true,
      data: {
        users: usersRes.count || 0,
        premiumUsers: premiumRes.count || 0,
        newUsers7d: newUsersRes.count || 0,
        telegramLinkedUsers: telegramLinkedRes.count || 0,
        exercises: exercisesRes.count || 0,
        foods: foodsRes.count || 0,
        aiAdjustments: {
          proposed: aiProposedRes.count || 0,
          applied: aiAppliedRes.count || 0,
          rejected: aiRejectedRes.count || 0
        },
        todayCompletedWorkouts: workoutDoneRes.count || 0,
        todayCompletedMeals: mealsDoneRes.count || 0
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Internal Server Error' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const query = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
    let request = supabase
      .from('profiles')
      .select('id, full_name, email, phone, gender, birthday, job, role, membership_tier, telegram_chat_id, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (query) {
      request = request.or(`full_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`);
    }

    const { data, error } = await request;
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
    const { data, error } = await supabase.from('exercises').insert(payload).select('*').single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Failed to create exercise' });
  }
});

app.put('/api/admin/exercises/:id', async (req, res) => {
  try {
    const adminUserId = await requireAdminUserId(req, res);
    if (!adminUserId) return;

    const exerciseId = String(req.params.id || '').trim();
    const payload = sanitizeExercisePayload(req.body, false);
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
    res.status(400).json({ error: error?.message || 'Failed to update exercise' });
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

    const requestedWeekStart = String(req.body?.weekStartDate || '').trim();
    const weekStartKey = DATE_KEY_REGEX.test(requestedWeekStart)
      ? requestedWeekStart
      : getWeekStartKey(new Date(`${logDate}T00:00:00`));
    const requestedDayIndex = Number(req.body?.dayIndex);
    const dayIndex = isValidDayIndex(requestedDayIndex)
      ? requestedDayIndex
      : getDayIndexFromDateKey(logDate);

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
      .select('id, created_at, updated_at')
      .eq('user_id', authUserId)
      .eq('week_start_date', weekStartKey)
      .limit(20);
    if (planRes.error) throw planRes.error;

    const plan = pickLatestByUpdatedAt(planRes.data as any[]);
    if (!plan?.id) {
      return res.json({
        exercises: [],
        workoutSessionId: null,
        weeklyPlanId: null,
        source: 'no_plan'
      });
    }

    const planExercisesRes = await supabase
      .from('weekly_plan_exercises')
      .select(`
        *,
        exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions, calories_per_minute)
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

    const dailyWorkoutSessionRes = await supabase
      .from('daily_workout_sessions')
      .select('id, status')
      .eq('user_id', authUserId)
      .eq('log_date', logDate)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dailyWorkoutSessionRes.error) throw dailyWorkoutSessionRes.error;
    if (dailyWorkoutSessionRes.data?.status === 'completed') {
      return res.status(409).json({ error: 'Workout session for this day is already completed.' });
    }

    const bodyWeightKg = await getLatestBodyWeightKg(authUserId);
    const rows = planExercises.map((item: any, index: number) => {
      const plannedSets = Math.max(1, Math.min(6, Number(item.planned_sets ?? item.sets) || 3));
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
        : estimatePlannedExerciseKcal({
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

    const insertDailyRes = await supabase
      .from('daily_exercise_sessions')
      .insert(rows)
      .select(DAILY_EXERCISE_SESSION_WITH_EXERCISE_SELECT);
    if (insertDailyRes.error) throw insertDailyRes.error;
    const dailyRows = insertDailyRes.data || [];

    const estimatedDuration = Math.max(
      10,
      Math.round(dailyRows.reduce((sum: number, item: any) => sum + Math.max(1, Number(item.sets) || 1), 0) * 2)
    );
    let workoutSessionId = String(dailyWorkoutSessionRes.data?.id || '').trim();
    if (!workoutSessionId) {
      const createSessionRes = await supabase
        .from('daily_workout_sessions')
        .insert({
          user_id: authUserId,
          weekly_plan_id: plan.id,
          log_date: logDate,
          title: `Buoi tap ${logDate}`,
          duration_minutes: estimatedDuration,
          calories_burned: 0,
          status: 'planned'
        })
        .select('id')
        .single();
      if (createSessionRes.error) throw createSessionRes.error;
      workoutSessionId = String(createSessionRes.data.id || '');
    } else {
      const updateSessionRes = await supabase
        .from('daily_workout_sessions')
        .update({
          weekly_plan_id: plan.id,
          title: `Buoi tap ${logDate}`,
          duration_minutes: estimatedDuration,
          status: 'planned'
        })
        .eq('id', workoutSessionId);
      if (updateSessionRes.error) throw updateSessionRes.error;
    }

    if (workoutSessionId && dailyRows.length > 0) {
      const deleteSnapshotRes = await supabase
        .from('daily_workout_session_exercises')
        .delete()
        .eq('session_id', workoutSessionId);
      if (deleteSnapshotRes.error) throw deleteSnapshotRes.error;

      const snapshotRows = dailyRows.map((dailyExerciseSession: any) =>
        buildWorkoutSessionExerciseRow({
          sessionId: workoutSessionId,
          dailyExerciseSession
        })
      );
      const insertSnapshotRes = await supabase
        .from('daily_workout_session_exercises')
        .insert(snapshotRows);
      if (insertSnapshotRes.error) throw insertSnapshotRes.error;
    }

    return res.json({
      exercises: dailyRows,
      workoutSessionId,
      weeklyPlanId: plan.id,
      source: 'weekly_plan'
    });
  } catch (error: any) {
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    console.error('[workout/create-daily-exercises-from-plan] failed:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Failed to create daily exercises from plan' });
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

    const exerciseMeta = await getExerciseMetaForKcal(exerciseId);
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
    const estimatedKcal = Math.max(0, Number(existingSession.estimated_kcal) || 0);
    const nextCompletedSets = isCompleted ? totalSets : 0;
    const nextActualKcal = isCompleted ? estimatedKcal : 0;

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
      const setEstimatedKcal = Math.max(1, Math.round(estimatedKcal / Math.max(1, totalSets)));
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
          .select('id, weekly_plan_exercises(day_of_week, exercise_id, sets, reps, rest_seconds, weight_kg, planned_sets, planned_reps, planned_weight_kg, planned_rest_seconds, target_rpe, estimated_kcal, load_instruction, exercises:exercise_id(name, body_part, target_muscle))')
          .eq('user_id', authUserId)
          .eq('week_start_date', requestedWeekStartDate)
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
        .gte('created_at', chatDayBounds.startIso)
        .lt('created_at', chatDayBounds.endIso)
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
      lifestyle: weekPlanRes.data || null,
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
      lifestyle: weekPlanRes.data || null,
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
        .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare')
        .contains('meal_type', [mealType])
        .order('created_at', { ascending: false })
        .limit(300);
      if (candidateFoodsRes.error) throw candidateFoodsRes.error;
      const safeCandidateFoodSource = filterSafeFoodsForUser(candidateFoodsRes.data as any[], chatSafetyContext);
      const candidateFoods = selectBalancedFoodCatalog(safeCandidateFoodSource, 24, {
        lifestyle: weekPlanRes.data || {},
        health: healthRes.data || {},
        mealsPerDay: Number((weekPlanRes.data as any)?.meals_per_day || 3),
        mealTypes: [mealType],
        recentMeals: [
          ...((recentMealLogsRes.data || []) as any[]),
          ...mealRows
        ],
        currentFoodId: currentMeal?.food_id || null
      });

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
    const [applyProfileRes, applyLifestyleRes, applyHealthRes] = await Promise.all([
      supabase.from('profiles').select('id, gender, birthday, job').eq('id', authUserId).maybeSingle(),
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
      const validExercisesRes = await supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, equipment, difficulty, movement_pattern, contraindications, calories_per_minute')
        .in('id', exerciseIds);
      if (validExercisesRes.error) throw validExercisesRes.error;
      const exerciseMetaById = new Map<string, any>((validExercisesRes.data || []).map((item: any) => [String(item.id), item]));
      const existingExerciseIds = new Set<string>((validExercisesRes.data || []).map((item: any) => String(item.id)));
      const missingExerciseIds = exerciseIds.filter((id) => !existingExerciseIds.has(id));
      if (missingExerciseIds.length > 0) {
        return res.status(400).json({ error: `Invalid exercise_id: ${missingExerciseIds.join(', ')}` });
      }
      const guardedExercises = sanitizeWorkoutActionExercises(exercises, applySafetyContext, exerciseMetaById);
      if (guardedExercises.exercises.length === 0 && exercises.length > 0) {
        return res.status(400).json({
          error: 'Adjustment blocked by safety guard: selected exercises conflict with current health or injury profile.'
        });
      }

      const rows = (await Promise.all(
        guardedExercises.exercises.map(async (item: any, index: number) => {
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
        .select('id, name, category, calories, protein, carbs, fat, allergens, price_level, goal_type')
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
      const safetyContext = {
        profile: profile.data || null,
        lifestyle: lifestyle.data || null,
        health: health.data || null
      };

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

${buildSafetyPromptAddendum(safetyContext)}

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
      recentMealsRes,
      recentMealLogsRes
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('body_metrics').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('exercises')
        .select('id, name, body_part, target_muscle, equipment, difficulty, goal_type, contraindications, estimated_duration_seconds, calories_per_minute, movement_pattern')
        .limit(AI_EXERCISE_CATALOG_LIMIT),
      supabase
        .from('foods')
        .select('id, name, category, calories, protein, carbs, fat, serving_unit, meal_type, goal_type, allergens, price_level, cooking_time_minutes, region, is_easy_to_prepare')
        .order('created_at', { ascending: false })
        .limit(AI_FOOD_CATALOG_FETCH_LIMIT),
      supabase
        .from('daily_exercise_sessions')
        .select('log_date, exercise_id, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, body_part, target_muscle)')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .limit(20),
      supabase
        .from('weekly_food_items')
        .select('day_of_week, meal_type, food_id, quantity, calories, protein, carbs, fat, weekly_food_plans!inner(user_id), foods:food_id(name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level)')
        .eq('weekly_food_plans.user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('daily_meal_logs')
        .select('log_date, meal_type, food_id, quantity, calories, protein, carbs, fat, custom_food_name, foods:food_id(name, category, calories, protein, carbs, fat, meal_type, goal_type, price_level)')
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
      foodCatalogRes.error,
      recentSessionsRes.error,
      recentMealsRes.error,
      recentMealLogsRes.error
    ].find(Boolean);
    if (firstError) throw firstError;

    const profile = profileRes.data || {};
    const bodyMetrics = bodyMetricsRes.data || {};
    const lifestyle = lifestyleRes.data || {};
    const health = healthRes.data || {};
    const safetyContext = { profile, lifestyle, health };
    const exercises = filterSafeExercisesForUser(clampList(exerciseCatalogRes.data as any[], AI_EXERCISE_CATALOG_LIMIT), safetyContext);
    const recentMealHistory = [
      ...((recentMealLogsRes.data || []) as any[]),
      ...((recentMealsRes.data || []) as any[])
    ];
    const weeklyWorkoutDays = resolveWeeklyWorkouts(lifestyle.activity_level, lifestyle.weekly_workouts);
    const mealsPerDay = resolveMealsPerDay(lifestyle.meals_per_day);
    const mealSlots = getMealSlotsForCount(mealsPerDay);
    const safeFoodSource = filterSafeFoodsForUser(foodCatalogRes.data as any[], safetyContext);
    const foods = selectBalancedFoodCatalog(safeFoodSource, AI_FOOD_CATALOG_LIMIT, {
      lifestyle,
      health,
      mealsPerDay,
      mealTypes: Array.from(new Set(mealSlots)),
      recentMeals: recentMealHistory,
      targetCalories: Number(lifestyle.target_calories || 0)
    });
    const exerciseIds = new Set(exercises.map((item: any) => String(item.id)));
    const exerciseById = new Map(exercises.map((item: any) => [String(item.id), item]));
    const foodById = new Map(foods.map((item: any) => [String(item.id), item]));
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
      .map((item: any) => `${item.id}|${truncateText(item.name, 34)}|body=${truncateText(item.body_part, 12)}|target=${truncateText(item.target_muscle, 16)}|eq=${truncateText(item.equipment, 14)}|level=${truncateText(item.difficulty, 10)}|pattern=${truncateText(item.movement_pattern, 12)}`)
      .join('\n');

    const foodCatalog = foods
      .map((item: any) => `${item.id}|${truncateText(item.name, 30)}|g=${classifyFoodComponent(item)}|k=${item.calories || 0}|p=${item.protein || 0}|c=${item.carbs || 0}|f=${item.fat || 0}|u=${truncateText(item.serving_unit || '100g', 10)}|meal=${truncateText((item.meal_type || []).join(','), 22)}|all=${truncateText((item.allergens || []).join(','), 24)}`)
      .join('\n');

    const recentTraining = clampList(recentSessionsRes.data as any[], 6)
      .map((item: any) => `${item.log_date}|${truncateText(item.exercises?.name || item.exercise_id, 32)}|${item.sets}x${item.reps}|${item.weight_kg || 0}kg|done=${!!item.is_completed}`)
      .join('\n') || 'No recent training history.';

    const recentEating = clampList(recentMealHistory, 6)
      .map((item: any) => `d=${item.day_of_week || item.log_date || ''}|${item.meal_type}|${truncateText(item.foods?.name || item.custom_food_name || item.food_id, 28)}|qty=${item.quantity}`)
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

${buildSafetyPromptAddendum(safetyContext)}

EXERCISE_CATALOG:
${exerciseCatalog || 'No safe exercise ids available after hard safety filtering. Use rest/recovery days only.'}

FOOD_CATALOG:
${foodCatalog}

Rules:
- Respect SAFETY_CONSTRAINTS above. They override weekly_workouts and all other goals.
- Exactly 7 days, day_of_week 0..6 where 0 is Monday.
- Never create new exercises or foods. Pick only exercise_id values from EXERCISE_CATALOG and food_id values from FOOD_CATALOG.
- Prefer exercise difficulty, goal_type, movement_pattern, equipment and duration that match the user profile.
- Avoid exercises whose contraindications conflict with injuries or health conditions.
- Prefer foods whose meal_type, goal_type, allergens, price_level, cooking_time_minutes and region match the user profile.
- Avoid foods whose allergens conflict with allergies_or_medical_history.
- FOOD_CATALOG is already ranked by meal slot, diet preference, budget and eating-history trends; earlier rows are better matches.
- Breakfast must use foods that support breakfast; lunch and dinner must use foods that support lunch/dinner; snack must use snack/breakfast-friendly foods.
- Use recent meal history to infer the user's preferred categories, protein/carb/vegetable balance, diet style and budget tendency.
- Repeating a liked food is allowed, but do not over-repeat the same exact food or same limited family more than 2-3 times in a week.
- Training days should match weekly_workouts. Rest days: is_rest_day=true and no exercises.
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

    const parsed = parseJsonFromAiText(groqResult.choices?.[0]?.message?.content || '');
    const normalizedPlan = normalizeAiPlanPayload(parsed);
    const guardedWorkout = sanitizeWorkoutPlanForUser(
      normalizedPlan.workoutPlan,
      safetyContext,
      exerciseById
    );
    normalizedPlan.workoutPlan = guardedWorkout.workoutPlan;

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

      for (const [index, item] of day.exercises.entries()) {
        const exerciseId = String(item.exercise_id || '');
        if (!exerciseIds.has(exerciseId)) continue;
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

      const expandedMeals = expandAiMealItems(day.meals || [], foodById);
      const enrichedMeals = enrichMealComponents(expandedMeals, mealsPerDay, foodById, foods);
      const normalizedMeals = normalizeDayMeals(enrichedMeals, mealsPerDay, foodById);
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
    if (error instanceof ApiRequestError) {
      return res.status(error.status).json(error.body);
    }
    return res.status(500).json({
      code: 'AI_GENERATION_FAILED',
      error: 'Không thể tạo lịch AI 7 ngày lúc này. Vui lòng thử lại sau.'
    });
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
  if (IS_PRODUCTION && !telegramBot && process.env.TELEGRAM_BOT_ENABLED !== 'false') {
    console.warn('Telegram bot chua khoi dong; vui long kiem tra TELEGRAM_BOT_TOKEN.');
  }
});
