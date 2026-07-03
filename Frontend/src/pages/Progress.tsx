import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  CalendarDays,
  Dumbbell,
  Minus,
  Ruler,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const PERIOD_DAYS = 7;
const BODY_HISTORY_LIMIT = 30;

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
  exercises?: ExerciseMeta | ExerciseMeta[] | null;
};

type BodyMetricRow = {
  weight: number | null;
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
};

type ExerciseProgress = {
  id: string;
  name: string;
  muscle: string;
  currentWeight: number | null;
  previousWeight: number | null;
  currentSets: number;
  previousSets: number;
};

type ProgressData = {
  currentRangeLabel: string;
  previousRangeLabel: string;
  body: {
    weight: BodyTrend;
    bodyFat: BodyTrend;
    waist: BodyTrend;
  };
  training: {
    current: TrainingPeriod;
    previous: TrainingPeriod;
    days: Array<{
      dateKey: string;
      label: string;
      dayNumber: string;
      completedExercises: number;
      completedSets: number;
    }>;
    muscleGroups: Array<{ label: string; count: number }>;
    exercises: ExerciseProgress[];
  };
};

type ProgressCacheEntry = {
  data: ProgressData;
};

const progressCache = new Map<string, ProgressCacheEntry>();

function getVietnamDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
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
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toLocaleString('vi-VN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function normalizeExerciseMeta(value: WorkoutRow['exercises']): ExerciseMeta | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function getCompletedSets(row: WorkoutRow): number {
  const completedSets = Math.max(0, Number(row.completed_sets || 0));
  if (completedSets > 0) return completedSets;
  if (!row.is_completed) return 0;
  return Math.max(0, Number(row.actual_sets ?? row.sets ?? 0));
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

  periodRows.forEach((row) => {
    const rowSets = getCompletedSets(row);
    if (row.is_completed) completedExercises += 1;
    if (row.is_completed || rowSets > 0) activeDates.add(row.log_date);
    completedSets += rowSets;
  });

  const plannedExercises = periodRows.length;
  return {
    activeDays: activeDates.size,
    completedExercises,
    completedSets,
    plannedExercises,
    completionRate: plannedExercises > 0 ? Math.round((completedExercises / plannedExercises) * 100) : 0,
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
    const inCurrentPeriod = currentDateSet.has(row.log_date);
    const inPreviousPeriod = previousDateSet.has(row.log_date);
    if (!inCurrentPeriod && !inPreviousPeriod) return;

    const completedSets = getCompletedSets(row);
    if (!row.is_completed && completedSets === 0) return;

    const meta = normalizeExerciseMeta(row.exercises);
    const id = String(row.exercise_id || meta?.name || 'unknown');
    const existing = exerciseMap.get(id) || {
      id,
      name: String(meta?.name || 'Bài tập'),
      muscle: String(meta?.target_muscle || meta?.body_part || ''),
      currentWeight: null,
      previousWeight: null,
      currentSets: 0,
      previousSets: 0,
    };
    const weight = toPositiveNumber(row.actual_weight_kg) ?? toPositiveNumber(row.weight_kg);

    if (inCurrentPeriod) {
      existing.currentSets += completedSets;
      if (weight !== null) existing.currentWeight = Math.max(existing.currentWeight || 0, weight);
    } else {
      existing.previousSets += completedSets;
      if (weight !== null) existing.previousWeight = Math.max(existing.previousWeight || 0, weight);
    }
    exerciseMap.set(id, existing);
  });

  return [...exerciseMap.values()]
    .filter((exercise) => exercise.currentSets > 0 || exercise.currentWeight !== null)
    .sort((a, b) => {
      const weightDeltaA = (a.currentWeight || 0) - (a.previousWeight || 0);
      const weightDeltaB = (b.currentWeight || 0) - (b.previousWeight || 0);
      if (weightDeltaA !== weightDeltaB) return weightDeltaB - weightDeltaA;
      return b.currentSets - a.currentSets;
    })
    .slice(0, 6);
}

