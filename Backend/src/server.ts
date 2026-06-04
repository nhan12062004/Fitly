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
import { detectIntent, extractDayIndexFromText } from './services/ai/aiRouterService';
import { aiChatService } from './services/ai/aiChatService';
import { aiPlannerService } from './services/ai/aiPlannerService';
import { workoutAdjusterService } from './services/ai/workoutAdjusterService';
import { mealAdjusterService } from './services/ai/mealAdjusterService';
import { progressAnalyzerService } from './services/ai/progressAnalyzerService';
import { AIChatResponse } from './services/ai/types';
import { incrementMetric, logAIEvent, snapshotAIMetrics } from './lib/aiObservability';
import { validateActionPayload } from './services/ai/aiValidationService';
import { createTelegramLinkToken } from './lib/telegramLinkToken';

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
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, order_index.
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
            "rest_seconds": 60,
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

app.post('/api/ai/chat', aiLimiter, async (req, res) => {
  const startedAt = Date.now();
  const traceId = `ai-chat-${startedAt}-${Math.floor(Math.random() * 10000)}`;
  let success = false;
  let authUserId: string | null = null;
  let detectedIntent: string | undefined;
  let detectedActionType: string | null | undefined;
  try {
    authUserId = await getAuthUserId(req);
    const { message, selectedDayIndex, weekStartDate } = req.body || {};
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';
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

    incrementMetric('totalChatRequests');
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
    const [todayWorkoutRes, todayMealRes, weekPlanRes, feedbackRes, profileRes, bodyMetricsRes, healthRes, recentChatRes] = await Promise.all([
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
        .select('id, full_name, membership_tier, created_at')
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
        .limit(8)
    ]);

    const workoutRows = (todayWorkoutRes.data as any)?.weekly_plan_exercises || [];
    const mealRows = (todayMealRes.data as any)?.weekly_food_items || [];
    const targetWorkoutRows = workoutRows.filter((row: any) => Number(row.day_of_week) === dayIndex && row.exercise_id);
    const targetMealRows = mealRows.filter((row: any) => Number(row.day_of_week) === dayIndex && row.food_id);

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
      aiResponse = await aiChatService(normalizedMessage, {
        todayWorkoutCount: targetWorkoutRows.length,
        todayMealCount: targetMealRows.length,
        todayDayIndex: todayDayIndex,
        targetDayIndex: dayIndex,
        targetDayLabel: AI_CHAT_DAY_LABELS[dayIndex] || 'Hom nay',
        profile: profileRes.data || null,
        bodyMetrics: bodyMetricsRes.data || null,
        lifestyle: weekPlanRes.data || null,
        health: healthRes.data || null,
        chatHistory: ((recentChatRes.data || []) as any[])
          .reverse()
          .map((item: any) => ({
            role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
            content: String(item.content || ''),
          })),
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
      intent,
      confidence
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
      intent,
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
      const oldData = normalizedResponse.intent.includes('meal')
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
        plan_type: normalizedResponse.intent.includes('meal') ? 'meal' : 'workout',
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
            .select('id')
            .eq('id', requestedWorkoutPlanId)
            .eq('user_id', authUserId)
            .maybeSingle()
        : supabase
            .from('weekly_plans')
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
          error: requestedWorkoutPlanId ? 'Original workout plan not found for user' : 'Active workout plan not found'
        });
      }
      const workoutPlanId = planRes.data.id;

      const exercises = Array.isArray(newData.exercises) ? newData.exercises : [];
      const exerciseIds: string[] = [...new Set<string>(
        exercises
          .map((item: any) => String(item?.exercise_id || '').trim())
          .filter((id: string) => Boolean(id))
      )];
      const validExercisesRes = await supabase
        .from('exercises')
        .select('id')
        .in('id', exerciseIds);
      if (validExercisesRes.error) throw validExercisesRes.error;
      const existingExerciseIds = new Set<string>((validExercisesRes.data || []).map((item: any) => String(item.id)));
      const missingExerciseIds = exerciseIds.filter((id) => !existingExerciseIds.has(id));
      if (missingExerciseIds.length > 0) {
        return res.status(400).json({ error: `Invalid exercise_id: ${missingExerciseIds.join(', ')}` });
      }

      const removeRes = await supabase
        .from('weekly_plan_exercises')
        .delete()
        .eq('weekly_plan_id', workoutPlanId)
        .eq('day_of_week', dayOfWeek);
      if (removeRes.error) throw removeRes.error;

      const rows = exercises
        .map((item: any, index: number) => ({
          weekly_plan_id: workoutPlanId,
          day_of_week: dayOfWeek,
          exercise_id: item.exercise_id || null,
          sets: Math.max(1, Number(item.sets || 2)),
          reps: String(item.reps || '8-10'),
          weight_kg: Math.max(0, Number(item.weight_kg || 0)),
          rest_seconds: Math.max(30, Number(item.rest_seconds || 60)),
          order_index: index,
          is_rest_day: false
        }))
        .filter((row: any) => row.exercise_id);

      if (rows.length > 0) {
        const addRes = await supabase.from('weekly_plan_exercises').insert(rows);
        if (addRes.error) throw addRes.error;
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
- Each exercise needs exercise_id, sets, reps, weight_kg, rest_seconds, order_index.
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
            "rest_seconds": 60,
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
