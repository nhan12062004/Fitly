import { supabase } from '@/lib/supabase';

type ExerciseRelation = {
  name?: string | null;
  body_part?: string | null;
  target_muscle?: string | null;
  equipment?: string | null;
  difficulty?: string | null;
  movement_pattern?: string | null;
  video_url?: string | null;
  instructions?: unknown;
  estimated_duration_seconds?: number | null;
} | null;
type RecipeRelation = { id?: string | null; name?: string | null; meal_type?: string | null; serving_unit?: string | null } | null;

export type WorkoutItem = {
  id: string;
  exerciseId: string | null;
  name: string;
  bodyPart: string | null;
  targetMuscle: string | null;
  equipment: string | null;
  difficulty: string | null;
  movementPattern: string | null;
  videoUrl: string | null;
  instructions: unknown | null;
  estimatedDurationSeconds: number | null;
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
  recipeId: string | null;
  mealType: string | null;
  name: string;
  quantity: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  isRestDay: boolean;
};

export type GeneratedMealPlanItem = {
  day_of_week?: number | null;
  meal_type?: string | null;
  recipe_id?: string | null;
  quantity?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  order_index?: number | null;
  is_rest_day?: boolean | null;
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

const BODY_PART_LABELS: Record<string, string> = {
  chest: 'Ngực',
  back: 'Lưng',
  shoulders: 'Vai',
  biceps: 'Tay trước',
  triceps: 'Tay sau',
  quadriceps: 'Đùi trước',
  hamstrings: 'Đùi sau',
  glutes: 'Mông',
  calves: 'Bắp chân',
  core: 'Cơ bụng',
  full_body: 'Toàn thân',
  mobility: 'Linh hoạt',
};

const TARGET_MUSCLE_LABELS: Record<string, string> = {
  pectoralis_major: 'Cơ ngực lớn',
  latissimus_dorsi: 'Cơ xô',
  trapezius: 'Cơ thang',
  anterior_deltoid: 'Vai trước',
  lateral_deltoid: 'Vai giữa',
  posterior_deltoid: 'Vai sau',
  biceps: 'Cơ tay trước',
  triceps: 'Cơ tay sau',
  forearms: 'Cẳng tay',
  rectus_abdominis: 'Cơ bụng thẳng',
  obliques: 'Cơ liên sườn',
  erector_spinae: 'Cơ dựng sống',
  quadriceps: 'Cơ đùi trước',
  hamstrings: 'Cơ đùi sau',
  gluteus_maximus: 'Cơ mông lớn',
  gluteus_medius: 'Cơ mông giữa',
  calves: 'Bắp chân',
  gastrocnemius: 'Cơ bụng chân',
  soleus: 'Cơ dép',
  hip_adductors: 'Cơ khép hông',
  hip_abductors: 'Cơ dạng hông',
  hip_flexors: 'Cơ gập hông',
};

const DETAIL_LABELS: Record<string, string> = {
  none: 'Không cần dụng cụ',
  bodyweight: 'Không cần dụng cụ',
  body_weight: 'Không cần dụng cụ',
  dumbbell: 'Tạ đơn',
  dumbbells: 'Tạ đơn',
  barbell: 'Tạ đòn',
  kettlebell: 'Tạ ấm',
  resistance_band: 'Dây kháng lực',
  resistance_bands: 'Dây kháng lực',
  cable_machine: 'Máy cáp',
  machine: 'Máy tập',
  easy: 'Cơ bản',
  medium: 'Trung bình',
  hard: 'Nâng cao',
  push: 'Đẩy',
  pull: 'Kéo',
  squat: 'Squat',
  hinge: 'Gập hông',
  lunge: 'Chùng chân',
  carry: 'Mang vác',
  rotation: 'Xoay thân',
  locomotion: 'Di chuyển',
  mobility: 'Linh hoạt',
};

const normalizeCatalogKey = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Turns exercise-catalog keys into the Vietnamese labels shown to members. */
export const formatWorkoutExerciseMeta = (bodyPart: string | null, targetMuscle: string | null) => {
  const labelFor = (value: string, labels: Record<string, string>) => labels[normalizeCatalogKey(value)] ?? value;
  return [
    bodyPart ? labelFor(bodyPart, BODY_PART_LABELS) : null,
    targetMuscle ? labelFor(targetMuscle, TARGET_MUSCLE_LABELS) : null,
  ].filter((value): value is string => Boolean(value)).join(' · ') || 'Bài tập hôm nay';
};

export const formatWorkoutDetailLabel = (value: string | null, fallback: string) => {
  if (!value) return fallback;
  return DETAIL_LABELS[normalizeCatalogKey(value)] ?? value.replace(/[_-]+/g, ' ');
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
    exerciseId: row.exercise_id ? String(row.exercise_id) : null,
    name: exercise?.name ?? 'Bài tập chưa có tên',
    bodyPart: exercise?.body_part ?? null,
    targetMuscle: exercise?.target_muscle ?? null,
    equipment: exercise?.equipment ?? null,
    difficulty: exercise?.difficulty ?? null,
    movementPattern: exercise?.movement_pattern ?? null,
    videoUrl: exercise?.video_url ?? null,
    instructions: exercise?.instructions ?? null,
    estimatedDurationSeconds: exercise?.estimated_duration_seconds ?? null,
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
    .select('id, exercise_id, sets, actual_sets, reps, weight_kg, rest_seconds, completed_sets, is_completed, order_index, exercises:exercise_id(name, body_part, target_muscle, equipment, difficulty, movement_pattern, video_url, instructions, estimated_duration_seconds)')
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
    .select('id, meal_type, quantity, calories, protein, carbs, fat, is_rest_day, order_index, recipes:recipe_id(id, name, meal_type, serving_unit)')
    .eq('food_plan_id', plan.id)
    .eq('day_of_week', getVietnamDayIndex())
    .order('order_index', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const recipe = (Array.isArray(row.recipes) ? row.recipes[0] : row.recipes) as RecipeRelation;
    return {
      id: String(row.id),
      recipeId: recipe?.id ? String(recipe.id) : null,
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

export const saveGeneratedMealPlan = async ({
  weekStartKey,
  scope,
  targetDayIndex,
  items,
}: {
  weekStartKey: string;
  scope: 'day' | 'week';
  targetDayIndex: number;
  items: GeneratedMealPlanItem[];
}) => {
  const userId = await requireUserId();
  const safeTargetDayIndex = Math.max(0, Math.min(6, Math.round(targetDayIndex)));
  const generatedItems = items.filter((item) => {
    const dayIndex = Number(item.day_of_week);
    return Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex <= 6 && (scope === 'week' || dayIndex === safeTargetDayIndex);
  });
  if (generatedItems.length === 0) throw new Error('AI chưa trả về món phù hợp để lưu.');

  const { data: currentPlan, error: currentPlanError } = await supabase
    .from('weekly_food_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .eq('plan_status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentPlanError) throw currentPlanError;

  let preservedItems: GeneratedMealPlanItem[] = [];
  if (scope === 'day' && currentPlan?.id) {
    const { data, error } = await supabase
      .from('weekly_food_items')
      .select('day_of_week, meal_type, recipe_id, quantity, calories, protein, carbs, fat, order_index, is_rest_day')
      .eq('food_plan_id', currentPlan.id)
      .neq('day_of_week', safeTargetDayIndex);
    if (error) throw error;
    preservedItems = data ?? [];
  }

  const { data: newPlan, error: createPlanError } = await supabase
    .from('weekly_food_plans')
    .insert({
      user_id: userId,
      name: scope === 'week' ? 'Thực đơn AI 7 ngày' : 'Thực đơn AI hôm nay',
      week_start_date: weekStartKey,
      plan_status: 'draft',
      generated_by: 'ai',
    })
    .select('id')
    .single();
  if (createPlanError) throw createPlanError;

  const rows = [...preservedItems, ...generatedItems].map((item, index) => ({
    food_plan_id: newPlan.id,
    day_of_week: Math.max(0, Math.min(6, Number(item.day_of_week) || 0)),
    meal_type: String(item.meal_type || 'lunch'),
    recipe_id: item.recipe_id ? String(item.recipe_id) : null,
    quantity: Math.max(0.25, Number(item.quantity) || 1),
    calories: Math.max(0, Number(item.calories) || 0),
    protein: Math.max(0, Number(item.protein) || 0),
    carbs: Math.max(0, Number(item.carbs) || 0),
    fat: Math.max(0, Number(item.fat) || 0),
    order_index: Number.isFinite(Number(item.order_index)) ? Number(item.order_index) : index,
    is_rest_day: Boolean(item.is_rest_day),
  }));
  const insertItems = await supabase.from('weekly_food_items').insert(rows);
  if (insertItems.error) throw insertItems.error;

  const activatedAt = new Date().toISOString();
  const activatePlan = await supabase
    .from('weekly_food_plans')
    .update({ plan_status: 'active', updated_at: activatedAt })
    .eq('id', newPlan.id)
    .eq('plan_status', 'draft');
  if (activatePlan.error) throw activatePlan.error;

  const retireOldPlans = await supabase
    .from('weekly_food_plans')
    .update({ plan_status: 'adjusted', updated_at: activatedAt })
    .eq('user_id', userId)
    .eq('week_start_date', weekStartKey)
    .eq('plan_status', 'active')
    .neq('id', newPlan.id);
  if (retireOldPlans.error) throw retireOldPlans.error;

  return newPlan.id as string;
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
