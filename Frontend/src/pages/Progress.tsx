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
  Medal,
  Minus,
  RefreshCw,
  Ruler,
  Scale,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const BODY_HISTORY_LIMIT = 120;
type Period = 7 | 30 | 90;

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
  completedSets: number;
  caloriesBurned: number;
  caloriesConsumed: number;
  mealLogged: boolean;
  mealsCompleted: number;
  plannedWorkouts: number;
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
    latestDate: string | null;
  };
  wellness: {
    streak: number;
    waterGoalMl: number | null;
    sleepGoal: number | null;
    mealDays: number;
    previousMealDays: number;
    waterDays: number;
    previousWaterDays: number;
    sleepDays: number;
    previousSleepDays: number;
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

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

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
  const first = dateKeys[0];
  const last = dateKeys.at(-1)!;
  return `${getShortDate(first)}/${first.slice(0, 4)} – ${getShortDate(last)}/${last.slice(0, 4)}`;
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
  const actual = Math.max(0, Number(row.actual_kcal_estimated) || 0);
  return actual > 0 ? actual : row.is_completed ? Math.max(0, Number(row.estimated_kcal) || 0) : 0;
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

function getCurrentStreak(days: ActivityDay[]): number {
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    const active = day.completedSets > 0 || day.completedWorkoutCount > 0 || day.waterMl > 0 || day.sleepHours > 0 || day.mealLogged;
    if (!active) {
      if (index === days.length - 1) continue;
      break;
    }
    streak += 1;
  }
  return streak;
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

  const periodBodyMetrics = sortedBodyMetrics.filter((row) => currentDateKeys.includes(getVietnamDateKey(new Date(row.created_at))));
  const buildPeriodTrend = (readValue: (row: BodyMetricRow) => unknown): BodyTrend => {
    const all = buildBodyTrend(sortedBodyMetrics, readValue);
    const period = buildBodyTrend(periodBodyMetrics, readValue);
    return { first: period.first, latest: all.latest, change: period.change, samples: period.samples };
  };
  const weight = buildPeriodTrend((row) => row.weight);
  const bodyFat = buildPeriodTrend((row) => row.body_fat_percentage ?? row.body_fat);
  const waist = buildPeriodTrend((row) => row.waist);
  const firstWeight = buildBodyTrend(sortedBodyMetrics, (row) => row.weight).first;
  const targetWeight = [...sortedBodyMetrics]
    .reverse()
    .map((row) => toPositiveNumber(row.target_weight))
    .find((value) => value !== null) ?? null;

  const goalProgress = firstWeight !== null && weight.latest !== null && targetWeight !== null && firstWeight !== targetWeight
    ? clampPercent(((firstWeight - weight.latest) / (firstWeight - targetWeight)) * 100)
    : null;

  const createDays = (dateKeys: string[]): ActivityDay[] => dateKeys.map((dateKey) => {
    const dayWorkouts = workouts.filter((row) => row.log_date === dateKey);
    const completed = dayWorkouts.filter((row) => row.is_completed).length;
    const log = dailyLogs.find((row) => row.log_date === dateKey);
    const dayMeals = meals.filter((row) => row.log_date === dateKey && row.is_completed === true);
    const workoutCalories = Math.round(dayWorkouts.reduce((sum, row) => sum + getWorkoutCalories(row), 0));
    const loggedCalories = Math.max(0, Number(log?.calories_burned) || 0);
    return {
      dateKey,
      label: getWeekdayLabel(dateKey),
      dayNumber: dateKey.slice(-2),
      workoutPercent: dayWorkouts.length > 0 ? clampPercent((completed / dayWorkouts.length) * 100) : 0,
      completedWorkoutCount: completed,
      completedSets: dayWorkouts.reduce((sum, row) => sum + getCompletedSets(row), 0),
      plannedWorkouts: dayWorkouts.length,
      caloriesBurned: loggedCalories > 0 ? Math.round(loggedCalories) : workoutCalories,
      caloriesConsumed: Math.round(dayMeals.reduce((sum, meal) => sum + Math.max(0, Number(meal.calories) || 0) * Math.max(0, Number(meal.quantity) || 0), 0)),
      mealLogged: dayMeals.length > 0,
      mealsCompleted: dayMeals.length,
      waterMl: Math.max(0, Number(log?.water_intake_ml || 0)),
      sleepHours: Math.max(0, Number(log?.sleep_hours || 0)),
    };
  });

  const currentTraining = buildTrainingPeriod(workouts, currentDateKeys);
  const previousTraining = buildTrainingPeriod(workouts, previousDateKeys);
  const days = createDays(currentDateKeys);
  const previousDays = createDays(previousDateKeys);
  const hasActivityData = days.some((day) => day.completedWorkoutCount > 0 || day.completedSets > 0 || day.waterMl > 0 || day.sleepHours > 0 || day.mealLogged || day.caloriesBurned > 0);
  currentTraining.caloriesBurned = days.reduce((sum, day) => sum + day.caloriesBurned, 0);
  previousTraining.caloriesBurned = previousDays.reduce((sum, day) => sum + day.caloriesBurned, 0);

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
  return {
    currentRangeLabel: formatRange(currentDateKeys),
    previousRangeLabel: formatRange(previousDateKeys),
    hasActivityData,
    body: { weight, bodyFat, waist, targetWeight, goalProgress, latestDate: sortedBodyMetrics.at(-1)?.created_at ?? null },
    wellness: {
      streak: getCurrentStreak(days),
      waterGoalMl,
      sleepGoal,
      mealDays: days.filter((day) => day.mealLogged).length,
      previousMealDays: previousDays.filter((day) => day.mealLogged).length,
      waterDays: days.filter((day) => waterGoalMl ? day.waterMl >= waterGoalMl : day.waterMl > 0).length,
      previousWaterDays: previousDays.filter((day) => waterGoalMl ? day.waterMl >= waterGoalMl : day.waterMl > 0).length,
      sleepDays: days.filter((day) => sleepGoal ? day.sleepHours >= sleepGoal : day.sleepHours > 0).length,
      previousSleepDays: previousDays.filter((day) => sleepGoal ? day.sleepHours >= sleepGoal : day.sleepHours > 0).length,
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
  neutralTone = false,
}: {
  value: number | null;
  suffix?: string;
  neutralTone?: boolean;
}) {
  if (value === null) return <span className="text-xs font-bold text-text-tertiary">Chưa đủ dữ liệu</span>;
  const positive = value > 0;
  const neutral = value === 0 || neutralTone;
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
        {label === 'Tiến độ mục tiêu'
          ? <span className="text-[11px] font-semibold text-text-tertiary">Từ lần đo đầu</span>
          : <ChangeLabel value={trend} suffix={unit === '%' ? '%' : ` ${unit}`} neutralTone />}
      </div>
      <p className="mt-3 text-xs font-bold text-text-secondary">{label}</p>
      <p className="mt-0.5 text-lg font-black text-text-primary">
        {value === null ? 'Chưa cập nhật' : formatNumber(value, 1)}
        {value !== null && <span className="ml-1 text-xs font-medium text-text-tertiary">{unit}</span>}
      </p>
      {progress !== null && <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bg-secondary" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${progress}%` }} />
      </div>}
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
  const [period, setPeriod] = useState<Period>(7);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const cacheKey = user?.id ? `${user.id}:${todayKey}:progress-${period}d-v2` : null;
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

      const currentDateKeys = buildDateKeys(todayKey, period);
      const previousDateKeys = buildDateKeys(addDays(currentDateKeys[0], -1), period);
      const fetchStartKey = previousDateKeys[0];
      
      if (!data) setLoading(true);
      setErrorMessage('');

      try {
        const [workoutsRes, bodyRes, firstBodyRes, dailyRes, mealsRes, lifestyleRes, healthRes] = await Promise.all([
          fetchAllRows<WorkoutRow>((from, to) => supabase
            .from('daily_exercise_sessions')
            .select('exercise_id, log_date, is_completed, sets, actual_sets, completed_sets, weight_kg, actual_weight_kg, estimated_kcal, actual_kcal_estimated, exercises:exercise_id(name, target_muscle, body_part)')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey)
            .order('log_date', { ascending: true }).order('id', { ascending: true }).range(from, to)),
          supabase
            .from('body_metrics')
            .select('weight, target_weight, body_fat, body_fat_percentage, waist, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(BODY_HISTORY_LIMIT),
          supabase
            .from('body_metrics')
            .select('weight, target_weight, body_fat, body_fat_percentage, waist, created_at')
            .eq('user_id', user.id)
            .not('weight', 'is', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('daily_progress_logs')
            .select('log_date, water_intake_ml, sleep_hours, calories_burned')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey),
          fetchAllRows<MealRow>((from, to) => supabase
            .from('daily_meal_logs')
            .select('log_date, calories, quantity, is_completed')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey)
            .order('log_date', { ascending: true }).order('id', { ascending: true }).range(from, to)),
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

        const requiredError = [workoutsRes.error, bodyRes.error, firstBodyRes.error, dailyRes.error, mealsRes.error, lifestyleRes.error, healthRes.error].find(Boolean);
        if (requiredError) throw requiredError;

        const waterGoalRaw = toPositiveNumber(lifestyleRes.data?.daily_water_goal);
        const waterGoalMl = waterGoalRaw === null ? null : waterGoalRaw > 20 ? waterGoalRaw : waterGoalRaw * 1000;
        const sleepGoal = toPositiveNumber(healthRes.data?.sleep_hours);
        const firstBody = firstBodyRes.data;
        const bodyMetrics = bodyRes.data || [];

        const nextData = buildProgressData({
          currentDateKeys,
          previousDateKeys,
          workouts: (workoutsRes.data || []) as WorkoutRow[],
          bodyMetrics: [...bodyMetrics, ...(firstBody && !bodyMetrics.some((row) => row.created_at === firstBody.created_at) ? [firstBody] : [])] as BodyMetricRow[],
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
        if (mounted) setErrorMessage(data ? 'Không thể cập nhật chỉ số. Đang hiển thị dữ liệu gần nhất.' : 'Không thể tải tiến độ. Vui lòng thử lại.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void fetchProgress();
    return () => {
      mounted = false;
    };
  }, [user?.id, isLoggedIn, refreshTick, cacheKey, todayKey, period, retryTick]);

  const insight = useMemo(() => {
    if (!data) return '';
    const { current } = data.training;
    if (!data.hasActivityData) {
      return 'Chưa có hoạt động được ghi nhận trong kỳ này. Hãy ghi buổi tập, bữa ăn hoặc nước uống để bắt đầu theo dõi.';
    }
    if (current.completionRate >= 80) {
      return `Trong ${period} ngày qua, bạn hoàn thành ${current.completedExercises}/${current.plannedExercises} bài tập trong ${current.activeDays} ngày vận động.`;
    }
    if (current.activeDays > 0) {
      return `Bạn đã vận động ${current.activeDays}/${period} ngày và ghi nhận ${current.caloriesBurned} kcal tiêu hao. Xem lịch tập để chọn buổi tiếp theo.`;
    }
    return 'Chưa có buổi tập hoàn thành trong kỳ này. Bạn có thể bắt đầu từ lịch tập hiện tại.';
  }, [data, period]);

  if (loading && !data) return <ProgressSkeleton />;
  if (!data) {
    return (
      <div className="dashboard-page-shell pb-6">
        <Panel className="p-6 text-center">
          <Activity className="mx-auto h-8 w-8 text-text-tertiary" />
          <p className="mt-3 text-sm font-semibold text-text-secondary">{errorMessage || 'Chưa có dữ liệu tiến độ. Hãy hoàn thành buổi tập đầu tiên để bắt đầu theo dõi.'}</p>
          <button type="button" onClick={() => setRetryTick((value) => value + 1)} className="mt-4 rounded-xl bg-accent px-4 py-2 text-xs font-black text-text-inverse">Thử lại</button>
        </Panel>
      </div>
    );
  }

  const { body, training, wellness } = data;
  const mealDaysDelta = wellness.mealDays - wellness.previousMealDays;
  const completionDelta = training.current.plannedExercises > 0 && training.previous.plannedExercises > 0
    ? training.current.completionRate - training.previous.completionRate
    : null;
  const caloriesDelta = training.current.caloriesBurned - training.previous.caloriesBurned;

  const activityDays = training.days.slice(-7);
  const selectedDay = training.days.find((day) => day.dateKey === selectedDate) || activityDays.at(-1)!;
  const averageWater = training.days.reduce((sum, day) => sum + day.waterMl, 0) / period;
  const averageSleep = training.days.reduce((sum, day) => sum + day.sleepHours, 0) / period;
  const habits = [
    { label: 'Ngày tập', value: training.current.activeDays, previous: training.previous.activeDays, detail: 'Có bài tập hoặc hiệp đã hoàn thành', tone: 'bg-accent' },
    { label: 'Ngày ghi bữa ăn', value: wellness.mealDays, previous: wellness.previousMealDays, detail: 'Có ít nhất một bữa đã ăn', tone: 'bg-warning' },
    { label: wellness.waterGoalMl ? 'Ngày đạt mục tiêu nước' : 'Ngày ghi nước uống', value: wellness.waterDays, previous: wellness.previousWaterDays, detail: wellness.waterGoalMl ? `Mục tiêu ${formatNumber(wellness.waterGoalMl)} ml/ngày` : 'Chưa đặt mục tiêu nước', tone: 'bg-info' },
    { label: wellness.sleepGoal ? 'Đêm đạt mục tiêu ngủ' : 'Ngày ghi giấc ngủ', value: wellness.sleepDays, previous: wellness.previousSleepDays, detail: wellness.sleepGoal ? `Mục tiêu ${formatNumber(wellness.sleepGoal, 1)} giờ/đêm` : 'Chưa đặt mục tiêu ngủ', tone: 'bg-ai' },
  ];
  const changePeriod = (nextPeriod: Period) => {
    if (nextPeriod === period) return;
    setSelectedDate(null);
    setData(user?.id ? progressCache.get(`${user.id}:${todayKey}:progress-${nextPeriod}d-v2`) || null : null);
    setLoading(true);
    setPeriod(nextPeriod);
  };

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-6 md:gap-5">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border-primary pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-black text-accent">
              <CircleGauge className="h-3.5 w-3.5" />
              Tiến độ {period} ngày
            </span>
          </div>
          <h1 className="mt-2 text-2xl md:text-3xl font-black tracking-tight text-text-primary">Tiến độ của bạn</h1>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            Hoạt động đã ghi nhận, thói quen và thay đổi cơ thể trong {period} ngày gần nhất.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-border-primary bg-bg-secondary p-1" aria-label="Khoảng thời gian">
            {([7, 30, 90] as Period[]).map((option) => (
              <button key={option} type="button" onClick={() => changePeriod(option)} aria-pressed={period === option} className={`rounded-lg px-3 py-1.5 text-xs font-black ${period === option ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-tertiary'}`}>{option} ngày</button>
            ))}
          </div>
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-3.5 text-xs font-black text-text-secondary"><CalendarDays className="h-4 w-4 text-accent" />{data.currentRangeLabel}</span>
          <button type="button" onClick={() => setRetryTick((value) => value + 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-primary bg-bg-secondary text-text-secondary hover:text-accent" aria-label="Làm mới tiến độ" title="Làm mới tiến độ"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </header>

      {errorMessage && (
        <p className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-2.5 text-sm font-bold text-warning">{errorMessage}</p>
      )}

      {/* 4 Essential KPI Cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ngày ghi nhận bữa ăn"
          value={`${wellness.mealDays}/${period} ngày`}
          helper={`Có hoạt động ${wellness.streak} ngày liên tiếp`}
          comparison={<ChangeLabel value={mealDaysDelta} suffix=" ngày" />}
          icon={<CircleGauge className="h-5 w-5" />}
          tone="accent"
          status="Dinh dưỡng"
        />
        <KpiCard
          label="Hoàn thành bài tập"
          value={training.current.plannedExercises > 0 ? `${training.current.completionRate}%` : `${training.current.completedExercises} bài`}
          helper={training.current.plannedExercises > 0 ? `${training.current.completedExercises}/${training.current.plannedExercises} bài hoàn thành` : `${training.current.activeDays} ngày tập luyện`}
          comparison={<ChangeLabel value={completionDelta} suffix="%" />}
          icon={<Dumbbell className="h-5 w-5" />}
          tone="info"
          status={`${training.current.activeDays}/${period} ngày tập`}
        />
        <KpiCard
          label="Calo tiêu hao ước tính"
          value={`${training.current.caloriesBurned} kcal`}
          helper={`TB ${Math.round(training.current.caloriesBurned / period)} kcal/ngày`}
          comparison={<ChangeLabel value={caloriesDelta} suffix=" kcal" />}
          icon={<Zap className="h-5 w-5" />}
          tone="warning"
          status={`${period} ngày`}
        />
        <KpiCard
          label="Cân nặng gần nhất"
          value={body.weight.latest !== null ? `${formatNumber(body.weight.latest, 1)} kg` : 'Chưa cập nhật'}
          helper={body.weight.change !== null ? `Đầu kỳ: ${formatNumber(body.weight.first, 1)} kg` : body.latestDate ? `Đo ngày ${getShortDate(getVietnamDateKey(new Date(body.latestDate)))}` : 'Hãy ghi nhận chỉ số'}
          comparison={<ChangeLabel value={body.weight.change} suffix=" kg" neutralTone />}
          icon={<Scale className="h-5 w-5" />}
          tone="ai"
          status={body.targetWeight ? `Mục tiêu ${formatNumber(body.targetWeight, 1)}kg` : 'Cơ thể'}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate('/exercises')} className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-2 text-xs font-black text-text-primary hover:border-accent">Ghi buổi tập <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => navigate('/diet-plan')} className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-2 text-xs font-black text-text-primary hover:border-accent">Ghi bữa ăn, nước uống <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => navigate('/profile/edit')} className="rounded-xl border border-border-primary bg-bg-secondary px-4 py-2 text-xs font-black text-text-primary hover:border-accent">Cập nhật cơ thể <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></button>
      </div>

      {/* Recent activity */}
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border-primary p-4 md:flex-row md:items-center md:justify-between md:px-6 md:py-4">
          <div>
            <h2 className="text-lg font-black text-text-primary">7 ngày gần nhất</h2>
            <p className="text-xs font-semibold text-text-secondary">Chọn một ngày để xem hoạt động đã ghi nhận. Tổng hợp phía trên theo {period} ngày.</p>
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
              const hasWorkout = day.completedWorkoutCount > 0 || day.completedSets > 0;
              const waterPercent = wellness.waterGoalMl ? Math.min(100, Math.round((day.waterMl / wellness.waterGoalMl) * 100)) : (day.waterMl > 0 ? 100 : 0);

              return (
                <button type="button" onClick={() => setSelectedDate(day.dateKey)} aria-pressed={selectedDay.dateKey === day.dateKey} aria-label={`${day.label} ${getShortDate(day.dateKey)}: ${day.completedWorkoutCount} bài tập, ${day.completedSets} hiệp, ${day.mealsCompleted} bữa ăn, ${day.waterMl} ml nước`}
                  key={day.dateKey}
                  className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition-all ${
                    selectedDay.dateKey === day.dateKey
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
                </button>
              );
            })}
          </div>
          <div className="mt-4 grid gap-2 rounded-xl border border-border-primary bg-bg-tertiary/40 p-3 text-xs font-semibold text-text-secondary sm:grid-cols-4" aria-live="polite">
            <span className="font-black text-text-primary">{selectedDay.label} {getShortDate(selectedDay.dateKey)}</span>
            <span>{selectedDay.completedWorkoutCount}/{selectedDay.plannedWorkouts} bài tập · {selectedDay.completedSets} hiệp</span>
            <span>{selectedDay.mealsCompleted} bữa ăn · {selectedDay.caloriesConsumed} kcal</span>
            <span>{formatNumber(selectedDay.waterMl)} ml nước · {formatNumber(selectedDay.sleepHours, 1)} giờ ngủ</span>
          </div>
        </div>

        {/* Bottom Averages Bar */}
        <div className="grid gap-px border-t border-border-primary bg-border-primary sm:grid-cols-3">
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <Droplets className="h-4 w-4 text-info" />
            <span>Nước TB {period} ngày: <strong className="text-text-primary">{formatNumber(averageWater / 1000, 1)}L/ngày</strong></span>
          </div>
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <BedDouble className="h-4 w-4 text-ai" />
            <span>Ngủ TB {period} ngày: <strong className="text-text-primary">{formatNumber(averageSleep, 1)}h/ngày</strong></span>
          </div>
          <div className="bg-bg-secondary px-4 py-2.5 text-xs font-bold text-text-secondary flex items-center justify-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            <span>Tổng calo đốt: <strong className="text-text-primary">{training.current.caloriesBurned} kcal</strong></span>
          </div>
        </div>
      </Panel>

      <Panel className="p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-lg font-black text-text-primary">Mức độ duy trì</h2><p className="text-xs font-semibold text-text-secondary">Số ngày có hoạt động hoặc đạt mục tiêu trong {period} ngày.</p></div>
          <p className="text-xs font-bold text-text-tertiary">So với {data.previousRangeLabel}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {habits.map((habit) => (
            <article key={habit.label} className="rounded-xl border border-border-primary bg-bg-tertiary/40 p-3.5">
              <div className="flex items-start justify-between gap-2"><p className="text-xs font-black text-text-secondary">{habit.label}</p><ChangeLabel value={habit.value - habit.previous} suffix=" ngày" /></div>
              <p className="mt-2 text-xl font-black text-text-primary">{habit.value}<span className="text-sm font-semibold text-text-tertiary">/{period} ngày</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-secondary" role="progressbar" aria-label={habit.label} aria-valuenow={habit.value} aria-valuemin={0} aria-valuemax={period}><div className={`h-full rounded-full ${habit.tone}`} style={{ width: `${(habit.value / period) * 100}%` }} /></div>
              <p className="mt-2 text-[11px] font-semibold text-text-tertiary">{habit.detail}</p>
            </article>
          ))}
        </div>
      </Panel>

      {/* Body Metrics & Strength Progress (2 Column Layout) */}
      <div className="grid gap-4 xl:grid-cols-2">
        {/* Body Metrics Card */}
        <Panel className="p-4 md:p-5">
          <div className="flex items-center justify-between border-b border-border-primary pb-3">
            <div>
              <h2 className="text-lg font-black text-text-primary">Chỉ số cơ thể</h2>
              <p className="text-xs font-semibold text-text-secondary">Giá trị gần nhất; mức thay đổi tính từ các lần đo trong {period} ngày. Cần ít nhất hai lần đo để so sánh.</p>
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
              progress={null}
              tone="ai"
            />
            <MetricMiniCard
              label="Tỷ lệ mỡ"
              value={body.bodyFat.latest}
              unit="%"
              trend={body.bodyFat.change}
              icon={<Activity className="h-4 w-4" />}
              progress={null}
              tone="warning"
            />
            <MetricMiniCard
              label="Vòng eo"
              value={body.waist.latest}
              unit="cm"
              trend={body.waist.change}
              icon={<Ruler className="h-4 w-4" />}
              progress={null}
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
              <h2 className="text-lg font-black text-text-primary">Tiến bộ sức mạnh</h2>
              <p className="text-xs font-semibold text-text-secondary">Mức tạ tốt nhất và số hiệp trong {period} ngày, so với {period} ngày trước.</p>
            </div>
            <Medal className="h-5 w-5 text-warning" />
          </div>

          {training.exercises.length === 0 ? (
            <div className="mt-6 text-center py-6">
              <Dumbbell className="mx-auto h-7 w-7 text-text-tertiary/60" />
              <p className="mt-2 text-xs font-semibold text-text-secondary">Chưa có bài tập được ghi nhận trong kỳ này.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {training.exercises.map((exercise) => {
                const hasWeights = exercise.currentBest !== null && exercise.previousBest !== null;
                const improvement = hasWeights && exercise.previousBest
                  ? ((exercise.currentBest! - exercise.previousBest) / exercise.previousBest) * 100
                  : exercise.previousSets > 0 ? ((exercise.currentSets - exercise.previousSets) / exercise.previousSets) * 100 : null;
                const improved = improvement !== null && improvement >= 5;

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
                      {improved && (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-black uppercase text-warning">
                          +{formatNumber(improvement, 0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {training.muscleGroups.length > 0 && (
            <div className="mt-5 border-t border-border-primary pt-4">
              <p className="mb-3 text-xs font-black text-text-secondary">Nhóm cơ theo số hiệp đã hoàn thành</p>
              <div className="space-y-2">
                {training.muscleGroups.map((group) => (
                  <div key={group.label} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-2 text-xs font-semibold text-text-secondary">
                    <span>{group.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary" role="img" aria-label={`${group.label}: ${group.count} hiệp`}><div className="h-full rounded-full bg-warning" style={{ width: `${(group.count / training.muscleGroups[0].count) * 100}%` }} /></div>
                    <strong className="text-right text-text-primary">{group.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Data-driven coaching prompt */}
      {!insightDismissed ? (
        <section className="relative overflow-hidden rounded-2xl border border-ai/20 bg-bg-secondary p-4 md:p-5 shadow-[var(--app-shadow-soft)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai/15 text-ai">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-ai">Gợi ý từ dữ liệu tiến độ</p>
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
          Hiện gợi ý tiến độ
        </button>
      )}
    </div>
  );
}
