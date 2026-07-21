import { useState, useEffect, useRef, type ReactNode } from 'react';
import { CheckCircle2, ChevronRight, Dumbbell, Flame, Sparkles, Utensils } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateDailyStreak,
  completeDailyStreakToday,
  getStreakHistoryStartKey,
  initialDailyStreak,
  type DailyStreakState,
  type StreakMealRow,
  type StreakProgressRow,
  type StreakWorkoutRow,
} from '../lib/DailyStreak';
import { supabase } from '../lib/Supabase';
import { useNavigate } from 'react-router-dom';
import { estimateWorkoutDurationMinutes } from '../lib/workoutDuration';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

const getDatePartsInTimeZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return { year, month, day };
};

const getVietnamDateKey = (date = new Date()): string => {
  const { year, month, day } = getDatePartsInTimeZone(date, VIETNAM_TIMEZONE);
  return `${year}-${month}-${day}`;
};

const getVietnamHour = (date = new Date()): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VIETNAM_TIMEZONE,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  return Number.isFinite(hour) ? hour : 0;
};

function normalizeExerciseMediaUrl(raw: string): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
}

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getVietnamDateKey(date);
};

const initialStats = {
  workout_duration: 0,
  calories_burned: 0,
  remaining_workouts: 0,
  streak_days: 0
};

const initialDailyProgress = {
  caloriesConsumed: 0,
  calorieTarget: 0,
  workoutMinutes: 0,
  workoutTarget: 20,
  waterIntake: 0,
  waterGoal: 2.5,
  sleepActual: 0,
  sleepTarget: 7
};

const initialDailyNutrition = {
  protein: 0,
  carbs: 0,
  fat: 0
};

type TodayIconTone = 'score' | 'workout' | 'nutrition' | 'water' | 'weight' | 'coach';

function TodayIcon({
  icon,
  tone,
  size = 'md'
}: {
  icon: ReactNode;
  tone: TodayIconTone;
  size?: 'sm' | 'md';
}) {
  return (
    <span className={`progress-svg-mark progress-svg-mark--${size} progress-tone-${tone}`} aria-hidden="true">
      <span className="progress-svg-glyph">{icon}</span>
    </span>
  );
}

const formatWholeNumber = (value: number) => Math.round(Number(value) || 0).toLocaleString('vi-VN');

const formatProgressNumber = (value: number) => {
  const nextValue = Number(value) || 0;
  return Number.isInteger(nextValue) ? String(nextValue) : nextValue.toFixed(1);
};

const normalizeWaterGoalMl = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric > 20 ? numeric : numeric * 1000;
};

const normalizeTextKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const splitFocusValues = (value: string | null | undefined) =>
  String(value || '')
    .split(/[\/,|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const getFocusLabel = (value: string) => {
  const key = normalizeTextKey(value);
  if (key.includes('chest') || key.includes('pec') || key.includes('nguc')) return 'Ngực';
  if (key.includes('shoulder') || key.includes('deltoid') || key.includes('vai')) return 'Vai';
  if (key.includes('tricep') || key.includes('tay sau')) return 'Tay sau';
  if (key.includes('bicep') || key.includes('tay truoc')) return 'Tay trước';
  if (key.includes('back') || key.includes('lat') || key.includes('lung')) return 'Lưng';
  if (key.includes('leg') || key.includes('quad') || key.includes('hamstring') || key.includes('calf') || key.includes('chan')) return 'Chân';
  if (key.includes('glute') || key.includes('mong')) return 'Mông';
  if (key.includes('core') || key.includes('abs') || key.includes('bung')) return 'Core';
  return value.trim();
};

const getWorkoutSplitLabel = (focusLabels: string[]) => {
  if (focusLabels.some((label) => label === 'Ngực' || label === 'Vai' || label === 'Tay sau')) return 'Push';
  if (focusLabels.some((label) => label === 'Lưng' || label === 'Tay trước')) return 'Pull';
  if (focusLabels.some((label) => label === 'Chân' || label === 'Mông')) return 'Leg';
  if (focusLabels.some((label) => label === 'Core')) return 'Core';
  return 'Bài tập';
};

const getWorkoutDifficultyLabel = (value: string | null | undefined) => {
  const key = normalizeTextKey(String(value || ''));
  if (!key) return 'vừa';
  if (key.includes('beginner') || key.includes('easy') || key.includes('light') || key.includes('de')) return 'nhẹ';
  if (key.includes('advanced') || key.includes('hard') || key.includes('heavy') || key.includes('kho')) return 'nặng';
  return 'vừa';
};

const MEAL_SLOT_META = {
  breakfast: { label: 'Bữa sáng', hour: 8 },
  lunch: { label: 'Bữa trưa', hour: 12 },
  dinner: { label: 'Bữa tối', hour: 19 },
  snack: { label: 'Bữa phụ', hour: 16 }
} as const;

type MealType = keyof typeof MEAL_SLOT_META;

type OverviewMeal = {
  type: MealType;
  label: string;
  foods: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

type MealBucket = {
  label: string;
  foods: string[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

const resolveMealsPerDay = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  // Overview currently renders 4 fixed meal types. Cap at 4 until the data model supports a fifth slot.
  return Math.max(2, Math.min(4, Math.round(parsed)));
};

const getMealTypesForCount = (mealsPerDay: number): MealType[] => {
  if (mealsPerDay <= 2) return ['breakfast', 'dinner'];
  if (mealsPerDay === 3) return ['breakfast', 'lunch', 'dinner'];
  return ['breakfast', 'lunch', 'snack', 'dinner'];
};

const toMealType = (value: string | null | undefined): MealType => {
  if (value === 'lunch' || value === 'dinner' || value === 'snack') return value;
  return 'breakfast';
};

const createDefaultMeals = (mealsPerDay: number): OverviewMeal[] =>
  getMealTypesForCount(mealsPerDay).map((type) => ({
    type,
    label: MEAL_SLOT_META[type].label,
    foods: 'Chưa lập thực đơn',
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  }));

type OverviewExercise = {
  id: string;
  exercise_id: string;
  order_index: number;
  name: string;
  video_url: string;
  body_part: string;
  target_muscle: string;
  difficulty: string;
  instructions: string[] | string;
  sets: number;
  reps: string;
  weight_kg: number;
  rest_seconds: number;
  estimated_duration_seconds: number | null;
  is_completed: boolean;
  kcal: number;
};

type OverviewMealItem = {
  food_id: string;
  meal_type: MealType;
  quantity: number;
  // weekly_food_items metrics are stored per serving/unit; totals must multiply by quantity.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: Record<string, any>;
};

type DailyMealLogRow = {
  // daily_meal_logs metrics are stored per serving/unit; totals must multiply by quantity.
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  quantity: number | null;
  is_completed?: boolean | null;
};

let overviewCache: {
  userId: string;
  stats: typeof initialStats;
  todayExercises: OverviewExercise[];
  todayMealItems: OverviewMealItem[];
  todayMeals: OverviewMeal[];
  dailyNutrition: typeof initialDailyNutrition;
  dailyProgress: typeof initialDailyProgress;
  dailyStreak: DailyStreakState;
  mealsPerDay: number;
} | null = null;

export default function Overview() {
  const navigate = useNavigate();
  const { user, isLoggedIn, profile, refreshTick } = useAuth();
  const cachedOverview = user?.id && overviewCache?.userId === user.id ? overviewCache : null;
  const [loading, setLoading] = useState(() => !cachedOverview);
  const [, setIsRefreshing] = useState(false);
  const [stats, setStats] = useState(() => cachedOverview?.stats || initialStats);
  const [todayExercises, setTodayExercises] = useState<OverviewExercise[]>(() => cachedOverview?.todayExercises || []);
  const [todayMealItems, setTodayMealItems] = useState<OverviewMealItem[]>(() => cachedOverview?.todayMealItems || []);
  const [mealsPerDay, setMealsPerDay] = useState(() => cachedOverview?.mealsPerDay || 3);
  const [todayMeals, setTodayMeals] = useState<OverviewMeal[]>(() => cachedOverview?.todayMeals || createDefaultMeals(cachedOverview?.mealsPerDay || 3));
  const [dailyNutrition, setDailyNutrition] = useState(() => cachedOverview?.dailyNutrition || initialDailyNutrition);
  const [dailyProgress, setDailyProgress] = useState(() => cachedOverview?.dailyProgress || initialDailyProgress);
  const [dailyStreak, setDailyStreak] = useState<DailyStreakState>(() => cachedOverview?.dailyStreak || initialDailyStreak);
  const [progressBarsActive, setProgressBarsActive] = useState(false);
  const dailyStreakRef = useRef(dailyStreak);
  const refreshTickRef = useRef(refreshTick);
  const prevRefreshTickRef = useRef(refreshTick);
  const skipRefreshTickRef = useRef<number | null>(null);

  const resolveMealMetric = (primary: unknown, fallback: unknown): number => {
    const primaryValue = Number(primary);
    if (Number.isFinite(primaryValue) && primaryValue > 0) return primaryValue;
    const fallbackValue = Number(fallback);
    return Number.isFinite(fallbackValue) ? fallbackValue : 0;
  };

  useEffect(() => {
    if (loading) return;
    setProgressBarsActive(false);
    let frameId = 0;
    let frameId2 = 0;
    frameId = window.requestAnimationFrame(() => {
      frameId2 = window.requestAnimationFrame(() => {
        setProgressBarsActive(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(frameId2);
    };
  }, [
    loading,
    stats.calories_burned,
    dailyProgress.waterIntake,
    dailyProgress.waterGoal,
    dailyProgress.sleepActual,
    dailyProgress.sleepTarget,
    dailyProgress.workoutMinutes,
    dailyProgress.workoutTarget,
    dailyNutrition.protein,
    dailyNutrition.carbs,
    dailyNutrition.fat,
    todayMealItems.length
  ]);

  useEffect(() => {
    refreshTickRef.current = refreshTick;
  }, [refreshTick]);

  useEffect(() => {
    dailyStreakRef.current = dailyStreak;
  }, [dailyStreak]);

  useEffect(() => {
    const handleWaterUpdated = (event: Event) => {
      const waterIntake = Number((event as CustomEvent<{ waterIntake?: number }>).detail?.waterIntake);
      if (!Number.isFinite(waterIntake)) return;
      skipRefreshTickRef.current = refreshTickRef.current + 1;

      setDailyProgress((prev) => {
        const next = { ...prev, waterIntake };
        const waterGoalMl = normalizeWaterGoalMl(next.waterGoal);
        const reachedWaterGoal = waterGoalMl !== null && waterIntake * 1000 >= waterGoalMl;
        const nextStreak = reachedWaterGoal
          ? completeDailyStreakToday(dailyStreakRef.current, 'Uống đủ nước')
          : dailyStreakRef.current;
        if (reachedWaterGoal) {
          dailyStreakRef.current = nextStreak;
          setDailyStreak(nextStreak);
          setStats((previousStats) => ({ ...previousStats, streak_days: nextStreak.count }));
        }
        if (overviewCache) {
          overviewCache = {
            ...overviewCache,
            dailyProgress: next,
            dailyStreak: nextStreak,
            stats: reachedWaterGoal
              ? { ...overviewCache.stats, streak_days: nextStreak.count }
              : overviewCache.stats
          };
        }
        return next;
      });
    };

    window.addEventListener('fitly:water-updated', handleWaterUpdated as EventListener);
    return () => {
      window.removeEventListener('fitly:water-updated', handleWaterUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    const isRefreshTickUpdate = prevRefreshTickRef.current !== refreshTick;
    prevRefreshTickRef.current = refreshTick;

    if (isRefreshTickUpdate && skipRefreshTickRef.current === refreshTick) {
      skipRefreshTickRef.current = null;
      return;
    }

    async function fetchData() {
      if (!user) return;
      const hasCache = overviewCache?.userId === user.id;
      setLoading(!hasCache);
      setIsRefreshing(hasCache);
      if (!hasCache) {
        setStats(initialStats);
        setTodayExercises([]);
        setTodayMealItems([]);
        setMealsPerDay(3);
        setTodayMeals(createDefaultMeals(3));
        setDailyNutrition(initialDailyNutrition);
        setDailyProgress(initialDailyProgress);
        dailyStreakRef.current = initialDailyStreak;
        setDailyStreak(initialDailyStreak);
      }
      try {
        const today = new Date();
        const todayStr = getVietnamDateKey(today);
        const streakHistoryStart = getStreakHistoryStartKey(todayStr);
        const [
          lifestyleRes,
          progressLogRes,
          todaySessionsRes,
          dailyMealLogsRes,
          healthRes,
          plansRes,
          streakWorkoutsRes,
          streakMealsRes,
          streakProgressRes
        ] = await Promise.all([
          supabase.from('lifestyle_settings').select('workout_duration, daily_water_goal, target_calories, meals_per_day').eq('user_id', user.id).maybeSingle(),
          supabase.from('daily_progress_logs').select('water_intake_ml, sleep_hours').eq('user_id', user.id).eq('log_date', todayStr).maybeSingle(),
          supabase.from('daily_exercise_sessions').select('id, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, is_completed, estimated_kcal, actual_kcal_estimated, completed_sets, exercises:exercise_id(name, video_url, instructions, target_muscle, body_part, difficulty, estimated_duration_seconds)').eq('user_id', user.id).eq('log_date', todayStr).order('order_index', { ascending: true }),
          supabase.from('daily_meal_logs').select('calories, protein, carbs, fat, quantity, is_completed').eq('user_id', user.id).eq('log_date', todayStr).eq('is_completed', true),
          supabase.from('health_conditions').select('sleep_hours').eq('user_id', user.id).maybeSingle(),
          supabase.from('weekly_food_plans').select('id, week_start_date').eq('user_id', user.id).gte('week_start_date', addDaysToDateKey(todayStr, -6)).lte('week_start_date', todayStr).eq('plan_status', 'active').order('week_start_date', { ascending: false }).limit(1),
          supabase.from('daily_exercise_sessions').select('log_date, is_completed').eq('user_id', user.id).gte('log_date', streakHistoryStart).lte('log_date', todayStr),
          supabase.from('daily_meal_logs').select('log_date, is_completed').eq('user_id', user.id).gte('log_date', streakHistoryStart).lte('log_date', todayStr),
          supabase.from('daily_progress_logs').select('log_date, water_intake_ml, sleep_hours').eq('user_id', user.id).gte('log_date', streakHistoryStart).lte('log_date', todayStr)
        ]);

        const todaySessions = todaySessionsRes.data || [];
        const completedSessions = todaySessions.filter((session: any) => !!session.is_completed);
        const streakWorkouts: StreakWorkoutRow[] = [
          ...((streakWorkoutsRes.data || []) as StreakWorkoutRow[]),
          ...todaySessions.map((session: any) => ({
            log_date: todayStr,
            is_completed: Boolean(session.is_completed)
          }))
        ];
        const streakMeals: StreakMealRow[] = [
          ...((streakMealsRes.data || []) as StreakMealRow[]),
          ...(dailyMealLogsRes.data || []).map((meal: any) => ({
            log_date: todayStr,
            is_completed: meal.is_completed !== false
          }))
        ];
        const streakProgress: StreakProgressRow[] = [
          ...((streakProgressRes.data || []) as StreakProgressRow[]),
          ...(progressLogRes.data
            ? [{
                log_date: todayStr,
                water_intake_ml: Number(progressLogRes.data.water_intake_ml || 0),
                sleep_hours: Number(progressLogRes.data.sleep_hours || 0)
              }]
            : [])
        ];
        const nextDailyStreak = calculateDailyStreak({
          todayKey: todayStr,
          waterGoalMl: normalizeWaterGoalMl(lifestyleRes.data?.daily_water_goal),
          workouts: streakWorkouts,
          meals: streakMeals,
          progressLogs: streakProgress
        });
        dailyStreakRef.current = nextDailyStreak;
        setDailyStreak(nextDailyStreak);
        const estimatedCaloriesFromSessions = completedSessions.reduce(
          (sum: number, item: any) => {
            const actualKcal = Number(item.actual_kcal_estimated);
            if (Number.isFinite(actualKcal) && actualKcal > 0) {
              return sum + actualKcal;
            }
            return sum + Math.max(0, Number(item.estimated_kcal) || 0);
          },
          0
        );
        const remainingWorkoutCount = Math.max(0, todaySessions.length - completedSessions.length);

        const nextStats = {
          workout_duration: 0,
          calories_burned: estimatedCaloriesFromSessions,
          remaining_workouts: remainingWorkoutCount,
          streak_days: nextDailyStreak.count
        };
        setStats(nextStats);

        const nextTodayExercises = todaySessions.map((session: any) => ({
          id: String(session.id || ''),
          exercise_id: String(session.exercise_id || ''),
          order_index: Number(session.order_index || 0),
          name: (session.exercises as any)?.name || 'B?i t?p',
          video_url: normalizeExerciseMediaUrl((session.exercises as any)?.video_url || ''),
          body_part: String((session.exercises as any)?.body_part || ''),
          target_muscle: String((session.exercises as any)?.target_muscle || ''),
          difficulty: String((session.exercises as any)?.difficulty || ''),
          instructions: (session.exercises as any)?.instructions || [],
          sets: session.sets || 0,
          reps: session.reps || '-',
          weight_kg: session.weight_kg || 0,
          rest_seconds: session.rest_seconds || 0,
          estimated_duration_seconds: Number((session.exercises as any)?.estimated_duration_seconds) || null,
          is_completed: !!session.is_completed,
          kcal: (() => {
            const actualKcal = Number(session.actual_kcal_estimated);
            if (Number.isFinite(actualKcal) && actualKcal > 0) {
              return Math.round(actualKcal);
            }
            return Math.max(0, Math.round(Number(session.estimated_kcal) || 0));
          })()
        }));
        setTodayExercises(nextTodayExercises);

        let sleepTarget = 7;
        if (healthRes.data?.sleep_hours) {
          const sleepHours = String(healthRes.data.sleep_hours);
          sleepTarget = sleepHours.includes('-') ? parseInt(sleepHours.split('-')[1]) || 7 : parseInt(sleepHours) || 7;
        }

        const resolvedMealsPerDay = resolveMealsPerDay(lifestyleRes.data?.meals_per_day);
        setMealsPerDay(resolvedMealsPerDay);

        const nextDailyProgress = {
          caloriesConsumed: 0,
          calorieTarget: Number(lifestyleRes.data?.target_calories || 0),
          workoutMinutes: 0,
          workoutTarget: Number(lifestyleRes.data?.workout_duration || 20),
          waterIntake: progressLogRes.data?.water_intake_ml ? progressLogRes.data.water_intake_ml / 1000 : 0,
          waterGoal: Number(lifestyleRes.data?.daily_water_goal || 2.5),
          sleepActual: progressLogRes.data?.sleep_hours || 0,
          sleepTarget
        };
        setDailyProgress(nextDailyProgress);

        let mealsList = createDefaultMeals(resolvedMealsPerDay);
        let mealItemsList: OverviewMealItem[] = [];
        let nutritionTotals = initialDailyNutrition;
        const plans = plansRes.data;

        if (plans && plans.length > 0) {
          const todayDayOfWeek = Math.max(0, Math.min(6, Math.round((Date.parse(`${todayStr}T00:00:00Z`) - Date.parse(`${plans[0].week_start_date}T00:00:00Z`)) / (24 * 60 * 60 * 1000))));
          const { data: foodItems } = await supabase
            .from('weekly_food_items')
            .select('food_id, calories, protein, carbs, fat, quantity, meal_type, foods:food_id(name, calories, protein, carbs, fat, image_url)')
            .eq('food_plan_id', plans[0].id)
            .eq('day_of_week', todayDayOfWeek);

          if (foodItems && foodItems.length > 0) {
            const foodIds = [...new Set(foodItems.map((item: any) => item.food_id).filter(Boolean))];
            let foodLookup: Record<string, any> = {};
            if (foodIds.length > 0) {
              const { data: foodsBase } = await supabase
                .from('foods')
                .select('id, name, calories, protein, carbs, fat')
                .in('id', foodIds);
              foodLookup = Object.fromEntries((foodsBase || []).map((food: any) => [String(food.id), food]));
            }

            const mealTypes: MealType[] = getMealTypesForCount(resolvedMealsPerDay);
            const mealMap: Record<MealType, MealBucket> = {
              breakfast: { label: MEAL_SLOT_META.breakfast.label, foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0 },
              lunch: { label: MEAL_SLOT_META.lunch.label, foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0 },
              dinner: { label: MEAL_SLOT_META.dinner.label, foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0 },
              snack: { label: MEAL_SLOT_META.snack.label, foods: [], kcal: 0, protein: 0, carbs: 0, fat: 0 }
            };
            let proteinTotal = 0;
            let carbsTotal = 0;
            let fatTotal = 0;
            const visibleMealTypes = new Set(getMealTypesForCount(resolvedMealsPerDay));

            (foodItems as any[]).forEach((item: any) => {
              const type = toMealType(item.meal_type);
              if (!visibleMealTypes.has(type)) return;
              const qty = Number(item.quantity || 1);
              const foodBase = foodLookup[String(item.food_id)] || {};
              // weekly_food_items macros are stored per unit/serving; totals must apply quantity.
              const kcal = resolveMealMetric(item.calories, (item.foods as any)?.calories ?? foodBase.calories) * qty;
              const protein = resolveMealMetric(item.protein, (item.foods as any)?.protein ?? foodBase.protein) * qty;
              const carbs = resolveMealMetric(item.carbs, (item.foods as any)?.carbs ?? foodBase.carbs) * qty;
              const fat = resolveMealMetric(item.fat, (item.foods as any)?.fat ?? foodBase.fat) * qty;
              const name = (item.foods as any)?.name || foodBase.name || 'Món ăn';

              mealItemsList.push({
                food_id: String(item.food_id),
                meal_type: type,
                quantity: qty,
                calories: kcal,
                protein,
                carbs,
                fat,
                foods: {
                  ...(item.foods as any),
                  ...foodBase,
                  name
                }
              });
              mealMap[type].foods.push(name);
              mealMap[type].kcal += kcal;
              mealMap[type].protein += protein;
              mealMap[type].carbs += carbs;
              mealMap[type].fat += fat;
              proteinTotal += protein;
              carbsTotal += carbs;
              fatTotal += fat;
            });

            mealsList = mealTypes.map((type) => ({
              type,
              label: mealMap[type].label,
              foods: mealMap[type].foods.length > 0 ? mealMap[type].foods.join(', ') : 'Chưa lập thực đơn',
              kcal: Math.round(mealMap[type].kcal),
              protein: Math.round(mealMap[type].protein),
              carbs: Math.round(mealMap[type].carbs),
              fat: Math.round(mealMap[type].fat)
            }));
            nutritionTotals = {
              protein: Math.round(proteinTotal),
              carbs: Math.round(carbsTotal),
              fat: Math.round(fatTotal)
            };
          }
        }

        setTodayMealItems(mealItemsList);
        setTodayMeals(mealsList);
        const mealTotalKcal = mealsList.reduce((sum, meal) => sum + (meal.kcal || 0), 0);
        const actualMealLogs = (dailyMealLogsRes.data || []) as DailyMealLogRow[];
        const actualMealLogTotals = actualMealLogs.reduce((sum, item) => {
          const qty = Math.max(0, Number(item.quantity || 1));
          return {
            calories: sum.calories + (Math.max(0, Number(item.calories || 0)) * qty),
            protein: sum.protein + (Math.max(0, Number(item.protein || 0)) * qty),
            carbs: sum.carbs + (Math.max(0, Number(item.carbs || 0)) * qty),
            fat: sum.fat + (Math.max(0, Number(item.fat || 0)) * qty)
          };
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
        const hasActualMealLogs = actualMealLogs.length > 0;
        const nextDailyNutrition = hasActualMealLogs
          ? {
              protein: Math.round(actualMealLogTotals.protein),
              carbs: Math.round(actualMealLogTotals.carbs),
              fat: Math.round(actualMealLogTotals.fat)
            }
          : nutritionTotals;
        setDailyNutrition(nextDailyNutrition);
        const nextDailyProgressWithMeals = {
          ...nextDailyProgress,
          caloriesConsumed: hasActualMealLogs ? Math.round(actualMealLogTotals.calories) : mealTotalKcal
        };
        setDailyProgress(nextDailyProgressWithMeals);

        overviewCache = {
          userId: user.id,
          stats: nextStats,
          todayExercises: nextTodayExercises,
          todayMealItems: mealItemsList,
          todayMeals: mealsList,
          dailyNutrition: nextDailyNutrition,
          dailyProgress: nextDailyProgressWithMeals,
          dailyStreak: nextDailyStreak,
          mealsPerDay: resolvedMealsPerDay
        };
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    }

    if (isLoggedIn) {
      fetchData();
    } else {
      overviewCache = null;
      setLoading(false);
      setIsRefreshing(false);
      setStats(initialStats);
      setTodayExercises([]);
      setTodayMealItems([]);
      setMealsPerDay(3);
      setTodayMeals(createDefaultMeals(3));
      setDailyNutrition(initialDailyNutrition);
      setDailyProgress(initialDailyProgress);
      dailyStreakRef.current = initialDailyStreak;
      setDailyStreak(initialDailyStreak);
    }
  }, [user, isLoggedIn, profile, refreshTick]);

  if (loading) return <OverviewSkeleton />;

  const fallbackName = 'Thành viên';
  const rawName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || fallbackName;
  const nameParts = rawName.trim().split(/\s+/);
  const userName = rawName === fallbackName
    ? fallbackName
    : nameParts.length > 1
      ? `${nameParts[nameParts.length - 1]} ${nameParts[0]}`
      : rawName;

  const currentHour = getVietnamHour();
  const greetingLabel = currentHour < 12
    ? 'Chào buổi sáng'
    : currentHour < 18
      ? 'Chào buổi chiều'
      : 'Chào buổi tối';

  const plannedWorkoutMinutes = estimateWorkoutDurationMinutes(todayExercises);

  const featuredExercise = todayExercises[0];
  const hasWorkoutPlan = todayExercises.length > 0;
  const hasMealPlan = todayMealItems.length > 0;
  const completedWorkoutCount = todayExercises.filter((exercise) => exercise.is_completed).length;
  const workoutCompleted = hasWorkoutPlan && completedWorkoutCount >= todayExercises.length;
  const workoutFocusLabels = Array.from(new Set(
    todayExercises.flatMap((exercise) => [
      ...splitFocusValues(exercise.target_muscle),
      ...splitFocusValues(exercise.body_part)
    ].map(getFocusLabel))
  )).slice(0, 3);
  const workoutSplitLabel = getWorkoutSplitLabel(workoutFocusLabels);
  const workoutHeadline = hasWorkoutPlan
    ? `${workoutSplitLabel}${workoutFocusLabels.length > 0 ? ` - ${workoutFocusLabels.join(', ')}` : ''}`
    : 'Bạn chưa có kế hoạch hôm nay';
  const workoutDifficultyLabel = getWorkoutDifficultyLabel(todayExercises.find((exercise) => exercise.difficulty)?.difficulty);
  const workoutMetaLine = hasWorkoutPlan
    ? `~${plannedWorkoutMinutes} phút · ${stats.remaining_workouts} bài còn lại · Mức độ ${workoutDifficultyLabel}`
    : 'Chưa có buổi tập hôm nay';
  const plannedMealTotalKcal = todayMeals.reduce((sum, meal) => sum + (meal.kcal || 0), 0);
  const actualMealTotalKcal = Math.round(dailyProgress.caloriesConsumed || 0);
  const mealTarget = dailyProgress.calorieTarget || 2400;
  const mealProtein = Math.round(dailyNutrition.protein || 0);
  const mealProteinTarget = Math.round(mealTarget * 0.3 / 4);
  const workoutCompletionPercent = hasWorkoutPlan
    ? Math.min(100, Math.round((completedWorkoutCount / Math.max(1, todayExercises.length)) * 100))
    : 0;
  const remainingWorkoutCount = hasWorkoutPlan ? Math.max(0, todayExercises.length - completedWorkoutCount) : 0;
  const mealCaloriePercent = Math.min(100, Math.round((actualMealTotalKcal / Math.max(1, mealTarget)) * 100));
  const mealProteinPercent = Math.min(100, Math.round((mealProtein / Math.max(1, mealProteinTarget)) * 100));
  const loggedMealsCount = todayMeals.filter((meal) => meal.kcal > 0).length;
  const progressRows = [
    {
      label: 'Nước',
      value: `${formatProgressNumber(dailyProgress.waterIntake)} / ${formatProgressNumber(dailyProgress.waterGoal)}L`,
      width: Math.min(100, Math.round((dailyProgress.waterIntake / Math.max(0.1, dailyProgress.waterGoal)) * 100)),
      color: 'bg-info'
    },
    {
      label: 'Giấc ngủ',
      value: `${dailyProgress.sleepActual} / ${dailyProgress.sleepTarget} giờ`,
      width: Math.min(100, Math.round((dailyProgress.sleepActual / Math.max(1, dailyProgress.sleepTarget)) * 100)),
      color: 'bg-ai'
    },
    {
      label: 'Tập luyện',
      value: hasWorkoutPlan ? (workoutCompleted ? 'Đã hoàn thành' : 'Chưa hoàn thành') : 'Chưa có kế hoạch',
      width: workoutCompletionPercent,
      color: 'bg-accent'
    }
  ];
  const healthScoreParts = [
    Math.min(100, Math.round((dailyProgress.waterIntake / Math.max(0.1, dailyProgress.waterGoal)) * 100)),
    Math.min(100, Math.round((dailyProgress.sleepActual / Math.max(1, dailyProgress.sleepTarget)) * 100)),
    hasWorkoutPlan ? Math.min(100, Math.round((completedWorkoutCount / Math.max(1, todayExercises.length)) * 100)) : 0,
  ];
  const healthScore = Math.round(healthScoreParts.reduce((sum, value) => sum + value, 0) / healthScoreParts.length);
  const healthScoreLabel = healthScore >= 80 ? 'Rất tốt' : healthScore >= 50 ? 'Đang tiến bộ' : 'Cần cải thiện';
  const hasProgressData = dailyProgress.waterIntake > 0 || dailyProgress.sleepActual > 0 || completedWorkoutCount > 0;

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <section className="overview-hero flex flex-col justify-between overflow-hidden rounded-xl px-5 py-5 md:px-6 md:py-6">
        <div className="max-w-[28rem]">
          <p className="text-sm font-black text-accent md:text-base">
            {greetingLabel}, {userName} <span aria-hidden>👋</span>
          </p>
          <h1 className="overview-hero-title mt-2 max-w-[20rem] text-[2rem] font-black leading-[1.02] md:text-[2.55rem]">
            Chào mừng đến với Fitly!
          </h1>
          <span className="mt-4 block h-1.5 w-16 rounded-full bg-accent" aria-hidden="true" />
          <p className="overview-hero-copy mt-4 max-w-[21rem] text-sm font-semibold leading-6 md:text-[15px]">
            Tạo kế hoạch tập & ăn để bắt đầu theo dõi hành trình của bạn.
          </p>
        </div>

        <div className="overview-hero-metrics mt-6 grid max-w-[38rem] grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="overview-hero-metric-card flex min-w-0 items-center gap-4 rounded-2xl border p-3 backdrop-blur-md">
            <div
              className="overview-hero-score-ring flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(rgb(var(--accent-rgb)) ${healthScore * 3.6}deg, rgba(148, 163, 184, 0.28) 0deg)`,
              }}
            >
              <div className="flex h-[3.25rem] w-[3.25rem] flex-col items-center justify-center rounded-full bg-slate-800/95 leading-none">
                <span className="text-xl font-black text-white">{healthScore}</span>
                <span className="text-[10px] font-bold text-slate-300">/100</span>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-200">Điểm sức khỏe</p>
              <p className="mt-1 text-base font-black text-accent">{healthScoreLabel}</p>
            </div>
          </div>

          <div className="overview-hero-metric-card flex min-w-0 items-center justify-between gap-4 rounded-2xl border p-3 backdrop-blur-md">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-200">Chuỗi duy trì</p>
              <p className="mt-2 text-2xl font-black text-white">{formatWholeNumber(dailyStreak.count)} ngày</p>
              <div className="mt-3 flex gap-2" aria-hidden="true">
                {Array.from({ length: 7 }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 w-5 rounded-full ${index < Math.min(7, dailyStreak.count) ? 'bg-accent' : 'bg-slate-500/65'}`}
                  />
                ))}
              </div>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-text-inverse">
              <Flame className="h-5 w-5" />
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="overview-card overview-card--workout flex min-h-[390px] min-w-0 flex-col gap-5 rounded-xl border p-5 md:col-span-2 md:p-6 xl:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-accent">Bài tập</p>
              <h2 className="mt-3 text-2xl font-black leading-[1.1] text-text-primary">
                {hasWorkoutPlan ? workoutHeadline : 'Sẵn sàng cho buổi tập đầu tiên'}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">
                {hasWorkoutPlan ? workoutMetaLine : 'Tạo lịch tập cá nhân hóa để Fitly theo dõi từng buổi tập của bạn.'}
              </p>
            </div>
            <TodayIcon icon={<Dumbbell className="h-5 w-5" />} tone="workout" size="sm" />
          </div>

          {hasWorkoutPlan ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border-primary/80 bg-bg-tertiary/35 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Xong</p>
                  <p className="mt-1 text-lg font-black text-text-primary">{completedWorkoutCount}/{todayExercises.length}</p>
                </div>
                <div className="rounded-xl border border-border-primary/80 bg-bg-tertiary/35 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Thời lượng</p>
                  <p className="mt-1 text-lg font-black text-text-primary">{plannedWorkoutMinutes}'</p>
                </div>
                <div className="rounded-xl border border-border-primary/80 bg-bg-tertiary/35 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Còn lại</p>
                  <p className="mt-1 text-lg font-black text-text-primary">{remainingWorkoutCount}</p>
                </div>
              </div>

              <div className="flex flex-1 flex-col rounded-xl border border-border-primary/85 bg-bg-tertiary/30 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">Lịch hôm nay</p>
                  <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-black text-accent">{workoutCompletionPercent}%</span>
                </div>

                <ol className="mt-3 space-y-2">
                  {todayExercises.slice(0, 4).map((exercise, index) => (
                    <li key={`${exercise.name}-${index}`} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-bg-secondary/70">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                        exercise.is_completed ? 'bg-accent text-text-inverse' : 'bg-bg-secondary text-text-tertiary'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-text-primary">{exercise.name}</p>
                        <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{exercise.sets} hiệp x {exercise.reps}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate('/exercises/session', {
                      state: {
                        session: todayExercises.map((exercise) => ({
                          id: exercise.id,
                          exercise_id: exercise.exercise_id,
                          name: exercise.name,
                          video_url: exercise.video_url,
                          sets: exercise.sets,
                          reps: exercise.reps,
                          weight_kg: exercise.weight_kg,
                          rest_seconds: exercise.rest_seconds,
                          order_index: exercise.order_index,
                          is_completed: exercise.is_completed,
                          instructions: exercise.instructions
                        })),
                        selectedSessionId: featuredExercise?.id,
                        logDate: getVietnamDateKey()
                      }
                    })
                  }
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
                >
                  Bắt đầu tập
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/smart-planner')}
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
                >
                  Chỉnh kế hoạch
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-1 flex-col justify-center rounded-xl border border-dashed border-border-primary bg-bg-tertiary/35 px-5 py-8 text-center">
                <span className="mx-auto inline-flex">
                  <TodayIcon icon={<Sparkles className="h-5 w-5" />} tone="coach" size="sm" />
                </span>
                <p className="mx-auto mt-4 max-w-[22rem] text-sm font-semibold leading-6 text-text-secondary">
                  Trợ lý cá nhân có thể tạo lịch tập theo mục tiêu, lịch rảnh và thiết bị của bạn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/exercises')}
                className="mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
              >
                Xem bài tập
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </article>

        <article className="overview-card overview-card--meal flex min-h-[390px] min-w-0 flex-col gap-5 rounded-xl border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-info">Thực đơn</p>
              <h2 className="mt-3 text-2xl font-black leading-[1.1] text-text-primary">{formatWholeNumber(actualMealTotalKcal)} kcal</h2>
              <p className="mt-2 text-sm font-semibold text-text-secondary">
                {loggedMealsCount}/{todayMeals.length} bữa có dữ liệu · Kế hoạch {formatWholeNumber(plannedMealTotalKcal)} kcal
              </p>
            </div>
            <TodayIcon icon={<Utensils className="h-5 w-5" />} tone="nutrition" size="sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-info/20 bg-info/10 p-3">
              <div className="flex items-end justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-info">Calories</p>
                <p className="text-sm font-black text-info">{mealCaloriePercent}%</p>
              </div>
              <p className="mt-2 text-sm font-bold text-text-primary">{formatWholeNumber(actualMealTotalKcal)} / {formatWholeNumber(mealTarget)}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-info/15">
                <div className="h-full rounded-full bg-info" style={{ width: `${mealCaloriePercent}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-accent/20 bg-accent/10 p-3">
              <div className="flex items-end justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-accent">Protein</p>
                <p className="text-sm font-black text-accent">{mealProteinPercent}%</p>
              </div>
              <p className="mt-2 text-sm font-bold text-text-primary">{mealProtein} / {mealProteinTarget}g</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent/15">
                <div className="h-full rounded-full bg-accent" style={{ width: `${mealProteinPercent}%` }} />
              </div>
            </div>
          </div>

          {hasMealPlan ? (
            <div className="flex flex-1 flex-col gap-2">
              {todayMeals.slice(0, 4).map((meal, index) => (
                <div key={`${meal.type}-${index}`} className="flex items-center gap-3 rounded-xl border border-border-primary/80 bg-bg-tertiary/35 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-black text-text-tertiary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-text-primary">{meal.foods}</p>
                    <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{meal.label}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-bg-secondary px-2.5 py-1 text-[11px] font-black text-text-secondary">
                    {formatWholeNumber(meal.kcal)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-2">
              {todayMeals.map((meal, index) => (
                <div key={meal.type} className="flex items-center gap-3 rounded-xl border border-border-primary/80 bg-bg-tertiary/20 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary/60 text-xs font-black text-text-tertiary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-text-primary">Chưa lập thực đơn</p>
                    <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{meal.label}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-bg-secondary/60 px-2.5 py-1 text-[11px] font-black text-text-secondary">
                    0
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/diet-plan')}
            className="mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-info/40 hover:text-info"
          >
            Xem thực đơn
            <ChevronRight className="h-4 w-4" />
          </button>
        </article>

        <article className="overview-card overview-card--progress flex min-h-[390px] min-w-0 flex-col gap-5 rounded-xl border p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-warning">Tiến độ</p>
              <h2 className="mt-3 text-2xl font-black leading-[1.1] text-text-primary">
                {hasProgressData ? `${healthScore}/100` : 'Bắt đầu theo dõi'}
              </h2>
              <p className="mt-2 text-sm font-semibold text-text-secondary">
                {hasProgressData ? `Trạng thái hôm nay: ${healthScoreLabel}` : 'Ghi lại hoạt động đầu tiên của bạn hôm nay.'}
              </p>
            </div>
            <TodayIcon icon={<CheckCircle2 className="h-5 w-5" />} tone="score" size="sm" />
          </div>

          {hasProgressData ? (
            <>
              <div className="rounded-xl border border-border-primary/85 bg-bg-tertiary/30 p-4">
                <div
                  className="mx-auto flex h-28 w-28 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(rgb(var(--warning-rgb)) ${healthScore * 3.6}deg, rgba(148, 163, 184, 0.22) 0deg)`,
                  }}
                >
                  <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-bg-secondary">
                    <span className="text-2xl font-black text-text-primary">{healthScore}</span>
                    <span className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">điểm</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {progressRows.map((row) => (
                  <div key={row.label}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-text-primary">{row.label}</span>
                      <span className="text-xs font-bold text-text-secondary">{row.value}</span>
                    </div>
                    <div className="macro-progress h-2 overflow-hidden rounded-full bg-bg-tertiary">
                      <div
                        className={`macro-progress__fill h-full rounded-full ${row.color}`}
                        style={{ width: progressBarsActive ? `${row.width}%` : '0%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border-primary bg-bg-tertiary/25 px-5 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <p className="mt-4 text-base font-black text-text-primary">Chưa có dữ liệu tiến độ</p>
              <p className="mt-2 max-w-[19rem] text-sm font-semibold leading-6 text-text-secondary">
                Hoàn thành bài tập hoặc cập nhật nước, giấc ngủ để Fitly bắt đầu theo dõi hôm nay.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/progress')}
            className="mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-warning/40 hover:text-warning"
          >
            Xem tiến độ
            <ChevronRight className="h-4 w-4" />
          </button>
        </article>
      </section>
    </div>
  );
}

function OverviewSkeleton() {
  const block = (className: string) => <div className={`rounded-full bg-bg-tertiary/70 ${className}`} />;

  return (
    <div className="dashboard-page-shell min-w-0 animate-pulse pb-4 md:pb-6 lg:pb-7" aria-hidden="true">
      <div className="flex flex-col gap-4 md:gap-5">
        <section className="overflow-hidden rounded-xl border border-border-primary bg-bg-secondary/60 px-5 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.12)] md:px-6 md:py-5">
          <div className="min-w-0">
            {block('h-4 w-28')}
            {block('mt-3 h-7 w-[72%] max-w-[22rem] rounded-2xl')}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-10 w-[11rem] rounded-full border border-border-primary bg-bg-tertiary/40 md:w-[12.5rem]"
              />
            ))}
          </div>
        </section>

        <section className="flex min-h-32 items-center gap-4 rounded-xl border border-border-primary bg-bg-secondary/60 p-4 md:p-5">
          <div className="h-12 w-12 shrink-0 rounded-xl bg-bg-tertiary/60" />
          <div className="min-w-0 flex-1">
            {block('h-3 w-24')}
            {block('mt-3 h-6 w-36 rounded-xl')}
            {block('mt-3 h-3 w-[82%] rounded-lg')}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-xl border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:col-span-2 md:p-6 xl:col-span-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {block('h-3 w-28')}
                {block('mt-4 h-8 w-[88%] rounded-xl')}
                {block('mt-3 h-4 w-[72%]')}
              </div>
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-bg-tertiary/60" />
            </div>

            <div className="flex flex-1 flex-col rounded-xl border border-border-primary bg-bg-tertiary/25 p-4">
              <div className="flex items-center justify-between gap-3">
                {block('h-3 w-24')}
                <div className="h-6 w-14 rounded-full bg-bg-tertiary/55" />
              </div>

              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-lg border border-border-primary/80 bg-bg-tertiary/35 px-3 py-3"
                  >
                    <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary/90" />
                    <div className="min-w-0 flex-1">
                      {block('h-4 w-[78%] rounded-lg')}
                      {block('mt-2 h-3 w-24 rounded-lg')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-border-primary bg-bg-tertiary/30 px-4 py-3">
                {block('h-3 w-20')}
                {block('mt-2 h-3 w-full rounded-lg')}
                {block('mt-2 h-3 w-[90%] rounded-lg')}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="h-12 rounded-xl bg-bg-tertiary/70" />
              <div className="h-12 rounded-xl border border-border-primary bg-bg-tertiary/35" />
            </div>
          </article>

          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-xl border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {block('h-3 w-28')}
                {block('mt-4 h-5 w-[76%] rounded-xl')}
                {block('mt-3 h-5 w-[58%] rounded-xl')}
              </div>
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-bg-tertiary/60" />
            </div>

            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/35 px-3 py-3"
                >
                  <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary/90" />
                  <div className="min-w-0 flex-1">
                    {block('h-4 w-[72%] rounded-lg')}
                    {block('mt-2 h-3 w-20 rounded-lg')}
                  </div>
                  <div className="h-4 w-14 shrink-0 rounded-lg bg-bg-tertiary/60" />
                </div>
              ))}
            </div>

            <div className="mt-auto border-t border-border-primary/70 pt-4">
              <div className="h-11 rounded-xl border border-border-primary bg-bg-tertiary/40" />
            </div>
          </article>

          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-xl border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {block('h-3 w-28')}
              </div>
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-bg-tertiary/60" />
            </div>

            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    {block('h-4 w-16 rounded-lg')}
                    {block('h-4 w-20 rounded-lg')}
                  </div>
                  <div className="h-2 rounded-full bg-bg-tertiary/55">
                    <div
                      className="h-full rounded-full bg-bg-tertiary"
                      style={{ width: `${65 - index * 14}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto rounded-xl border border-border-primary bg-bg-tertiary/35 px-4 py-4">
              {block('h-3 w-full rounded-lg')}
              {block('mt-2 h-3 w-[88%] rounded-lg')}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
