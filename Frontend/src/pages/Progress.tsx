import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BedDouble,
  BrainCircuit,
  CalendarDays,
  CircleGauge,
  Droplets,
  Dumbbell,
  Flame,
  Medal,
  Minus,
  Ruler,
  Scale,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const BODY_HISTORY_LIMIT = 120;

type ExerciseMeta = {
  name?: string | null;
  target_muscle?: string | null;
  body_part?: string | null;
};

type WorkoutRow = {
  exercise_id: string;
  log_date: string;
  is_completed: boolean | null;
  sets: number | null;
  actual_sets: number | null;
  completed_sets: number | null;
  weight_kg: number | null;
  actual_weight_kg: number | null;
  estimated_kcal: number | null;
  actual_kcal_estimated: number | null;
  exercises?: ExerciseMeta | ExerciseMeta[] | null;
};

type DailyProgressRow = {
  log_date: string;
  water_intake_ml: number | null;
  sleep_hours: number | null;
  calories_burned: number | null;
};

type MealRow = {
  log_date: string;
  calories: number | null;
  quantity: number | null;
  is_completed: boolean | null;
};

type BodyMetricRow = {
  weight: number | null;
  target_weight: number | null;
  body_fat: number | null;
  body_fat_percentage: number | null;
  waist: number | null;
  created_at: string;
};

type BodyTrend = {
  first: number | null;
  latest: number | null;
  change: number | null;
  samples: number;
};

type TrainingPeriod = {
  activeDays: number;
  completedExercises: number;
  completedSets: number;
  plannedExercises: number;
  completionRate: number;
  caloriesBurned: number;
};

type ActivityDay = {
  dateKey: string;
  label: string;
  dayNumber: string;
  workoutPercent: number;
  completedWorkoutCount: number;
  caloriesBurned: number;
  caloriesConsumed: number;
  mealLogged: boolean;
  waterMl: number;
  sleepHours: number;
};

type ExerciseProgress = {
  id: string;
  name: string;
  muscle: string;
  currentBest: number | null;
  previousBest: number | null;
  currentSets: number;
  previousSets: number;
};

type ProgressData = {
  currentRangeLabel: string;
  previousRangeLabel: string;
  hasActivityData: boolean;
  body: {
    weight: BodyTrend;
    bodyFat: BodyTrend;
    waist: BodyTrend;
    targetWeight: number | null;
    goalProgress: number | null;
  };
  wellness: {
    score: number | null;
    previousScore: number | null;
    streak: number;
    previousStreak: number;
    waterGoalMl: number | null;
    sleepGoal: number | null;
  };
  training: {
    current: TrainingPeriod;
    previous: TrainingPeriod;
    days: ActivityDay[];
    muscleGroups: Array<{ label: string; count: number }>;
    exercises: ExerciseProgress[];
  };
};

const progressCache = new Map<string, ProgressData>();

function getVietnamDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

function addDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function buildDateKeys(endDateKey: string, totalDays: number): string[] {
  return Array.from({ length: totalDays }, (_, index) => addDays(endDateKey, index - totalDays + 1));
}

function getShortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

function getWeekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function formatRange(dateKeys: string[]): string {
  return `${getShortDate(dateKeys[0])} – ${getShortDate(dateKeys.at(-1)!)}`;
}

function toPositiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('vi-VN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeExerciseMeta(value: WorkoutRow['exercises']): ExerciseMeta | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function translateMuscleLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    chest: 'Ngực',
    back: 'Lưng',
    legs: 'Chân',
    leg: 'Chân',
    shoulders: 'Vai',
    shoulder: 'Vai',
    arms: 'Tay',
    arm: 'Tay',
    biceps: 'Tay trước',
    triceps: 'Tay sau',
    abs: 'Bụng',
    core: 'Core',
    glutes: 'Mông',
  };
  return labels[normalized] || value || 'Chưa phân loại';
}

function getCompletedSets(row: WorkoutRow): number {
  const completedSets = Math.max(0, Number(row.completed_sets || 0));
  if (completedSets > 0) return completedSets;
  if (!row.is_completed) return 0;
  return Math.max(0, Number(row.actual_sets ?? row.sets ?? 0));
}

function getWorkoutCalories(row: WorkoutRow): number {
  return Math.max(0, Number(row.actual_kcal_estimated || row.estimated_kcal || 0));
}