function buildProgressData(input: {
  currentDateKeys: string[];
  previousDateKeys: string[];
  workouts: WorkoutRow[];
  bodyMetrics: BodyMetricRow[];
}): ProgressData {
  const { currentDateKeys, previousDateKeys, workouts, bodyMetrics } = input;
  const sortedBodyMetrics = [...bodyMetrics]
    .filter((row) => row.created_at)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const weight = buildBodyTrend(sortedBodyMetrics, (row) => row.weight);
  const bodyFat = buildBodyTrend(sortedBodyMetrics, (row) => row.body_fat ?? row.body_fat_percentage);
  const waist = buildBodyTrend(sortedBodyMetrics, (row) => row.waist);

  const currentDateSet = new Set(currentDateKeys);
  const days = currentDateKeys.map((dateKey) => {
    const rows = workouts.filter((row) => row.log_date === dateKey);
    return {
      dateKey,
      label: getWeekdayLabel(dateKey),
      dayNumber: dateKey.slice(-2),
      completedExercises: rows.filter((row) => row.is_completed).length,
      completedSets: rows.reduce((sum, row) => sum + getCompletedSets(row), 0),
    };
  });

  const muscleTotals: Record<string, number> = {};
  workouts.forEach((row) => {
    if (!currentDateSet.has(row.log_date) || !row.is_completed) return;
    const exercise = normalizeExerciseMeta(row.exercises);
    const label = String(exercise?.target_muscle || exercise?.body_part || '').trim();
    if (label) muscleTotals[label] = (muscleTotals[label] || 0) + 1;
  });

  return {
    currentRangeLabel: formatRange(currentDateKeys),
    previousRangeLabel: formatRange(previousDateKeys),
    body: {
      weight,
      bodyFat,
      waist,
    },
    training: {
      current: buildTrainingPeriod(workouts, currentDateKeys),
      previous: buildTrainingPeriod(workouts, previousDateKeys),
      days,
      muscleGroups: Object.entries(muscleTotals)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      exercises: buildExerciseProgress(workouts, currentDateKeys, previousDateKeys),
    },
  };
}

