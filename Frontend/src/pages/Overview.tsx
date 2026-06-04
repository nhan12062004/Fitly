import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, ChevronRight, Droplet, Dumbbell, Sparkles, Utensils } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';
import { useNavigate } from 'react-router-dom';

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

const getVietnamWeekRange = (date = new Date()) => {
  const todayKey = getVietnamDateKey(date);
  const todayDate = new Date(`${todayKey}T00:00:00`);
  const day = todayDate.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(todayDate);
  weekStart.setDate(todayDate.getDate() + diffToMonday);
  return {
    weekStartKey: getVietnamDateKey(weekStart)
  };
};

const initialStats = {
  workout_duration: 0,
  calories_burned: 0,
  remaining_workouts: 0,
  streak_days: 1
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

const ESTIMATED_MINUTES_PER_EXERCISE = 8;

const formatWholeNumber = (value: number) => Math.round(Number(value) || 0).toLocaleString('vi-VN');

const formatProgressNumber = (value: number) => {
  const nextValue = Number(value) || 0;
  return Number.isInteger(nextValue) ? String(nextValue) : nextValue.toFixed(1);
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
  img: string;
  body_part: string;
  target_muscle: string;
  difficulty: string;
  instructions: string[] | string;
  sets: number;
  reps: string;
  weight_kg: number;
  rest_seconds: number;
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
  stats: typeof initialStats;
  todayExercises: OverviewExercise[];
  todayMealItems: OverviewMealItem[];
  todayMeals: OverviewMeal[];
  dailyNutrition: typeof initialDailyNutrition;
  dailyProgress: typeof initialDailyProgress;
  mealsPerDay: number;
} | null = null;

export default function Overview() {
  const navigate = useNavigate();
  const { user, isLoggedIn, profile, refreshTick } = useAuth();
  const [loading, setLoading] = useState(() => !overviewCache);
  const [stats, setStats] = useState(() => overviewCache?.stats || initialStats);
  const [todayExercises, setTodayExercises] = useState<OverviewExercise[]>(() => overviewCache?.todayExercises || []);
  const [todayMealItems, setTodayMealItems] = useState<OverviewMealItem[]>(() => overviewCache?.todayMealItems || []);
  const [mealsPerDay, setMealsPerDay] = useState(() => overviewCache?.mealsPerDay || 3);
  const [todayMeals, setTodayMeals] = useState<OverviewMeal[]>(() => overviewCache?.todayMeals || createDefaultMeals(overviewCache?.mealsPerDay || 3));
  const [dailyNutrition, setDailyNutrition] = useState(() => overviewCache?.dailyNutrition || initialDailyNutrition);
  const [dailyProgress, setDailyProgress] = useState(() => overviewCache?.dailyProgress || initialDailyProgress);
  const [progressBarsActive, setProgressBarsActive] = useState(false);
  const refreshTickRef = useRef(refreshTick);
  const prevRefreshTickRef = useRef(refreshTick);
  const skipRefreshTickRef = useRef<number | null>(null);

  const parseReps = (reps: string | null | undefined): number => {
    if (!reps) return 10;
    const nums = String(reps).match(/\d+/g)?.map(Number).filter((n) => !Number.isNaN(n)) || [];
    if (nums.length === 0) return 10;
    if (nums.length === 1) return nums[0];
    return Math.round((nums[0] + nums[nums.length - 1]) / 2);
  };

  const estimateExerciseKcal = (
    item: { sets?: number | null; reps?: string | null; weight_kg?: number | null; rest_seconds?: number | null },
    userWeightKg: number
  ): number => {
    const sets = Math.max(1, Number(item.sets || 0));
    const reps = Math.max(1, parseReps(item.reps));
    const rest = Math.max(0, Number(item.rest_seconds || 0));
    const weightKg = Math.max(0, Number(item.weight_kg || 0));
    const workSeconds = sets * reps * 2.8;
    const restSeconds = Math.max(0, sets - 1) * rest;
    const durationMinutes = Math.max(1, (workSeconds + restSeconds) / 60);
    const met = weightKg > 0 ? 6.0 : 5.0;
    const kcal = (met * 3.5 * Math.max(45, userWeightKg) / 200) * durationMinutes;
    return Math.round(Math.min(250, Math.max(8, kcal)));
  };

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
    const handleWaterUpdated = (event: Event) => {
      const waterIntake = Number((event as CustomEvent<{ waterIntake?: number }>).detail?.waterIntake);
      if (!Number.isFinite(waterIntake)) return;
      skipRefreshTickRef.current = refreshTickRef.current + 1;

      setDailyProgress((prev) => {
        const next = { ...prev, waterIntake };
        if (overviewCache) {
          overviewCache = {
            ...overviewCache,
            dailyProgress: next
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
      setLoading(!overviewCache);
      try {
        const today = new Date();
        const todayStr = getVietnamDateKey(today);
        const { weekStartKey } = getVietnamWeekRange(today);
        const [
          lifestyleRes,
          progressLogRes,
          latestBodyRes,
          todaySessionsRes,
          dailyMealLogsRes,
          healthRes,
          plansRes
        ] = await Promise.all([
          supabase.from('lifestyle_settings').select('workout_duration, daily_water_goal, target_calories, meals_per_day').eq('user_id', user.id).maybeSingle(),
          supabase.from('daily_progress_logs').select('water_intake_ml, sleep_hours').eq('user_id', user.id).eq('log_date', todayStr).maybeSingle(),
          supabase.from('body_metrics').select('weight').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('daily_exercise_sessions').select('id, exercise_id, order_index, sets, reps, weight_kg, rest_seconds, is_completed, exercises:exercise_id(name, gif_url, image_url, instructions, target_muscle, body_part, difficulty)').eq('user_id', user.id).eq('log_date', todayStr).order('order_index', { ascending: true }),
          supabase.from('daily_meal_logs').select('calories, protein, carbs, fat, quantity, is_completed').eq('user_id', user.id).eq('log_date', todayStr).eq('is_completed', true),
          supabase.from('health_conditions').select('sleep_hours').eq('user_id', user.id).maybeSingle(),
          supabase.from('weekly_food_plans').select('id').eq('user_id', user.id).eq('week_start_date', weekStartKey).order('updated_at', { ascending: false }).limit(1)
        ]);

        const userWeight = Number(latestBodyRes.data?.weight || 70);
        const todaySessions = todaySessionsRes.data || [];
        const completedSessions = todaySessions.filter((session: any) => !!session.is_completed);
        const estimatedCaloriesFromSessions = completedSessions.reduce(
          (sum: number, item: any) => sum + estimateExerciseKcal(item, userWeight),
          0
        );
        const remainingWorkoutCount = Math.max(0, todaySessions.length - completedSessions.length);

        const nextStats = {
          workout_duration: Math.round(completedSessions.length * ESTIMATED_MINUTES_PER_EXERCISE),
          calories_burned: estimatedCaloriesFromSessions,
          remaining_workouts: remainingWorkoutCount,
          streak_days: stats.streak_days
        };
        setStats(nextStats);

        const nextTodayExercises = todaySessions.map((session: any) => ({
          id: String(session.id || ''),
          exercise_id: String(session.exercise_id || ''),
          order_index: Number(session.order_index || 0),
          name: (session.exercises as any)?.name || 'B?i t?p',
          img: normalizeExerciseMediaUrl((session.exercises as any)?.image_url || (session.exercises as any)?.gif_url || ''),
          body_part: String((session.exercises as any)?.body_part || ''),
          target_muscle: String((session.exercises as any)?.target_muscle || ''),
          difficulty: String((session.exercises as any)?.difficulty || ''),
          instructions: (session.exercises as any)?.instructions || [],
          sets: session.sets || 0,
          reps: session.reps || '-',
          weight_kg: session.weight_kg || 0,
          rest_seconds: session.rest_seconds || 0,
          is_completed: !!session.is_completed,
          kcal: estimateExerciseKcal(session, userWeight)
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
          workoutMinutes: Math.round(completedSessions.length * ESTIMATED_MINUTES_PER_EXERCISE),
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
          const dayOfWeek = new Date(`${todayStr}T00:00:00`).getDay();
          const todayDayOfWeek = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
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
          stats: nextStats,
          todayExercises: nextTodayExercises,
          todayMealItems: mealItemsList,
          todayMeals: mealsList,
          dailyNutrition: nextDailyNutrition,
          dailyProgress: nextDailyProgressWithMeals,
          mealsPerDay: resolvedMealsPerDay
        };
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }

    if (isLoggedIn) {
      fetchData();
    } else {
      overviewCache = null;
      setLoading(false);
      setStats(initialStats);
      setTodayExercises([]);
      setTodayMealItems([]);
      setMealsPerDay(3);
      setTodayMeals(createDefaultMeals(3));
      setDailyNutrition(initialDailyNutrition);
      setDailyProgress(initialDailyProgress);
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

  const plannedWorkoutMinutes = todayExercises.length > 0
    ? todayExercises.length * ESTIMATED_MINUTES_PER_EXERCISE
    : (dailyProgress.workoutTarget || 20);

  const featuredExercise = todayExercises[0];
  const hasWorkoutPlan = todayExercises.length > 0;
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
      width: hasWorkoutPlan ? Math.min(100, Math.round((completedWorkoutCount / Math.max(1, todayExercises.length)) * 100)) : 0,
      color: 'bg-accent'
    }
  ];
  const waterCompleted = dailyProgress.waterIntake >= Math.max(0.1, dailyProgress.waterGoal);
  const sleepCompleted = dailyProgress.sleepActual >= Math.max(1, dailyProgress.sleepTarget);
  const pendingPriorityCount = [!waterCompleted, !sleepCompleted, !workoutCompleted].filter(Boolean).length;
  const heroTaskSummary = pendingPriorityCount === 0
    ? 'Hôm nay bạn đã hoàn thành các việc chính'
    : `Hôm nay bạn có ${pendingPriorityCount} việc chính cần hoàn thành`;
  const workoutHeroLabel = hasWorkoutPlan
    ? (workoutCompleted ? 'Đã xong buổi tập hôm nay' : `${plannedWorkoutMinutes} phút tập cần hoàn thành`)
    : 'Chưa có buổi tập hôm nay';
  const mealHeroLabel = `${todayMeals.length} bữa ăn · ${mealProtein}g protein`;
  const streakHeroLabel = `Streak ${formatWholeNumber(stats.streak_days)} ngày`;

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <section className="overflow-hidden rounded-[28px] border border-border-primary bg-[linear-gradient(180deg,rgba(20,20,20,0.96),rgba(12,12,12,0.98))] px-5 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.18)] md:px-6 md:py-5">
        <div className="min-w-0">
          <p className="text-sm font-black text-text-primary md:text-base">
            {greetingLabel}, {userName} <span aria-hidden>👋</span>
          </p>
          <p className="mt-1 text-sm font-semibold text-text-secondary md:text-[15px]">
            {heroTaskSummary}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold md:text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent/10 px-3 py-2 text-accent">
            <Dumbbell className="h-3.5 w-3.5" />
            {workoutHeroLabel}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-info/15 bg-info/10 px-3 py-2 text-info">
            <Utensils className="h-3.5 w-3.5" />
            {mealHeroLabel}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-warning/15 bg-warning/10 px-3 py-2 text-warning">
            <Sparkles className="h-3.5 w-3.5" />
            {streakHeroLabel}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:col-span-2 md:p-6 xl:col-span-1">
          {hasWorkoutPlan ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">1. Bài tập hôm nay</p>
                  <h2 className="mt-4 text-[1.65rem] font-black leading-[1.1] text-text-primary">
                    {workoutHeadline}
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-text-secondary">{workoutMetaLine}</p>
                </div>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <Dumbbell className="h-5 w-5" />
                </span>
              </div>

              <div className="flex flex-1 flex-col rounded-[24px] border border-border-primary bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">Danh sách bài</p>
                  <span className="rounded-full border border-white/8 bg-white/5 px-2.5 py-1 text-[11px] font-black text-text-secondary">
                    {todayExercises.length} bài
                  </span>
                </div>

                <ol className="mt-4 space-y-2.5">
                  {todayExercises.slice(0, 3).map((exercise, index) => (
                    <li key={`${exercise.name}-${index}`} className="flex items-start gap-3 rounded-2xl border border-border-primary/80 bg-bg-tertiary/35 px-3 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-black text-text-secondary">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black leading-6 text-text-primary">{exercise.name}</p>
                        <p className="mt-0.5 text-xs font-semibold text-text-secondary">{exercise.sets} hiệp × {exercise.reps}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 rounded-2xl border border-accent/15 bg-accent/8 px-4 py-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-accent">Gợi ý nhanh</p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                    {workoutCompleted
                      ? 'Buổi tập hôm nay đã xong. Bạn có thể mở lại để xem chi tiết từng bài hoặc đổi một buổi nhẹ hơn cho ngày mai.'
                      : 'Bắt đầu buổi tập để mở đầy đủ bài, set, reps và đánh dấu hoàn thành ngay trong phiên tập.'}
                  </p>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate('/exercises/session', {
                      state: {
                        session: todayExercises.map((exercise) => ({
                          id: exercise.id,
                          exercise_id: exercise.exercise_id,
                          name: exercise.name,
                          gif_url: exercise.img,
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
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-black text-black transition-colors hover:bg-accent-hover"
                >
                  Bắt đầu buổi tập
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/smart-planner')}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-border-primary bg-bg-tertiary/45 px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
                >
                  Đổi buổi nhẹ hơn
                </button>
              </div>
            </>
          ) : (
            <div className="mt-6 flex flex-1 flex-col justify-center rounded-2xl border border-dashed border-border-primary bg-bg-tertiary/35 px-5 py-8 text-center">
              <Sparkles className="mx-auto h-9 w-9 text-ai" />
              <p className="mx-auto mt-4 w-full max-w-[18rem] min-w-0 break-words text-sm font-semibold leading-6 text-text-secondary sm:max-w-[26rem]">
                Trợ lý cá nhân có thể tạo lịch tập và thực đơn dựa trên mục tiêu của bạn.
              </p>
              <button
                type="button"
                onClick={() => navigate('/smart-planner')}
                className="mx-auto mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-black text-black transition-colors hover:bg-accent-hover"
              >
                Tạo kế hoạch với Trợ lý cá nhân
              </button>
            </div>
          )}
        </article>

        <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">2. Thực đơn hôm nay</p>
              <p className="mt-4 text-base font-black text-text-primary">Đã ăn: {formatWholeNumber(actualMealTotalKcal)} / {formatWholeNumber(mealTarget)} kcal</p>
              <p className="mt-2 text-base font-black text-text-primary">Protein: {mealProtein} / {mealProteinTarget}g</p>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-info/10 text-info">
              <Utensils className="h-5 w-5" />
            </span>
          </div>

          <div className="space-y-3">
            {todayMeals.slice(0, 4).map((meal, index) => (
              <div key={`${meal.type}-${index}`} className="flex items-center gap-3 rounded-xl border border-border-primary bg-bg-tertiary/45 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-secondary text-xs font-black text-text-tertiary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-text-primary">{meal.foods}</p>
                  <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{meal.label}</p>
                </div>
                <span className="shrink-0 text-right text-sm font-black text-text-secondary">{formatWholeNumber(meal.kcal)} kcal</span>
              </div>
            ))}
          </div>

          <div className="mt-auto border-t border-border-primary/70 pt-4">
            <button
              type="button"
              onClick={() => navigate('/diet-plan')}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border-primary bg-bg-tertiary px-5 text-sm font-black text-text-primary transition-colors hover:border-info/40 hover:text-info"
            >
              Xem thực đơn
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </article>

        <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/80 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.14)] backdrop-blur-xl md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-text-tertiary">3. Tiến độ hôm nay</p>
            </div>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ai/10 text-ai">
              <CheckCircle2 className="h-5 w-5" />
            </span>
          </div>

          <div className="space-y-5">
            {progressRows.map((row) => (
              <div key={row.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-text-primary">{row.label}</span>
                  <span className="text-sm font-bold text-text-secondary">{row.value}</span>
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

          <div className="mt-auto rounded-2xl border border-border-primary bg-bg-tertiary/45 px-4 py-4">
            <div className="flex items-center gap-3">
              <Droplet className="h-5 w-5 text-info" />
              <p className="text-sm font-semibold leading-6 text-text-secondary">
                Cập nhật nước, giấc ngủ và hoàn thành tập luyện để Trợ lý cá nhân đánh giá tiến độ chính xác hơn.
              </p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function OverviewSkeleton() {
  const block = (className: string) => <div className={`rounded-full bg-bg-tertiary/70 ${className}`} />;

  return (
    <div className="min-w-0 flex-1 animate-pulse" aria-hidden="true">
      <div className="flex flex-col gap-4 md:gap-5">
        <section className="overflow-hidden rounded-[28px] border border-border-primary bg-bg-secondary/60 px-5 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.12)] md:px-6 md:py-5">
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

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:col-span-2 md:p-6 xl:col-span-1">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {block('h-3 w-28')}
                {block('mt-4 h-8 w-[88%] rounded-[18px]')}
                {block('mt-3 h-4 w-[72%]')}
              </div>
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-bg-tertiary/60" />
            </div>

            <div className="flex flex-1 flex-col rounded-[24px] border border-border-primary bg-bg-tertiary/25 p-4">
              <div className="flex items-center justify-between gap-3">
                {block('h-3 w-24')}
                <div className="h-6 w-14 rounded-full bg-bg-tertiary/55" />
              </div>

              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 rounded-2xl border border-border-primary/80 bg-bg-tertiary/35 px-3 py-3"
                  >
                    <div className="h-8 w-8 shrink-0 rounded-full bg-bg-secondary/90" />
                    <div className="min-w-0 flex-1">
                      {block('h-4 w-[78%] rounded-lg')}
                      {block('mt-2 h-3 w-24 rounded-lg')}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-border-primary bg-bg-tertiary/30 px-4 py-3">
                {block('h-3 w-20')}
                {block('mt-2 h-3 w-full rounded-lg')}
                {block('mt-2 h-3 w-[90%] rounded-lg')}
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="h-12 rounded-2xl bg-bg-tertiary/70" />
              <div className="h-12 rounded-2xl border border-border-primary bg-bg-tertiary/35" />
            </div>
          </article>

          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:p-6">
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
              <div className="h-11 rounded-2xl border border-border-primary bg-bg-tertiary/40" />
            </div>
          </article>

          <article className="flex min-h-[360px] min-w-0 flex-col gap-5 rounded-[28px] border border-border-primary bg-bg-secondary/60 p-5 shadow-[0_22px_60px_rgba(0,0,0,0.1)] md:p-6">
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

            <div className="mt-auto rounded-2xl border border-border-primary bg-bg-tertiary/35 px-4 py-4">
              {block('h-3 w-full rounded-lg')}
              {block('mt-2 h-3 w-[88%] rounded-lg')}
            </div>
          </article>
        </section>
      </div>
    </div>
  );
}