function buildBodyTrend(rows: BodyMetricRow[], readValue: (row: BodyMetricRow) => unknown): BodyTrend {
  const values = rows
    .map((row) => toPositiveNumber(readValue(row)))
    .filter((value): value is number => value !== null);
  const first = values[0] ?? null;
  const latest = values.at(-1) ?? null;
  return {
    first,
    latest,
    change: first !== null && latest !== null && values.length > 1
      ? Number((latest - first).toFixed(1))
      : null,
    samples: values.length,
  };
}

function buildTrainingPeriod(rows: WorkoutRow[], dateKeys: string[]): TrainingPeriod {
  const dateSet = new Set(dateKeys);
  const periodRows = rows.filter((row) => dateSet.has(row.log_date));
  const activeDates = new Set<string>();
  let completedExercises = 0;
  let completedSets = 0;
  let caloriesBurned = 0;

  periodRows.forEach((row) => {
    const rowSets = getCompletedSets(row);
    if (row.is_completed) completedExercises += 1;
    if (row.is_completed || rowSets > 0) activeDates.add(row.log_date);
    completedSets += rowSets;
    if (row.is_completed || rowSets > 0) caloriesBurned += getWorkoutCalories(row);
  });

  return {
    activeDays: activeDates.size,
    completedExercises,
    completedSets,
    plannedExercises: periodRows.length,
    completionRate: periodRows.length > 0 ? Math.round((completedExercises / periodRows.length) * 100) : 0,
    caloriesBurned: Math.round(caloriesBurned),
  };
}

function buildExerciseProgress(
  rows: WorkoutRow[],
  currentDateKeys: string[],
  previousDateKeys: string[],
): ExerciseProgress[] {
  const currentDateSet = new Set(currentDateKeys);
  const previousDateSet = new Set(previousDateKeys);
  const exerciseMap = new Map<string, ExerciseProgress>();

  rows.forEach((row) => {
    const isCurrent = currentDateSet.has(row.log_date);
    const isPrevious = previousDateSet.has(row.log_date);
    const completedSets = getCompletedSets(row);
    if ((!isCurrent && !isPrevious) || (!row.is_completed && completedSets === 0)) return;

    const meta = normalizeExerciseMeta(row.exercises);
    const id = String(row.exercise_id || meta?.name || 'unknown');
    const existing = exerciseMap.get(id) || {
      id,
      name: String(meta?.name || 'Bài tập'),
      muscle: translateMuscleLabel(String(meta?.target_muscle || meta?.body_part || '')),
      currentBest: null,
      previousBest: null,
      currentSets: 0,
      previousSets: 0,
    };
    const weight = toPositiveNumber(row.actual_weight_kg) ?? toPositiveNumber(row.weight_kg);

    if (isCurrent) {
      existing.currentSets += completedSets;
      if (weight !== null) existing.currentBest = Math.max(existing.currentBest || 0, weight);
    } else {
      existing.previousSets += completedSets;
      if (weight !== null) existing.previousBest = Math.max(existing.previousBest || 0, weight);
    }
    exerciseMap.set(id, existing);
  });

  return [...exerciseMap.values()]
    .filter((exercise) => exercise.currentSets > 0 || exercise.currentBest !== null)
    .sort((a, b) => b.currentSets - a.currentSets)
    .slice(0, 4);
}

function getCurrentStreak(days: ActivityDay[], waterGoalMl: number | null): number {
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    const waterGoalReached = waterGoalMl !== null && day.waterMl >= waterGoalMl;
    const active = day.workoutPercent > 0 || waterGoalReached || day.sleepHours > 0 || day.mealLogged;
    if (!active) {
      if (index === days.length - 1) continue;
      break;
    }
    streak += 1;
  }
  return streak;
}

function calculateScore(
  training: TrainingPeriod,
  days: ActivityDay[],
  waterGoalMl: number | null,
  sleepGoal: number | null,
  bodyUpdated: boolean,
): number | null {
  const totalDays = Math.max(1, days.length);
  const weightedScores: Array<{ value: number; weight: number }> = [];
  if (training.plannedExercises > 0) {
    weightedScores.push({ value: training.completionRate, weight: 35 });
  }
  if (days.some((day) => day.waterMl > 0)) {
    const waterScore = waterGoalMl
      ? days.reduce((sum, day) => sum + Math.min(1, day.waterMl / waterGoalMl), 0) / totalDays
      : days.filter((day) => day.waterMl > 0).length / totalDays;
    weightedScores.push({ value: waterScore * 100, weight: 20 });
  }
  if (days.some((day) => day.mealLogged)) {
    const mealScore = days.filter((day) => day.mealLogged).length / totalDays;
    weightedScores.push({ value: mealScore * 100, weight: 20 });
  }
  if (days.some((day) => day.sleepHours > 0)) {
    const sleepScore = sleepGoal
      ? days.reduce((sum, day) => sum + Math.min(1, day.sleepHours / sleepGoal), 0) / totalDays
      : days.filter((day) => day.sleepHours > 0).length / totalDays;
    weightedScores.push({ value: sleepScore * 100, weight: 15 });
  }
  if (bodyUpdated) weightedScores.push({ value: 100, weight: 10 });
  if (weightedScores.length === 0) return null;
  const totalWeight = weightedScores.reduce((sum, item) => sum + item.weight, 0);
  return clampPercent(weightedScores.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight);
}