function DeltaValue({
  value,
  unit,
  digits = 0,
  suffix = '',
}: {
  value: number | null;
  unit?: string;
  digits?: number;
  suffix?: string;
}) {
  if (value === null) {
    return <span className="text-sm font-bold text-text-tertiary">Chưa đủ dữ liệu so sánh</span>;
  }

  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-black ${value === 0 ? 'text-text-tertiary' : 'text-accent'}`}>
      <Icon className="h-4 w-4" />
      {value > 0 ? '+' : ''}
      {formatNumber(value, digits)}
      {unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}
      {suffix}
    </span>
  );
}

type ProgressRowTone = 'accent' | 'info' | 'ai' | 'warning';

const progressRowStyles: Record<ProgressRowTone, { icon: string; bar: string }> = {
  accent: {
    icon: 'bg-accent/10 text-accent',
    bar: 'bg-accent',
  },
  info: {
    icon: 'bg-info/10 text-info',
    bar: 'bg-info',
  },
  ai: {
    icon: 'bg-ai/10 text-ai',
    bar: 'bg-ai',
  },
  warning: {
    icon: 'bg-warning/10 text-warning',
    bar: 'bg-warning',
  },
};

function ProgressIndicatorRow({
  label,
  current,
  previous,
  unit,
  digits = 0,
  scale,
  icon,
  tone,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  unit: string;
  digits?: number;
  scale?: number;
  icon: ReactNode;
  tone: ProgressRowTone;
}) {
  const styles = progressRowStyles[tone];
  const maxValue = Math.max(1, Number(scale || 0), Number(current || 0), Number(previous || 0));
  const currentPercent = current === null ? 0 : Math.min(100, Math.max(0, (current / maxValue) * 100));
  const previousPercent = previous === null ? null : Math.min(100, Math.max(0, (previous / maxValue) * 100));
  const delta = current !== null && previous !== null ? Number((current - previous).toFixed(digits)) : null;
  const currentLabel = current === null ? '--' : `${formatNumber(current, digits)}${unit === '%' ? '%' : ` ${unit}`}`;
  const previousLabel = previous === null ? '--' : `${formatNumber(previous, digits)}${unit === '%' ? '%' : ` ${unit}`}`;

  return (
    <div className="progress-indicator-row py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}>{icon}</span>
          <div>
            <p className="text-sm font-black text-text-primary">{label}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-text-tertiary">Mốc trước: {previousLabel}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <p className="text-xl font-black text-text-primary">{currentLabel}</p>
          {delta === null ? (
            <span className="text-xs font-bold text-text-tertiary">Chưa đủ mốc</span>
          ) : (
            <DeltaValue value={delta} unit={unit} digits={digits} />
          )}
        </div>
      </div>
      <div className="relative mt-3 h-2.5 overflow-visible rounded-full bg-bg-tertiary">
        <div className={`h-full rounded-full transition-[width] ${styles.bar}`} style={{ width: `${currentPercent}%` }} />
        {previousPercent !== null && (
          <span
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary shadow-[0_0_0_2px_var(--bg-secondary)]"
            style={{ left: `${previousPercent}%` }}
            title={`Mốc trước: ${previousLabel}`}
          />
        )}
      </div>
    </div>
  );
}

function ExerciseProgressRow({ exercise }: { exercise: ExerciseProgress }) {
  const hasWeightComparison = exercise.currentWeight !== null && exercise.previousWeight !== null;
  const weightChange = hasWeightComparison
    ? Number((exercise.currentWeight! - exercise.previousWeight!).toFixed(1))
    : null;
  const setChange = exercise.currentSets - exercise.previousSets;

  return (
    <div className="progress-exercise-row grid gap-3 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] md:items-center">
      <div>
        <p className="text-sm font-black text-text-primary">{exercise.name}</p>
        <p className="mt-1 text-xs font-semibold text-text-tertiary">{exercise.muscle || 'Chưa phân loại nhóm cơ'}</p>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary md:hidden">7 ngày trước</p>
        <p className="mt-1 text-sm font-semibold text-text-secondary md:mt-0">
          {exercise.previousWeight !== null ? `${formatNumber(exercise.previousWeight, 1)} kg · ` : ''}
          {exercise.previousSets} set
        </p>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary md:hidden">7 ngày này</p>
        <p className="mt-1 text-sm font-black text-text-primary md:mt-0">
          {exercise.currentWeight !== null ? `${formatNumber(exercise.currentWeight, 1)} kg · ` : ''}
          {exercise.currentSets} set
        </p>
      </div>
      <div className="md:text-right">
        {hasWeightComparison ? (
          <DeltaValue value={weightChange} unit="kg" digits={1} />
        ) : exercise.currentWeight !== null && exercise.previousWeight === null ? (
          <span className="text-sm font-black text-info">Mới ghi nhận mức tạ</span>
        ) : (
          <DeltaValue value={setChange} unit="set" />
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  eyebrow,
  title,
  helper,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  helper: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-text-tertiary">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-black text-text-primary">{title}</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">{helper}</p>
      </div>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div className="dashboard-page-shell animate-pulse pb-6">
      <div className="border-b border-border-primary pb-5">
        {SkeletonBlock('h-7 w-56 rounded-xl')}
        {SkeletonBlock('mt-3 h-4 w-96 max-w-full rounded-lg')}
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="border-b border-border-primary py-6">
          <SkeletonSurface className="rounded-xl p-5">
            {SkeletonBlock('h-5 w-52 rounded-lg')}
            {SkeletonBlock('mt-5 h-12 w-full rounded-xl')}
            {SkeletonBlock('mt-3 h-12 w-full rounded-xl')}
            {SkeletonBlock('mt-3 h-12 w-full rounded-xl')}
          </SkeletonSurface>
        </div>
      ))}
    </div>
  );
}

export default function Progress() {
  const { user, isLoggedIn, refreshTick } = useAuth();
  const todayKey = getVietnamDateKey();
  const cacheKey = user?.id ? `${user.id}:${todayKey}:comparison` : null;
  const cachedData = cacheKey ? progressCache.get(cacheKey)?.data || null : null;
  const [data, setData] = useState<ProgressData | null>(cachedData);
  const [loading, setLoading] = useState(!cachedData);
  const [errorMessage, setErrorMessage] = useState('');

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

      const currentDateKeys = buildDateKeys(todayKey, PERIOD_DAYS);
      const previousDateKeys = buildDateKeys(addDays(currentDateKeys[0], -1), PERIOD_DAYS);
      const fetchStartKey = previousDateKeys[0];
      if (!data) setLoading(true);
      setErrorMessage('');

      try {
        const [workoutsRes, bodyMetricsRes] = await Promise.all([
          supabase
            .from('daily_exercise_sessions')
            .select('exercise_id, log_date, is_completed, sets, actual_sets, completed_sets, weight_kg, actual_weight_kg, exercises:exercise_id(name, target_muscle, body_part)')
            .eq('user_id', user.id)
            .gte('log_date', fetchStartKey)
            .lte('log_date', todayKey),
          supabase
            .from('body_metrics')
            .select('weight, body_fat, body_fat_percentage, waist, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(BODY_HISTORY_LIMIT),
        ]);

        const firstError = [workoutsRes.error, bodyMetricsRes.error].find(Boolean);
        if (firstError) throw firstError;

        const nextData = buildProgressData({
          currentDateKeys,
          previousDateKeys,
          workouts: (workoutsRes.data || []) as WorkoutRow[],
          bodyMetrics: (bodyMetricsRes.data || []) as BodyMetricRow[],
        });

        if (mounted) {
          setData(nextData);
          if (cacheKey) progressCache.set(cacheKey, { data: nextData });
        }
      } catch (error) {
        console.error('Không thể tải trang tiến độ:', error);
        if (mounted) setErrorMessage('Không thể cập nhật dữ liệu tiến độ. Vui lòng thử lại sau.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void fetchProgress();
    return () => {
      mounted = false;
    };
  }, [user, isLoggedIn, refreshTick, cacheKey, todayKey]);

  if (loading && !data) return <ProgressSkeleton />;
  if (!data) {
    return (
      <div className="dashboard-page-shell pb-6">
        <p className="text-sm font-semibold text-text-secondary">{errorMessage || 'Chưa có dữ liệu tiến độ để hiển thị.'}</p>
      </div>
    );
  }

  const { body, training } = data;
  const hasCurrentTraining = training.current.activeDays > 0 || training.current.completedSets > 0;
  const hasPreviousTraining = training.previous.activeDays > 0 || training.previous.completedSets > 0;
  const maxDaySets = Math.max(1, ...training.days.map((day) => day.completedSets));
  const maxMuscleCount = Math.max(1, ...training.muscleGroups.map((group) => group.count));

  return (
    <div className="progress-index-page dashboard-page-shell flex flex-col gap-4 pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <header className="progress-index-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-accent">Tiến độ cá nhân</p>
          <h1 className="mt-1 text-2xl font-black text-text-primary md:text-3xl">Các chỉ số tiến độ</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-text-secondary">
            Những thay đổi quan trọng nhất về hình thể và hiệu suất tập luyện.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border-primary px-3 py-2 text-xs font-bold text-text-secondary">
          <CalendarDays className="h-4 w-4 text-accent" />
          {data.currentRangeLabel}
        </div>
      </header>
      {errorMessage && <p className="text-sm font-bold text-warning">{errorMessage}</p>}

      <section className="progress-bars-panel rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-[0_14px_36px_rgba(0,0,0,0.08)] md:p-6">
        <div className="flex flex-col gap-2 border-b border-border-primary pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Hình thể</p>
            <h2 className="mt-1 text-xl font-black text-text-primary">Thay đổi chỉ số cơ thể</h2>
          </div>
          <p className="text-xs font-semibold text-text-tertiary">Vạch đứng biểu thị mốc đo trước</p>
        </div>
        <div className="divide-y divide-border-primary">
          <ProgressIndicatorRow
            label="Cân nặng"
            current={body.weight.latest}
            previous={body.weight.first}
            unit="kg"
            digits={1}
            icon={<Scale className="h-4 w-4" />}
            tone="ai"
          />
          <ProgressIndicatorRow
            label="Tỷ lệ mỡ"
            current={body.bodyFat.latest}
            previous={body.bodyFat.first}
            unit="%"
            digits={1}
            icon={<Activity className="h-4 w-4" />}
            tone="warning"
          />
          <ProgressIndicatorRow
            label="Vòng eo"
            current={body.waist.latest}
            previous={body.waist.first}
            unit="cm"
            digits={1}
            icon={<Ruler className="h-4 w-4" />}
            tone="info"
          />
        </div>

        <div className="mt-3 border-y border-border-primary py-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Tập luyện</p>
          <h2 className="mt-1 text-xl font-black text-text-primary">Tiến độ so với 7 ngày trước</h2>
        </div>
        <div className="divide-y divide-border-primary">
          <ProgressIndicatorRow
            label="Tỷ lệ hoàn thành"
            current={training.current.completionRate}
            previous={training.previous.completionRate}
            unit="%"
            scale={100}
            icon={<Target className="h-4 w-4" />}
            tone="accent"
          />
          <ProgressIndicatorRow
            label="Ngày có tập"
            current={training.current.activeDays}
            previous={training.previous.activeDays}
            unit="ngày"
            scale={7}
            icon={<CalendarDays className="h-4 w-4" />}
            tone="info"
          />
          <ProgressIndicatorRow
            label="Bài hoàn thành"
            current={training.current.completedExercises}
            previous={training.previous.completedExercises}
            unit="bài"
            scale={Math.max(training.current.plannedExercises, training.previous.plannedExercises)}
            icon={<Activity className="h-4 w-4" />}
            tone="warning"
          />
          <ProgressIndicatorRow
            label="Set hoàn thành"
            current={training.current.completedSets}
            previous={training.previous.completedSets}
            unit="set"
            icon={<Dumbbell className="h-4 w-4" />}
            tone="accent"
          />
        </div>
      </section>

      <section className="progress-detail-card rounded-2xl border border-border-primary bg-bg-secondary p-4 shadow-[0_14px_36px_rgba(0,0,0,0.08)] md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading
            icon={<Dumbbell className="h-4 w-4" />}
            eyebrow="Chi tiết tập luyện"
            title="Nhịp tập 7 ngày gần nhất"
            helper={`${data.currentRangeLabel} · So với kỳ trước ${data.previousRangeLabel}.`}
          />
          <span className="text-xs font-bold text-text-tertiary">
            {training.current.completedExercises} bài · {training.current.completedSets} set
          </span>
        </div>

        {hasCurrentTraining ? (
          <div className="progress-detail-layout mt-5 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Số set theo ngày</p>
                <p className="text-xs font-semibold text-text-tertiary">Đơn vị: set</p>
              </div>
              <div className="progress-day-chart mt-4 grid h-40 grid-cols-7 items-end gap-2">
                {training.days.map((day) => {
                  const active = day.completedSets > 0;
                  const height = active ? Math.max(14, (day.completedSets / maxDaySets) * 100) : 5;
                  return (
                    <div key={day.dateKey} className="flex h-full min-w-0 flex-col items-center justify-end">
                      <p className="mb-2 text-[10px] font-black text-text-secondary">{active ? day.completedSets : '—'}</p>
                      <div className="flex h-24 w-full max-w-8 items-end overflow-hidden rounded-full bg-bg-tertiary">
                        <div
                          className={`w-full rounded-full ${active ? 'bg-accent' : 'bg-border-primary'}`}
                          style={{ height: `${height}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[10px] font-black uppercase text-text-tertiary">{day.label}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:border-l lg:border-border-primary lg:pl-6">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-text-tertiary">Phân bổ nhóm cơ</p>
              {training.muscleGroups.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {training.muscleGroups.slice(0, 5).map((group) => (
                    <div key={group.label}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="font-bold text-text-secondary">{group.label}</span>
                        <span className="font-black text-text-primary">{group.count} bài</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
                        <div className="h-full rounded-full bg-info" style={{ width: `${(group.count / maxMuscleCount) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm font-semibold text-text-secondary">Chưa có dữ liệu nhóm cơ.</p>
              )}
            </div>
          </div>
        ) : !hasPreviousTraining ? (
          <p className="mt-5 border-t border-border-primary pt-5 text-sm font-semibold text-text-secondary">
            Chưa có buổi tập trong hai giai đoạn để hiển thị tiến độ.
          </p>
        ) : null}
      </section>

      <section className="progress-detail-card progress-detail-card--flush overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary shadow-[0_14px_36px_rgba(0,0,0,0.08)]">
        <div className="border-b border-border-primary p-4 md:p-6">
          <SectionHeading
            icon={<Trophy className="h-4 w-4" />}
            eyebrow="Tiến độ sức mạnh"
            title="Tiến bộ theo từng bài"
            helper="Mức tạ cao nhất và số set cho thấy khả năng vận động đã thay đổi như thế nào."
          />
        </div>

        {training.exercises.length > 0 ? (
          <div className="px-4 pb-4 md:px-6 md:pb-5">
            <div className="progress-exercise-header hidden grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-3 border-b border-border-primary py-3 md:grid">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Bài tập</p>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Mốc trước</p>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Hiện tại</p>
              <p className="text-right text-[10px] font-black uppercase tracking-[0.12em] text-text-tertiary">Tiến triển</p>
            </div>
            <div className="divide-y divide-border-primary">
              {training.exercises.map((exercise) => (
                <ExerciseProgressRow key={exercise.id} exercise={exercise} />
              ))}
            </div>
          </div>
        ) : (
          <p className="px-4 py-6 text-sm font-semibold text-text-secondary md:px-6">
            Hoàn thành ít nhất một bài tập để ghi nhận dấu mốc sức mạnh.
          </p>
        )}
      </section>
    </div>
  );
}
