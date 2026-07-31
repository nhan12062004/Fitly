import { supabase } from '@/lib/supabase';

type ExerciseRelation = { name?: string | null; body_part?: string | null; target_muscle?: string | null } | null;
type RecipeRelation = { name?: string | null; meal_type?: string | null; serving_unit?: string | null } | null;

export type WorkoutItem = {
  id: string;
  name: string;
  bodyPart: string | null;
  targetMuscle: string | null;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  restSeconds: number | null;
  totalSets: number;
  completedSets: number;
  isCompleted: boolean;
};

export type MealItem = {
  id: string;
  mealType: string | null;
  name: string;
  quantity: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  isRestDay: boolean;
};

export type ProfileSnapshot = {
  weight: number | null;
  fitnessGoal: string | null;
  weeklyWorkouts: number | null;
  targetCalories: number | null;
};

export type HomeSnapshot = {
  plannedExercises: number;
  completedExercises: number;
  caloriesConsumed: number;
  targetCalories: number | null;
};

const vietnamDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: value('year'), month: value('month'), day: value('day') };
};

export const getVietnamDateKey = () => {
  const { year, month, day } = vietnamDateParts();
  return `${year}-${month}-${day}`;
};

export const getVietnamDayIndex = () => {
  const dateKey = getVietnamDateKey();
  const sundayFirst = new Date(`${dateKey}T00:00:00`).getDay();
  return sundayFirst === 0 ? 6 : sundayFirst - 1;
};

export const getVietnamWeekStartKey = () => {
  const dateKey = getVietnamDateKey();
  const date = new Date(`${dateKey}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const requireUserId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  return user.id;
};

export const toWorkoutItem = (row: any): WorkoutItem => {
  const exercise = (Array.isArray(row.exercises) ? row.exercises[0] : row.exercises) as ExerciseRelation;
  const totalSets = Math.max(1, Number(row.actual_sets ?? row.sets) || 1);
  return {
    id: String(row.id),
    name: exercise?.name ?? 'Bài tập chưa có tên',
    bodyPart: exercise?.body_part ?? null,
    targetMuscle: exercise?.target_muscle ?? null,
    sets: row.sets ?? null,
    reps: row.reps ?? null,
    weightKg: row.weight_kg ?? null,
    restSeconds: row.rest_seconds ?? null,
    totalSets,
    completedSets: Math.min(totalSets, Math.max(0, Number(row.completed_sets) || 0)),
    isCompleted: Boolean(row.is_completed),
  };
};

export const loadTodayWorkout = async (): Promise<WorkoutItem[]> => {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('daily_exercise_sessions')
    .select('id, sets, actual_sets, reps, weight_kg, rest_seconds, completed_sets, is_completed, order_index, exercises:exercise_id(name, body_part, target_muscle)')
    .eq('user_id', userId)
    .eq('log_date', getVietnamDateKey())
    .order('order_index', { ascending: true });
  if (error) throw error;

  return (data ?? []).map(toWorkoutItem);
};

export const loadTodayMeals = async (): Promise<MealItem[]> => {
  const userId = await requireUserId();
  const { data: plan, error: planError } = await supabase
    .from('weekly_food_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', getVietnamWeekStartKey())
    .eq('plan_status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw planError;
  if (!plan) return [];

  const { data, error } = await supabase
    .from('weekly_food_items')
    .select('id, meal_type, quantity, calories, protein, carbs, fat, is_rest_day, order_index, recipes:recipe_id(name, meal_type, serving_unit)')
    .eq('food_plan_id', plan.id)
    .eq('day_of_week', getVietnamDayIndex())
    .order('order_index', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const recipe = (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes) as RecipeRelation;
    return {
      id: String(row.id),
      mealType: row.meal_type ?? recipe?.meal_type ?? null,
      name: recipe?.name ?? 'Món ăn chưa có tên',
      quantity: row.quantity ?? null,
      calories: row.calories ?? null,
      protein: row.protein ?? null,
      carbs: row.carbs ?? null,
      fat: row.fat ?? null,
      isRestDay: Boolean(row.is_rest_day),
    };
  });
};

export const loadProfileSnapshot = async (): Promise<ProfileSnapshot> => {
  const userId = await requireUserId();
  const [metricResult, lifestyleResult] = await Promise.all([
    supabase.from('body_metrics').select('weight').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('lifestyle_settings').select('fitness_goal, weekly_workouts, target_calories').eq('user_id', userId).maybeSingle(),
  ]);
  if (metricResult.error) throw metricResult.error;
  if (lifestyleResult.error) throw lifestyleResult.error;

  return {
    weight: metricResult.data?.weight ?? null,
    fitnessGoal: lifestyleResult.data?.fitness_goal ?? null,
    weeklyWorkouts: lifestyleResult.data?.weekly_workouts ?? null,
    targetCalories: lifestyleResult.data?.target_calories ?? null,
  };
};

export const loadHomeSnapshot = async (): Promise<HomeSnapshot> => {
  const userId = await requireUserId();
  const today = getVietnamDateKey();
  const [sessionsResult, progressResult, lifestyleResult] = await Promise.all([
    supabase.from('daily_exercise_sessions').select('is_completed').eq('user_id', userId).eq('log_date', today),
    supabase.from('daily_progress_logs').select('calories_consumed').eq('user_id', userId).eq('log_date', today).maybeSingle(),
    supabase.from('lifestyle_settings').select('target_calories').eq('user_id', userId).maybeSingle(),
  ]);
  if (sessionsResult.error) throw sessionsResult.error;
  if (progressResult.error) throw progressResult.error;
  if (lifestyleResult.error) throw lifestyleResult.error;

  const sessions = sessionsResult.data ?? [];
  return {
    plannedExercises: sessions.length,
    completedExercises: sessions.filter((item) => Boolean(item.is_completed)).length,
    caloriesConsumed: Number(progressResult.data?.calories_consumed ?? 0),
    targetCalories: lifestyleResult.data?.target_calories ?? null,
  };
};