function buildProgressData(input: {
  currentDateKeys: string[];
  previousDateKeys: string[];
  workouts: WorkoutRow[];
  dailyLogs: DailyProgressRow[];
  meals: MealRow[];
  bodyMetrics: BodyMetricRow[];
  waterGoalMl: number | null;
  sleepGoal: number | null;
}): ProgressData {
  const {
    currentDateKeys,
    previousDateKeys,
    workouts,
    dailyLogs,
    meals,
    bodyMetrics,
    waterGoalMl,
    sleepGoal,
  } = input;

  const sortedBodyMetrics = [...bodyMetrics]
    .filter((row) => row.created_at)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const weight = buildBodyTrend(sortedBodyMetrics, (row) => row.weight);
  const bodyFat = buildBodyTrend(sortedBodyMetrics, (row) => row.body_fat ?? row.body_fat_percentage);
  const waist = buildBodyTrend(sortedBodyMetrics, (row) => row.waist);
  const targetWeight = [...sortedBodyMetrics]
    .reverse()
    .map((row) => toPositiveNumber(row.target_weight))
    .find((value) => value !== null) ?? null;

  const goalProgress = weight.first !== null && weight.latest !== null && targetWeight !== null && weight.first !== targetWeight
    ? clampPercent(((weight.first - weight.latest) / (weight.first - targetWeight)) * 100)
    : null;

  const hasActivityData = workouts.length > 0 || dailyLogs.length > 0 || meals.length > 0;

  const createDays = (dateKeys: string[]): ActivityDay[] => dateKeys.map((dateKey) => {
    const dayWorkouts = workouts.filter((row) => row.log_date === dateKey);
    const completed = dayWorkouts.filter((row) => row.is_completed).length;
    const log = dailyLogs.find((row) => row.log_date === dateKey);
    const dayMeals = meals.filter((row) => row.log_date === dateKey && row.is_completed !== false);
    return {
      dateKey,
      label: getWeekdayLabel(dateKey),
      dayNumber: dateKey.slice(-2),
      workoutPercent: dayWorkouts.length > 0 ? clampPercent((completed / dayWorkouts.length) * 100) : 0,
      completedWorkoutCount: completed,
      caloriesBurned: Math.round(dayWorkouts.reduce((sum, row) => sum + getWorkoutCalories(row), Number(log?.calories_burned || 0))),
      caloriesConsumed: Math.round(dayMeals.reduce((sum, meal) => sum + Number(meal.calories || 0) * Number(meal.quantity || 1), 0)),
      mealLogged: dayMeals.length > 0,
      waterMl: Math.max(0, Number(log?.water_intake_ml || 0)),
      sleepHours: Math.max(0, Number(log?.sleep_hours || 0)),
    };
  });

  const currentTraining = buildTrainingPeriod(workouts, currentDateKeys);
  const previousTraining = buildTrainingPeriod(workouts, previousDateKeys);
  const days = createDays(currentDateKeys);
  const previousDays = createDays(previousDateKeys);

  const currentDateSet = new Set(currentDateKeys);
  const muscleTotals: Record<string, number> = {};
  workouts.forEach((row) => {
    if (!currentDateSet.has(row.log_date) || !row.is_completed) return;
    const exercise = normalizeExerciseMeta(row.exercises);
    const rawLabel = String(exercise?.target_muscle || exercise?.body_part || '').trim();
    if (!rawLabel) return;
    const label = translateMuscleLabel(rawLabel);
    if (label) muscleTotals[label] = (muscleTotals[label] || 0) + Math.max(1, getCompletedSets(row));
  });

  const realMuscles = Object.entries(muscleTotals)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const realExercises = buildExerciseProgress(workouts, currentDateKeys, previousDateKeys);
  const currentDateSetForBody = new Set(currentDateKeys);
  const previousDateSetForBody = new Set(previousDateKeys);
  const bodyDateKeys = sortedBodyMetrics.map((row) => getVietnamDateKey(new Date(row.created_at)));

  const score = calculateScore(
    currentTraining,
    days,
    waterGoalMl,
    sleepGoal,
    bodyDateKeys.some((dateKey) => currentDateSetForBody.has(dateKey)),
  );
  const previousScore = calculateScore(
    previousTraining,
    previousDays,
    waterGoalMl,
    sleepGoal,
    bodyDateKeys.some((dateKey) => previousDateSetForBody.has(dateKey)),
  );

  return {
    currentRangeLabel: formatRange(currentDateKeys),
    previousRangeLabel: formatRange(previousDateKeys),
    hasActivityData,
    body: { weight, bodyFat, waist, targetWeight, goalProgress },
    wellness: {
      score,
      previousScore,
      streak: getCurrentStreak(days, waterGoalMl),
      previousStreak: getCurrentStreak(previousDays, waterGoalMl),
      waterGoalMl,
      sleepGoal,
    },
    training: {
      current: currentTraining,
      previous: previousTraining,
      days,
      muscleGroups: realMuscles,
      exercises: realExercises,
    },
  };
}

