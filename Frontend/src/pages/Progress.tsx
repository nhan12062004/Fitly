import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  BedDouble,
  BrainCircuit,
  CalendarDays,
  Check,
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

type ProgressRange = '7d' | '30d' | 'month';

const RANGE_OPTIONS: Array<{ value: ProgressRange; label: string }> = [
  { value: '7d', label: '7 ngày gần nhất' },
  { value: '30d', label: '30 ngày gần nhất' },
  { value: 'month', label: 'Tháng này' },
];

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
    .slice(0, 6);
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
    weightedScores.push({ value: training.completionRate, weight: 30 });
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
    weightedScores.push({ value: sleepScore * 100, weight: 20 });
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
    .slice(0, 6);
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
    <article className="min-w-0 rounded-2xl border border-border-primary bg-bg-secondary/85 p-4 shadow-[var(--app-shadow-soft)] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl border ${styles}`}>{icon}</span>
        <span className="rounded-full border border-border-primary bg-bg-tertiary px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-text-secondary">
          {status}
        </span>
      </div>
      <p className="mt-4 text-xs font-black uppercase tracking-[0.12em] text-text-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-black text-text-primary">{value}</p>
      <div className="mt-3 flex min-h-8 items-end justify-between gap-2 border-t border-border-primary pt-3">
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
    <article className="rounded-xl border border-border-primary bg-bg-tertiary/45 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-bg-secondary text-text-secondary">{icon}</span>
        <ChangeLabel value={trend} suffix={unit === '%' ? '%' : ` ${unit}`} inverse />
      </div>
      <p className="mt-4 text-xs font-bold text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-black text-text-primary">
        {value === null ? 'Chưa cập nhật' : formatNumber(value, 1)}
        {value !== null && <span className="ml-1 text-xs text-text-tertiary">{unit}</span>}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress ?? 0}%` }} />
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
          <SkeletonSurface key={item} className="h-44 rounded-2xl p-5">
            {SkeletonBlock('h-10 w-10 rounded-xl')}
            {SkeletonBlock('mt-5 h-6 w-28 rounded-lg')}
            {SkeletonBlock('mt-3 h-4 w-full rounded-lg')}
          </SkeletonSurface>
        ))}
      </div>
    </div>
  );
}

function getRangeDateKeys(todayKey: string, range: ProgressRange): string[] {
  if (range === '30d') return buildDateKeys(todayKey, 30);
  if (range === 'month') return buildDateKeys(todayKey, Number(todayKey.slice(-2)));
  return buildDateKeys(todayKey, 7);
}

export default function Progress() {
  const { user, isLoggedIn, refreshTick } = useAuth();
  const navigate = useNavigate();
  const todayKey = getVietnamDateKey();
  const [selectedRange, setSelectedRange] = useState<ProgressRange>('7d');
  const cacheKey = user?.id ? `${user.id}:${todayKey}:dashboard-v3:${selectedRange}` : null;
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

      const currentDateKeys = getRangeDateKeys(todayKey, selectedRange);
      const previousDateKeys = buildDateKeys(addDays(currentDateKeys[0], -1), currentDateKeys.length);
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
        if (mounted) setErrorMessage('Không thể cập nhật đầy đủ các chỉ số. Fitly đang hiển thị dữ liệu gần nhất.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void fetchProgress();
    return () => {
      mounted = false;
    };
  }, [user, isLoggedIn, refreshTick, cacheKey, todayKey, selectedRange]);

  const insight = useMemo(() => {
    if (!data) return '';
    const { current } = data.training;
    const weakestMuscle = [...data.training.muscleGroups]
      .sort((a, b) => a.count - b.count)[0]?.label;
    if (!data.hasActivityData) {
      return 'Chưa có đủ dữ liệu để Fitly đưa ra nhận xét. Hãy ghi nhận thêm hoạt động trong vài ngày tới.';
    }
    if (current.activeDays === 0 && data.training.days.every((day) => day.waterMl === 0 && day.sleepHours === 0 && !day.mealLogged)) {
      return 'Chưa có đủ dữ liệu để đưa ra nhận xét. Hãy hoàn thành một hoạt động hôm nay để bắt đầu.';
    }
    if (current.completionRate >= 80) {
      return `Một tuần rất tốt: bạn đã hoàn thành ${current.completedExercises} bài trong ${current.activeDays} ngày vận động.${weakestMuscle ? ` Nhóm ${weakestMuscle} có khối lượng thấp nhất, bạn có thể thêm một buổi nhẹ để cân bằng hơn.` : ''}`;
    }
    return `Bạn đã hoàn thành ${current.completedExercises}/${current.plannedExercises} bài theo kế hoạch. Hãy giữ buổi tập tiếp theo ngắn gọn và rõ mục tiêu để lấy lại nhịp mà không khiến tuần này quá tải.`;
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
  const maxMuscle = Math.max(1, ...training.muscleGroups.map((group) => group.count));
  const activityDays = training.days.slice(-7);
  const averageWater = activityDays.reduce((sum, day) => sum + day.waterMl, 0) / Math.max(1, activityDays.length);
  const averageSleep = activityDays.reduce((sum, day) => sum + day.sleepHours, 0) / Math.max(1, activityDays.length);

  return (
    <div className="dashboard-page-shell flex flex-col gap-4 pb-6 md:gap-5">
      <header className="flex flex-col gap-4 border-b border-border-primary pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-accent">
            <CircleGauge className="h-4 w-4" />
            Tổng quan hiệu suất
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-text-primary">Tiến độ</h1>
          <p className="mt-1.5 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
            Theo dõi sự đều đặn, chỉ số cơ thể và tiến bộ tập luyện của bạn.
          </p>
        </div>
        <label className="inline-flex h-11 w-fit items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-primary" title={`So với giai đoạn ${data.previousRangeLabel}`}>
          <CalendarDays className="h-4 w-4 text-accent" />
          <select
            value={selectedRange}
            onChange={(event) => {
              setData(null);
              setSelectedRange(event.target.value as ProgressRange);
            }}
            className="bg-transparent text-sm font-black text-text-primary outline-none"
            aria-label="Chọn khoảng thời gian"
          >
            {RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="hidden text-xs text-text-tertiary sm:inline">{data.currentRangeLabel}</span>
        </label>
      </header>

      {errorMessage && (
        <p className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm font-bold text-warning">{errorMessage}</p>
      )}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Điểm tiến độ tuần"
          value={wellness.score === null ? 'Chưa đủ dữ liệu' : `${wellness.score}/100`}
          helper={wellness.previousScore === null ? 'Chưa có dữ liệu giai đoạn trước' : `Giai đoạn trước: ${wellness.previousScore} điểm`}
          comparison={<ChangeLabel value={scoreDelta} suffix=" điểm" />}
          icon={<CircleGauge className="h-5 w-5" />}
          tone="accent"
          status={scoreDelta === null ? 'Chưa đủ dữ liệu' : scoreDelta > 0 ? 'Đang cải thiện' : scoreDelta === 0 ? 'Ổn định' : 'Cần chú ý'}
        />
        <KpiCard
          label="Chuỗi ngày hiện tại"
          value={`${wellness.streak} ngày`}
          helper={data.hasActivityData ? (wellness.streak > 1 ? 'Số ngày lành mạnh liên tiếp' : 'Một hành động nhỏ sẽ tạo đà') : 'Chưa có hoạt động để tính chuỗi ngày'}
          comparison={<ChangeLabel value={data.hasActivityData ? wellness.streak - wellness.previousStreak : null} suffix=" ngày" />}
          icon={<Flame className="h-5 w-5" />}
          tone="warning"
          status={!data.hasActivityData ? 'Chưa đủ dữ liệu' : wellness.streak >= 3 ? 'Làm rất tốt' : 'Đang xây dựng'}
        />
        <KpiCard
          label="Mức độ hoàn thành buổi tập"
          value={training.current.plannedExercises > 0 ? `${training.current.completionRate}%` : `${training.current.completedExercises} bài`}
          helper={training.current.plannedExercises > 0 ? `${training.current.completedExercises}/${training.current.plannedExercises} bài theo kế hoạch` : 'Chưa có bài tập được lên kế hoạch'}
          comparison={<ChangeLabel value={completionDelta} suffix="%" />}
          icon={<Dumbbell className="h-5 w-5" />}
          tone="info"
          status={training.current.plannedExercises === 0 ? 'Chưa đủ dữ liệu' : training.current.completionRate >= 75 ? 'Đang cải thiện' : 'Cần chú ý'}
        />
        <KpiCard
          label="Nhận xét từ AI"
          value={!data.hasActivityData ? 'Chưa đủ dữ liệu' : training.current.activeDays >= 4 ? 'Giai đoạn khá cân bằng' : 'Cần tạo thêm đà'}
          helper={`${training.current.activeDays} ngày vận động · ${training.current.completedSets} hiệp`}
          comparison={<ChangeLabel value={scoreDelta} suffix=" điểm" />}
          icon={<BrainCircuit className="h-5 w-5" />}
          tone="ai"
          status="AI Coach"
        />
      </section>

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border-primary p-4 md:flex-row md:items-end md:justify-between md:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-accent">Tổng quan hoạt động 7 ngày</p>
            <h2 className="mt-1 text-xl font-black text-text-primary">Nhịp vận động trong tuần</h2>
            <p className="mt-1 text-sm font-semibold text-text-secondary">Theo dõi tập luyện, calories, nước uống và giấc ngủ trong cùng một biểu đồ.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] font-bold text-text-secondary">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" />Tập luyện</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Calories</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-info" />Nước</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ai" />Giấc ngủ</span>
          </div>
        </div>
        <div className="p-4 md:p-6">
          <div className="hidden grid-cols-7 gap-2.5 md:grid">
            {activityDays.map((day, index) => {
              const workout = clampPercent(day.workoutPercent);
              const calories = clampPercent((day.caloriesBurned / 600) * 100);
              const water = wellness.waterGoalMl ? clampPercent((day.waterMl / wellness.waterGoalMl) * 100) : day.waterMl > 0 ? 100 : 0;
              const sleep = wellness.sleepGoal ? clampPercent((day.sleepHours / wellness.sleepGoal) * 100) : day.sleepHours > 0 ? 100 : 0;
              const isToday = index === activityDays.length - 1;
              return (
                <article key={day.dateKey} className={`rounded-xl border p-3 ${isToday ? 'border-accent/30 bg-accent/7' : 'border-border-primary bg-bg-tertiary/40'}`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-[11px] font-black uppercase ${isToday ? 'text-accent' : 'text-text-tertiary'}`}>{day.label}</p>
                    <span className="text-[10px] font-bold text-text-tertiary">{day.dayNumber}</span>
                  </div>
                  <div className="mt-4 flex h-28 items-end justify-center gap-1.5">
                    {[
                      ['bg-accent', workout],
                      ['bg-warning', calories],
                      ['bg-info', water],
                      ['bg-ai', sleep],
                    ].map(([color, height], barIndex) => (
                      <div key={barIndex} className="flex h-full w-2.5 items-end overflow-hidden rounded-full bg-bg-secondary">
                        <div className={`w-full rounded-full ${color}`} style={{ height: `${Math.max(5, Number(height))}%` }} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-center text-[10px] font-bold text-text-secondary">{day.caloriesBurned} kcal</p>
                </article>
              );
            })}
          </div>
          <div className="md:hidden">
            <div className="grid grid-cols-[2.4rem_repeat(4,minmax(0,1fr))] gap-2 px-1 pb-2 text-center text-[9px] font-black uppercase tracking-wide text-text-tertiary">
              <span />
              <span>Tập</span>
              <span>Kcal</span>
              <span>Nước</span>
              <span>Ngủ</span>
            </div>
            <div className="space-y-1.5">
              {activityDays.map((day, index) => {
                const metrics = [
                  { value: clampPercent(day.workoutPercent), color: 'bg-accent' },
                  { value: clampPercent((day.caloriesBurned / 600) * 100), color: 'bg-warning' },
                  { value: wellness.waterGoalMl ? clampPercent((day.waterMl / wellness.waterGoalMl) * 100) : day.waterMl > 0 ? 100 : 0, color: 'bg-info' },
                  { value: wellness.sleepGoal ? clampPercent((day.sleepHours / wellness.sleepGoal) * 100) : day.sleepHours > 0 ? 100 : 0, color: 'bg-ai' },
                ];
                const isToday = index === activityDays.length - 1;
                return (
                  <article key={day.dateKey} className={`grid grid-cols-[2.4rem_repeat(4,minmax(0,1fr))] items-center gap-2 rounded-xl border px-2 py-2.5 ${isToday ? 'border-accent/30 bg-accent/7' : 'border-border-primary bg-bg-tertiary/40'}`}>
                    <div>
                      <p className={`text-[10px] font-black ${isToday ? 'text-accent' : 'text-text-secondary'}`}>{day.label}</p>
                      <p className="text-[9px] font-bold text-text-tertiary">{day.dayNumber}</p>
                    </div>
                    {metrics.map((metric, metricIndex) => (
                      <div key={metricIndex} className="min-w-0">
                        <p className="mb-1 text-center text-[9px] font-black text-text-secondary">{metric.value}%</p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                          <div className={`h-full rounded-full ${metric.color}`} style={{ width: `${metric.value}%` }} />
                        </div>
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
        <div className="grid gap-px border-t border-border-primary bg-border-primary sm:grid-cols-3">
          <div className="bg-bg-secondary px-5 py-3 text-xs font-bold text-text-secondary"><Droplets className="mr-2 inline h-4 w-4 text-info" />Trung bình {formatNumber(averageWater / 1000, 1)} lít nước</div>
          <div className="bg-bg-secondary px-5 py-3 text-xs font-bold text-text-secondary"><BedDouble className="mr-2 inline h-4 w-4 text-ai" />Trung bình {formatNumber(averageSleep, 1)} giờ ngủ</div>
          <div className="bg-bg-secondary px-5 py-3 text-xs font-bold text-text-secondary"><Zap className="mr-2 inline h-4 w-4 text-warning" />Đã đốt {training.current.caloriesBurned} kcal</div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(19rem,0.7fr)]">
        <Panel className="p-4 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Chỉ số cơ thể</p>
              <h2 className="mt-1 text-xl font-black text-text-primary">Thay đổi nhỏ, được đo lường rõ ràng</h2>
            </div>
            <Scale className="h-5 w-5 text-ai" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <MetricMiniCard label="Cân nặng" value={body.weight.latest} unit="kg" trend={body.weight.change} icon={<Scale className="h-4 w-4" />} progress={body.goalProgress} tone="ai" />
            <MetricMiniCard label="Tỷ lệ mỡ cơ thể" value={body.bodyFat.latest} unit="%" trend={body.bodyFat.change} icon={<Activity className="h-4 w-4" />} progress={body.bodyFat.latest} tone="warning" />
            <MetricMiniCard label="Vòng eo" value={body.waist.latest} unit="cm" trend={body.waist.change} icon={<Ruler className="h-4 w-4" />} progress={body.waist.latest ? Math.min(100, body.waist.latest) : null} tone="info" />
            <MetricMiniCard label="Tiến độ mục tiêu" value={body.goalProgress} unit="%" trend={null} icon={<Target className="h-4 w-4" />} progress={body.goalProgress} tone="accent" />
          </div>
          <p className="mt-4 text-xs font-semibold text-text-tertiary">
            {body.targetWeight !== null ? `Cân nặng mục tiêu: ${formatNumber(body.targetWeight, 1)} kg` : 'Hãy thêm cân nặng mục tiêu trong hồ sơ để theo dõi tiến độ.'}
          </p>
          {body.weight.latest === null && body.bodyFat.latest === null && body.waist.latest === null && (
            <button type="button" onClick={() => navigate('/profile')} className="mt-4 inline-flex h-10 items-center justify-center rounded-xl border border-ai/25 bg-ai/10 px-4 text-sm font-black text-ai">
              Cập nhật chỉ số
            </button>
          )}
        </Panel>

        <Panel className="p-4 md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-info">Phân bổ nhóm cơ</p>
              <h2 className="mt-1 text-xl font-black text-text-primary">Mức độ cân bằng khi tập</h2>
            </div>
          </div>
          {training.muscleGroups.length > 0 ? (
            <div className="mt-5 space-y-3.5">
              {training.muscleGroups.map((group) => (
              <div key={group.label}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-bold text-text-secondary">{group.label}</span>
                  <span className="font-black text-text-primary">{group.count} hiệp</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-tertiary">
                  <div className="h-full rounded-full bg-info" style={{ width: `${(group.count / maxMuscle) * 100}%` }} />
                </div>
              </div>
              ))}
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-border-primary p-4 text-sm font-semibold text-text-secondary">
              Chưa có dữ liệu nhóm cơ trong giai đoạn này.
            </p>
          )}
        </Panel>
      </div>

      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border-primary p-4 sm:flex-row sm:items-end sm:justify-between md:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-warning">Tiến bộ sức mạnh</p>
            <h2 className="mt-1 text-xl font-black text-text-primary">Thành tích tốt nhất theo bài tập</h2>
            <p className="mt-1 text-sm font-semibold text-text-secondary">So sánh thành tích hiện tại với 7 ngày trước.</p>
          </div>
        </div>
        {training.exercises.length === 0 ? (
          <p className="m-4 rounded-xl border border-dashed border-border-primary p-5 text-sm font-semibold leading-6 text-text-secondary md:m-6">
            Chưa có dữ liệu sức mạnh. Hãy hoàn thành một buổi tập có ghi số lần lặp, số hiệp hoặc mức tạ.
          </p>
        ) : (
          <>
        <div className="hidden md:block">
          <div>
            <div className="grid grid-cols-[minmax(12rem,1.4fr)_1fr_1fr_1fr] gap-3 bg-bg-tertiary/45 px-5 py-3 text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary md:px-6">
              <span>Bài tập</span><span>Thành tích trước</span><span>Thành tích hiện tại</span><span className="text-right">Mức cải thiện</span>
            </div>
            <div className="divide-y divide-border-primary">
              {training.exercises.map((exercise) => {
                const hasWeights = exercise.currentBest !== null && exercise.previousBest !== null;
                const improvement = hasWeights && exercise.previousBest
                  ? ((exercise.currentBest! - exercise.previousBest) / exercise.previousBest) * 100
                  : exercise.previousSets > 0 ? ((exercise.currentSets - exercise.previousSets) / exercise.previousSets) * 100 : null;
                const isPr = improvement !== null && improvement >= 5;
                return (
                  <div key={exercise.id} className="grid grid-cols-[minmax(12rem,1.4fr)_1fr_1fr_1fr] items-center gap-3 px-5 py-4 md:px-6">
                    <div>
                      <p className="inline-flex items-center gap-2 text-sm font-black text-text-primary">
                        {exercise.name}
                        {isPr && <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-warning"><Medal className="h-3 w-3" />Kỷ lục mới</span>}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{exercise.muscle}</p>
                    </div>
                    <p className="text-sm font-semibold text-text-secondary">{exercise.previousBest !== null ? `${formatNumber(exercise.previousBest, 1)} kg` : `${exercise.previousSets} hiệp`}</p>
                    <p className="text-sm font-black text-text-primary">{exercise.currentBest !== null ? `${formatNumber(exercise.currentBest, 1)} kg` : `${exercise.currentSets} hiệp`}</p>
                    <div className="text-right"><ChangeLabel value={improvement !== null ? Number(improvement.toFixed(1)) : null} suffix="%" /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="divide-y divide-border-primary md:hidden">
          {training.exercises.map((exercise) => {
            const hasWeights = exercise.currentBest !== null && exercise.previousBest !== null;
            const improvement = hasWeights && exercise.previousBest
              ? ((exercise.currentBest! - exercise.previousBest) / exercise.previousBest) * 100
              : exercise.previousSets > 0 ? ((exercise.currentSets - exercise.previousSets) / exercise.previousSets) * 100 : null;
            const isPr = improvement !== null && improvement >= 5;
            return (
              <article key={exercise.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-text-primary">{exercise.name}</p>
                    <p className="mt-0.5 text-xs font-semibold text-text-tertiary">{exercise.muscle}</p>
                  </div>
                  {isPr && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-[9px] font-black uppercase text-warning"><Medal className="h-3 w-3" />Kỷ lục mới</span>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-bg-tertiary/60 p-2.5">
                    <p className="text-[9px] font-black uppercase tracking-wide text-text-tertiary">Trước đó</p>
                    <p className="mt-1 text-sm font-bold text-text-secondary">{exercise.previousBest !== null ? `${formatNumber(exercise.previousBest, 1)} kg` : `${exercise.previousSets} hiệp`}</p>
                  </div>
                  <div className="rounded-lg bg-bg-tertiary/60 p-2.5">
                    <p className="text-[9px] font-black uppercase tracking-wide text-text-tertiary">Hiện tại</p>
                    <p className="mt-1 text-sm font-black text-text-primary">{exercise.currentBest !== null ? `${formatNumber(exercise.currentBest, 1)} kg` : `${exercise.currentSets} hiệp`}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-text-secondary">Mức cải thiện</span>
                  <ChangeLabel value={improvement !== null ? Number(improvement.toFixed(1)) : null} suffix="%" />
                </div>
              </article>
            );
          })}
        </div>
          </>
        )}
      </Panel>

      {!insightDismissed ? (
        <section className="relative overflow-hidden rounded-2xl border border-ai/25 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.2),transparent_36%),var(--bg-secondary)] p-5 shadow-[var(--app-shadow-soft)] md:p-6">
          <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full border border-ai/15" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-3xl items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ai/15 text-ai"><BrainCircuit className="h-5 w-5" /></span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-ai">Nhận xét từ AI Coach</p>
                <h2 className="mt-1 text-lg font-black text-text-primary">Một điều chỉnh hữu ích cho tuần tới</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-text-secondary">{insight}</p>
              </div>
            </div>
            <div className="grid w-full shrink-0 gap-2 sm:flex sm:w-auto sm:flex-wrap lg:justify-end">
              <button type="button" onClick={() => navigate('/exercises')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-ai px-4 text-sm font-black text-white">
                <Check className="h-4 w-4" />Áp dụng gợi ý
              </button>
              <button type="button" onClick={() => navigate('/smart-planner')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ai/25 bg-ai/10 px-4 text-sm font-black text-ai">
                Hỏi AI Coach<ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setInsightDismissed(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-black text-text-secondary">
                <X className="h-4 w-4" />Bỏ qua
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => setInsightDismissed(false)} className="inline-flex w-fit items-center gap-2 text-sm font-black text-ai">
          <Sparkles className="h-4 w-4" />Hiện nhận xét tuần
        </button>
      )}
    </div>
  );
}