function ChangeLabel({
  value,
  suffix = '',
  inverse = false,
}: {
  value: number | null;
  suffix?: string;
  inverse?: boolean;
}) {
  if (value === null) return <span className="text-xs font-bold text-text-tertiary">Chưa đủ dữ liệu</span>;
  const positive = inverse ? value < 0 : value > 0;
  const neutral = value === 0;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-black ${
      neutral ? 'text-text-tertiary' : positive ? 'text-accent' : 'text-warning'
    }`}>
      <Icon className="h-3.5 w-3.5" />
      {value > 0 ? '+' : ''}{formatNumber(value, Number.isInteger(value) ? 0 : 1)}{suffix}
    </span>
  );
}

function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border-primary bg-bg-secondary/85 shadow-[var(--app-shadow-soft)] ${className}`}>
      {children}
    </section>
  );
}

function KpiCard({
  label,
  value,
  helper,
  comparison,
  icon,
  tone,
  status,
}: {
  label: string;
  value: string;
  helper: string;
  comparison: ReactNode;
  icon: ReactNode;
  tone: 'accent' | 'warning' | 'info' | 'ai';
  status: string;
}) {
  const styles = {
    accent: 'bg-accent/10 text-accent border-accent/15',
    warning: 'bg-warning/10 text-warning border-warning/15',
    info: 'bg-info/10 text-info border-info/15',
    ai: 'bg-ai/10 text-ai border-ai/15',
  }[tone];
  return (
    <article className="min-w-0 rounded-2xl border border-border-primary bg-bg-secondary/85 p-4 transition-transform hover:-translate-y-0.5 shadow-[var(--app-shadow-soft)] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${styles}`}>{icon}</span>
        <span className="rounded-full border border-border-primary bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-text-secondary">
          {status}
        </span>
      </div>
      <p className="mt-3.5 text-xs font-black uppercase tracking-[0.1em] text-text-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-black text-text-primary">{value}</p>
      <div className="mt-3 flex min-h-7 items-end justify-between gap-2 border-t border-border-primary/80 pt-2.5">
        <p className="text-xs font-semibold leading-5 text-text-secondary">{helper}</p>
        <span className="shrink-0">{comparison}</span>
      </div>
    </article>
  );
}

function MetricMiniCard({
  label,
  value,
  unit,
  trend,
  icon,
  progress,
  tone,
}: {
  label: string;
  value: number | null;
  unit: string;
  trend: number | null;
  icon: ReactNode;
  progress: number | null;
  tone: 'accent' | 'warning' | 'info' | 'ai';
}) {
  const barColor = { accent: 'bg-accent', warning: 'bg-warning', info: 'bg-info', ai: 'bg-ai' }[tone];
  return (
    <article className="rounded-xl border border-border-primary bg-bg-tertiary/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-secondary text-text-secondary">{icon}</span>
        <ChangeLabel value={trend} suffix={unit === '%' ? '%' : ` ${unit}`} inverse={label !== 'Tiến độ mục tiêu'} />
      </div>
      <p className="mt-3 text-xs font-bold text-text-secondary">{label}</p>
      <p className="mt-0.5 text-lg font-black text-text-primary">
        {value === null ? 'Chưa cập nhật' : formatNumber(value, 1)}
        {value !== null && <span className="ml-1 text-xs font-medium text-text-tertiary">{unit}</span>}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${progress ?? 0}%` }} />
      </div>
    </article>
  );
}

function ProgressSkeleton() {
  return (
    <div className="dashboard-page-shell animate-pulse pb-6">
      <div className="border-b border-border-primary pb-5">
        {SkeletonBlock('h-8 w-48 rounded-xl')}
        {SkeletonBlock('mt-3 h-4 w-96 max-w-full rounded-lg')}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <SkeletonSurface key={item} className="h-40 rounded-2xl p-5">
            {SkeletonBlock('h-10 w-10 rounded-xl')}
            {SkeletonBlock('mt-4 h-6 w-28 rounded-lg')}
            {SkeletonBlock('mt-3 h-4 w-full rounded-lg')}
          </SkeletonSurface>
        ))}
      </div>
    </div>
  );
}

export default function Progress() {
  const { user, isLoggedIn, refreshTick } = useAuth();
  const navigate = useNavigate();
  const todayKey = getVietnamDateKey();
  
  // Clean, fixed 7-day focus
  const cacheKey = user?.id ? `${user.id}:${todayKey}:progress-7d-v1` : null;
  const [data, setData] = useState<ProgressData | null>(cacheKey ? progressCache.get(cacheKey) || null : null);
  const [loading, setLoading] = useState(!data);
  const [errorMessage, setErrorMessage] = useState('');
  const [insightDismissed, setInsightDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchProgress() {
      if (!user || !isLoggedIn) {
        if (mounted) {
          setData(null);
          setLoading(false);
        }
        return;
      }

      const currentDateKeys = buildDateKeys(todayKey, 7);
      const previousDateKeys = buildDateKeys(addDays(currentDateKeys[0], -1), 7);
      const fetchStartKey = previousDateKeys[0];
      
      if (!data) setLoading(true);
      setErrorMessage('');

      try {
        const [workoutsRes, bodyRes, dailyRes, mealsRes, lifestyleRes, healthRes] = await Promise.all([
          supabase
            .from('daily_exercise_sessions')
            .select('exercise_id, log_date, is_completed, sets, actual_sets, completed_sets, weight_kg, actual_weight_kg, estimated_kcal, actual_kcal_estimated, exercises:exercise_id(name, target_muscle, body_part)')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey),
          supabase
            .from('body_metrics')
            .select('weight, target_weight, body_fat, body_fat_percentage, waist, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(BODY_HISTORY_LIMIT),
          supabase
            .from('daily_progress_logs')
            .select('log_date, water_intake_ml, sleep_hours, calories_burned')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey),
          supabase
            .from('daily_meal_logs')
            .select('log_date, calories, quantity, is_completed')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey),
          supabase
            .from('lifestyle_settings')
            .select('daily_water_goal')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('health_conditions')
            .select('sleep_hours')
            .eq('user_id', user.id)
            .maybeSingle(),
        ]);

        const requiredError = [workoutsRes.error, bodyRes.error, dailyRes.error, mealsRes.error].find(Boolean);
        if (requiredError) throw requiredError;

        const waterGoalRaw = toPositiveNumber(lifestyleRes.data?.daily_water_goal);
        const waterGoalMl = waterGoalRaw === null ? null : waterGoalRaw > 20 ? waterGoalRaw : waterGoalRaw * 1000;
        const sleepGoal = toPositiveNumber(healthRes.data?.sleep_hours);

        const nextData = buildProgressData({
          currentDateKeys,
          previousDateKeys,
          workouts: (workoutsRes.data || []) as WorkoutRow[],
          bodyMetrics: (bodyRes.data || []) as BodyMetricRow[],
          dailyLogs: (dailyRes.data || []) as DailyProgressRow[],
          meals: (mealsRes.data || []) as MealRow[],
          waterGoalMl,
          sleepGoal,
        });

        if (mounted) {
          setData(nextData);
          if (cacheKey) progressCache.set(cacheKey, nextData);
        }
      } catch (error) {
        console.error('Không thể tải trang tiến độ:', error);
        if (mounted) setErrorMessage('Không thể cập nhật đầy đủ chỉ số. Fitly đang hiển thị dữ liệu gần nhất.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void fetchProgress();
    return () => {
      mounted = false;
    };
  }, [user, isLoggedIn, refreshTick, cacheKey, todayKey]);

  const insight = useMemo(() => {
    if (!data) return '';
    const { current } = data.training;
    if (!data.hasActivityData) {
      return 'Chưa có đủ dữ liệu tập luyện trong 7 ngày qua. Ghi nhận hoạt động đầu tiên để bắt đầu theo dõi!';
    }
    if (current.completionRate >= 80) {
      return `Tuần này rất ấn tượng! Bạn đã hoàn thành ${current.completedExercises} bài tập trong ${current.activeDays} ngày vận động. Giữ vững phong độ cho tuần tới!`;
    }
    if (current.activeDays > 0) {
      return `Bạn đã vận động ${current.activeDays}/7 ngày và đốt cháy ${current.caloriesBurned} kcal. Thêm 1 buổi nhẹ sẽ giúp hoàn thiện tuần này hoàn hảo hơn.`;
    }
    return 'Hãy bắt đầu tuần này với một bài tập nhẹ nhàng 15-20 phút để khởi động lại guồng quay vận động!';
  }, [data]);

  if (loading && !data) return <ProgressSkeleton />;
  if (!data) {
    return (
      <div className="dashboard-page-shell pb-6">
        <Panel className="p-6 text-center">
          <Activity className="mx-auto h-8 w-8 text-text-tertiary" />
          <p className="mt-3 text-sm font-semibold text-text-secondary">{errorMessage || 'Chưa có dữ liệu tiến độ. Hãy hoàn thành buổi tập đầu tiên để bắt đầu theo dõi.'}</p>
        </Panel>
      </div>
    );
  }

  const { body, training, wellness } = data;
  const scoreDelta = wellness.score !== null && wellness.previousScore !== null
    ? wellness.score - wellness.previousScore
    : null;
  const completionDelta = training.current.plannedExercises > 0 && training.previous.plannedExercises > 0
    ? training.current.completionRate - training.previous.completionRate
    : null;

  const activityDays = training.days.slice(-7);
  const averageWater = activityDays.reduce((sum, day) => sum + day.waterMl, 0) / Math.max(1, activityDays.length);
  const averageSleep = activityDays.reduce((sum, day) => sum + day.sleepHours, 0) / Math.max(1, activityDays.length);

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-6 md:gap-5">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border-primary pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-black text-accent">
              <CircleGauge className="h-3.5 w-3.5" />
              Tiến độ 7 Ngày
            </span>
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-black tracking-tight text-text-primary">Hiệu Suất Tuần Này</h1>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            Tóm tắt gọn gàng về tập luyện, dinh dưỡng và thay đổi cơ thể trong 7 ngày gần nhất.
          </p>
        </div>
        <div className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-3.5 text-xs font-black text-text-secondary">
          <CalendarDays className="h-4 w-4 text-accent" />
          <span>{data.currentRangeLabel}</span>
        </div>
      </header>

      {errorMessage && (
        <p className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-2.5 text-sm font-bold text-warning">{errorMessage}</p>
      )}

      {/* 4 Essential KPI Cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Điểm Tiến Độ Tuần"
          value={wellness.score === null ? '—' : `${wellness.score}/100`}
          helper={wellness.previousScore === null ? '7 ngày đầu tiên' : `7 ngày trước: ${wellness.previousScore}đ`}
          comparison={<ChangeLabel value={scoreDelta} suffix="đ" />}
          icon={<CircleGauge className="h-5 w-5" />}
          tone="accent"
          status={scoreDelta === null ? '7 Ngày' : scoreDelta >= 0 ? 'Tốt' : 'Cần cố gắng'}
        />
        <KpiCard
          label="Hoàn Thành Buổi Tập"
          value={training.current.plannedExercises > 0 ? `${training.current.completionRate}%` : `${training.current.completedExercises} bài`}
          helper={training.current.plannedExercises > 0 ? `${training.current.completedExercises}/${training.current.plannedExercises} bài hoàn thành` : `${training.current.activeDays} ngày tập luyện`}
          comparison={<ChangeLabel value={completionDelta} suffix="%" />}
          icon={<Dumbbell className="h-5 w-5" />}
          tone="info"
          status={training.current.plannedExercises === 0 ? 'Tuần này' : training.current.completionRate >= 75 ? 'Xuất sắc' : 'Đang duy trì'}
        />
        <KpiCard
          label="Năng Lượng Đốt Cháy"
          value={`${training.current.caloriesBurned} kcal`}
          helper={`TB ${Math.round(training.current.caloriesBurned / 7)} kcal/ngày`}
          comparison={<Flame className="h-4 w-4 text-warning" />}
          icon={<Zap className="h-5 w-5" />}
          tone="warning"
          status={`${training.current.activeDays}/7 Ngày`}
        />
        <KpiCard
          label="Cân Nặng Tuần Này"
          value={body.weight.latest !== null ? `${formatNumber(body.weight.latest, 1)} kg` : 'Chưa cập nhật'}
          helper={body.weight.change !== null ? `Đầu tuần: ${formatNumber(body.weight.first, 1)} kg` : 'Hãy ghi nhận chỉ số'}
          comparison={<ChangeLabel value={body.weight.change} suffix=" kg" inverse />}
          icon={<Scale className="h-5 w-5" />}
          tone="ai"
          status={body.targetWeight ? `Mục tiêu ${formatNumber(body.targetWeight, 1)}kg` : 'Cơ thể'}
        />
      </section>

      {/* 7-Day Activity Rhythm */}
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border-primary p-4 md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
          <div>
            <h2 className="text-lg font-black text-text-primary">Nhịp Vận Động 7 Ngày</h2>
            <p className="text-xs font-semibold text-text-secondary">Trạng thái tập luyện, nước uống & calo tiêu thụ trong tuần.</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-bold text-text-secondary">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" />Tập luyện</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning" />Calo đốt</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-info" />Nước</span>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <div className="grid grid-cols-7 gap-2">
            {activityDays.map((day, index) => {
              const isToday = index === activityDays.length - 1;
              const hasWorkout = day.completedWorkoutCount > 0 || day.workoutPercent > 0;
              const waterPercent = wellness.waterGoalMl ? Math.min(100, Math.round((day.waterMl / wellness.waterGoalMl) * 100)) : (day.waterMl > 0 ? 100 : 0);

              return (
                <article
                  key={day.dateKey}
                  className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition-all ${
                    isToday
                      ? 'border-accent/40 bg-accent/10 shadow-sm'
                      : hasWorkout
                      ? 'border-border-primary bg-bg-tertiary/60'
                      : 'border-border-primary/50 bg-bg-tertiary/20'
                  }`}
                >
                  <p className={`text-xs font-black uppercase ${isToday ? 'text-accent' : 'text-text-secondary'}`}>
                    {day.label}
                  </p>
                  <p className="text-[11px] font-semibold text-text-tertiary">{day.dayNumber}</p>

                  {/* Workout Status Badge */}
                  <div className="mt-3 flex h-8 w-8 items-center justify-center rounded-full bg-bg-secondary">
                    {hasWorkout ? (
                      <Dumbbell className="h-4 w-4 text-accent" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary/40" />
                    )}
                  </div>

                  {/* Calories & Water indicators */}
                  <p className="mt-2.5 text-[11px] font-black text-text-primary">
                    {day.caloriesBurned > 0 ? `${day.caloriesBurned} kcal` : '—'}
                  </p>

                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-bg-secondary" title={`Nước: ${day.waterMl}ml`}>
                    <div className="h-full bg-info rounded-full" style={{ width: `${waterPercent}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {/* Bottom Averages Bar */}
        <div className="grid gap-px border-t border-border-primary bg-border-primary sm:grid-cols-3">
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <Droplets className="h-4 w-4 text-info" />
            <span>Nước trung bình: <strong className="text-text-primary">{formatNumber(averageWater / 1000, 1)}L/ngày</strong></span>
          </div>
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <BedDouble className="h-4 w-4 text-ai" />
            <span>Giấc ngủ trung bình: <strong className="text-text-primary">{formatNumber(averageSleep, 1)}h/ngày</strong></span>
          </div>
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            <span>Tổng calo đốt: <strong className="text-text-primary">{training.current.caloriesBurned} kcal</strong></span>
          </div>
        </div>
      </Panel>

      {/* Body Metrics & Strength Progress (2 Column Layout) */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Body Metrics Card */}
        <Panel className="p-4 md:p-5">
          <div className="flex items-center justify-between border-b border-border-primary pb-3">
            <div>
              <h2 className="text-lg font-black text-text-primary">Chỉ Số Cơ Thể Tuần Này</h2>
              <p className="text-xs font-semibold text-text-secondary">Theo dõi thay đổi nhỏ tạo nên kết quả lớn.</p>
            </div>
            <Scale className="h-5 w-5 text-ai" />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricMiniCard
              label="Cân nặng"
              value={body.weight.latest}
              unit="kg"
              trend={body.weight.change}
              icon={<Scale className="h-4 w-4" />}
              progress={body.goalProgress}
              tone="ai"
            />
            <MetricMiniCard
              label="Tỷ lệ mỡ"
              value={body.bodyFat.latest}
              unit="%"
              trend={body.bodyFat.change}
              icon={<Activity className="h-4 w-4" />}
              progress={body.bodyFat.latest}
              tone="warning"
            />
            <MetricMiniCard
              label="Vòng eo"
              value={body.waist.latest}
              unit="cm"
              trend={body.waist.change}
              icon={<Ruler className="h-4 w-4" />}
              progress={body.waist.latest ? Math.min(100, body.waist.latest) : null}
              tone="info"
            />
            <MetricMiniCard
              label="Tiến độ mục tiêu"
              value={body.goalProgress}
              unit="%"
              trend={null}
              icon={<Target className="h-4 w-4" />}
              progress={body.goalProgress}
              tone="accent"
            />
          </div>

          {body.weight.latest === null && (
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-xl border border-ai/30 bg-ai/10 text-xs font-black text-ai hover:bg-ai/15 transition-colors"
            >
              Cập nhật cân nặng mới
            </button>
          )}
        </Panel>

        {/* Strength Progress Card */}
        <Panel className="p-4 md:p-5">
          <div className="flex items-center justify-between border-b border-border-primary pb-3">
            <div>
              <h2 className="text-lg font-black text-text-primary">Tiến Bộ Sức Mạnh Tuần Này</h2>
              <p className="text-xs font-semibold text-text-secondary">Bài tập cải thiện hàng đầu so với 7 ngày trước.</p>
            </div>
            <Medal className="h-5 w-5 text-warning" />
          </div>

          {training.exercises.length === 0 ? (
            <div className="mt-6 text-center py-6">
              <Dumbbell className="mx-auto h-7 w-7 text-text-tertiary/60" />
              <p className="mt-2 text-xs font-semibold text-text-secondary">Chưa có dữ liệu bài tập trong 7 ngày qua.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {training.exercises.map((exercise) => {
                const hasWeights = exercise.currentBest !== null && exercise.previousBest !== null;
                const improvement = hasWeights && exercise.previousBest
                  ? ((exercise.currentBest! - exercise.previousBest) / exercise.previousBest) * 100
                  : exercise.previousSets > 0 ? ((exercise.currentSets - exercise.previousSets) / exercise.previousSets) * 100 : null;
                const isPr = improvement !== null && improvement >= 5;

                return (
                  <div key={exercise.id} className="flex items-center justify-between rounded-xl border border-border-primary/60 bg-bg-tertiary/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-text-primary">
                        {exercise.name}
                      </p>
                      <p className="text-[11px] font-semibold text-text-tertiary">{exercise.muscle}</p>
                    </div>

                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <p className="text-sm font-black text-text-primary">
                          {exercise.currentBest !== null ? `${formatNumber(exercise.currentBest, 1)} kg` : `${exercise.currentSets} hiệp`}
                        </p>
                        <p className="text-[10px] font-medium text-text-tertiary">
                          Trước: {exercise.previousBest !== null ? `${formatNumber(exercise.previousBest, 1)} kg` : `${exercise.previousSets} hiệp`}
                        </p>
                      </div>
                      {isPr && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-black uppercase text-warning">
                          PR
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* Concise AI Coach Banner */}
      {!insightDismissed ? (
        <section className="relative overflow-hidden rounded-2xl border border-ai/20 bg-bg-secondary p-4 md:p-5 shadow-[var(--app-shadow-soft)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai/15 text-ai">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-ai">Đánh giá từ AI Coach</p>
                <p className="mt-1 text-xs sm:text-sm font-semibold leading-relaxed text-text-primary">{insight}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <button
                type="button"
                onClick={() => navigate('/smart-planner')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-ai/30 bg-ai/10 px-3.5 text-xs font-black text-ai hover:bg-ai/20 transition-colors"
              >
                Hỏi AI Coach
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setInsightDismissed(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary"
                title="Bỏ qua"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setInsightDismissed(false)}
          className="inline-flex w-fit items-center gap-2 text-xs font-black text-ai hover:underline"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Hiện lời khuyên tuần từ AI Coach
        </button>
      )}
    </div>
  );
}
