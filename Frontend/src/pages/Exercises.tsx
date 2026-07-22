import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, AlertCircle, Calendar, ImageOff,
  Play, Eye, Moon, ChevronRight, Shield, RefreshCw, Check
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { type ExerciseDetailItem } from '../components/ExerciseDetailOverlay';
import { SkeletonBlock } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import SurveyForm from '../components/SurveyForm';
import {
  formatBodyPartLabel,
  formatDifficultyLabel as formatCatalogDifficultyLabel,
  formatEquipmentLabel,
  formatMovementPatternLabel,
  formatTargetMuscleLabel,
} from '../lib/exerciseCatalog';
import { estimateWorkoutDurationMinutes } from '../lib/workoutDuration';

interface SessionExercise {
  id: string;
  exercise_id: string;
  name: string;
  video_url: string;
  sets: number;
  reps: string;
  weight_kg: number | null;
  rest_seconds: number;
  order_index: number;
  is_completed: boolean;
  weekly_plan_exercise_id?: string | null;
  planned_sets?: number | null;
  planned_reps?: string | null;
  planned_weight_kg?: number | null;
  planned_rest_seconds?: number | null;
  actual_sets?: number | null;
  actual_reps?: string | null;
  actual_weight_kg?: number | null;
  actual_rest_seconds?: number | null;
  target_rpe?: number | null;
  estimated_kcal?: number | null;
  actual_kcal_estimated?: number | null;
  completed_sets?: number | null;
  load_adjustment_note?: string | null;
  exercises?: {
    name?: string;
    video_url?: string;
    target_muscle?: string;
    body_part?: string;
    equipment?: string;
    difficulty?: string;
    movement_pattern?: string;
    instructions?: unknown;
    secondary_muscles?: unknown;
    training_locations?: unknown;
    min_experience_months?: number | null;
    progression_level?: number | null;
    goal_type?: unknown;
    contraindications?: unknown;
    estimated_duration_seconds?: number | null;
    calories_per_minute?: number | null;
  } | null;
}

type CalendarDayStats = {
  planned: number;
  completed: number;
  isRestDay: boolean;
  hasDailySession: boolean;
  hasWeeklyPlan: boolean;
};

type MonthlyPlanSummary = {
  id: string;
  week_start_date: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type WorkoutPlanQuota = {
  used: number;
  limit: number;
};

type CachedWorkoutPlanQuota = WorkoutPlanQuota & {
  userId: string;
};

const getWorkoutPlanQuotaCacheKey = (userId: string) => `fitly:workout-plan-quota:${userId}`;

const readCachedWorkoutPlanQuota = (userId?: string): WorkoutPlanQuota | null => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(getWorkoutPlanQuotaCacheKey(userId)) || 'null') as CachedWorkoutPlanQuota | null;
    if (!cached || cached.userId !== userId) return null;
    const used = Number(cached.used);
    const limit = Number(cached.limit);
    return Number.isFinite(used) && Number.isFinite(limit)
      ? { used: Math.max(0, used), limit: Math.max(0, limit) }
      : null;
  } catch {
    return null;
  }
};

const cacheWorkoutPlanQuota = (userId: string | undefined, quota: WorkoutPlanQuota) => {
  if (!userId || typeof window === 'undefined') return;
  window.localStorage.setItem(getWorkoutPlanQuotaCacheKey(userId), JSON.stringify({ userId, ...quota }));
};

const EMPTY_DAY_STATS: CalendarDayStats = {
  planned: 0,
  completed: 0,
  isRestDay: false,
  hasDailySession: false,
  hasWeeklyPlan: false
};

const formatWeightKg = (value: unknown, emptyLabel = 'Chưa có tạ đề xuất'): string => {
  if (value === null || value === undefined || value === '') return emptyLabel;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return emptyLabel;
  return `${parsed} kg`;
};

const formatRestTime = (secondsValue: unknown): string => {
  const seconds = Math.max(0, Number(secondsValue) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0 && remainingSeconds > 0) return `${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
};

const formatDifficultyLabel = (value: unknown): string => {
  return formatCatalogDifficultyLabel(value) || 'Chưa xác định';
};

const parseRepAverage = (value: string): number => {
  const numbers = String(value || '')
    .match(/\d+/g)
    ?.map(Number)
    .filter((item) => Number.isFinite(item)) || [];
  if (numbers.length === 0) return 10;
  if (numbers.length === 1) return numbers[0];
  return Math.round((numbers[0] + numbers[numbers.length - 1]) / 2);
};

const getResolvedExerciseKcal = (exercise?: SessionExercise | null): number => {
  const actualKcal = Number(exercise?.actual_kcal_estimated);
  if (Number.isFinite(actualKcal) && actualKcal > 0) {
    return Math.max(0, Math.round(actualKcal));
  }

  const estimatedKcal = Number(exercise?.estimated_kcal);
  if (Number.isFinite(estimatedKcal)) {
    return Math.max(0, Math.round(estimatedKcal));
  }

  return 0;
};

type ExercisesPageCache = {
  vnToday: string;
  session: SessionExercise[];
};

let exercisesPageCache: ExercisesPageCache | null = null;

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DAYS = [
  { id: 0, label: 'TH2', full: 'Thứ 2' },
  { id: 1, label: 'TH3', full: 'Thứ 3' },
  { id: 2, label: 'TH4', full: 'Thứ 4' },
  { id: 3, label: 'TH5', full: 'Thứ 5' },
  { id: 4, label: 'TH6', full: 'Thứ 6' },
  { id: 5, label: 'TH7', full: 'Thứ 7' },
  { id: 6, label: 'CN', full: 'Chủ nhật' }
];
const MONTH_WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

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

const getWeekStartKey = (baseDate: Date): string => {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getDayIndexFromDate = (date: Date): number => {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
};

const getDateFromKey = (dateKey: string): Date => new Date(`${dateKey}T00:00:00`);

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getMonthStartDate = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

const getMonthEndDate = (date: Date): Date => new Date(date.getFullYear(), date.getMonth() + 1, 0);

const getMonthCalendarDates = (monthDate: Date): Date[] => {
  const firstDay = getMonthStartDate(monthDate);
  const daysInMonth = getMonthEndDate(monthDate).getDate();
  const leadingDays = getDayIndexFromDate(firstDay);
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => addDays(firstDay, index - leadingDays));
};

const isDateKeyBetween = (dateKey: string, startKey: string, endKey: string): boolean =>
  dateKey >= startKey && dateKey <= endKey;

const normalizeVideoUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const isWeekStartColumnError = (error: any): boolean => {
  const msg = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return msg.includes('week_start_date') || details.includes('week_start_date');
};

const pickLatestPlan = (plans: any[] | null | undefined) => {
  if (!plans || plans.length === 0) return null;
  return [...plans].sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return String(b.id || '').localeCompare(String(a.id || ''));
  })[0];
};



// === Components ===
const ExerciseThumb = ({ src, poster, alt, className }: { src?: string; poster?: string; alt: string; className?: string }) => {
  const videoUrl = normalizeVideoUrl(src);
  const posterUrl = normalizeVideoUrl(poster);
  const hasError = !videoUrl;

  if (hasError) {
    return (
      <div className="w-full h-full bg-bg-quaternary flex items-center justify-center text-text-tertiary">
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }

  return (
    <video
      src={videoUrl}
      poster={posterUrl || undefined}
      aria-label={alt}
      className={className || "w-full h-full object-cover"}
      muted playsInline preload="auto"
    />
  );
};


// ====================================================================
export const ExercisesSkeleton = () => {
  return (
    <div className="dashboard-page-shell exercise-page-shell flex flex-col gap-4 animate-pulse overflow-y-auto custom-scrollbar text-sm pb-4 md:gap-5 md:pb-6 lg:pb-7" aria-hidden="true">
      <div className="monthly-workout-calendar">
        <div className="monthly-workout-calendar-header">
          <div className="monthly-workout-calendar-title">
            <span className="monthly-workout-calendar-icon" />
            <div className="min-w-0">
              {SkeletonBlock('h-6 w-40 rounded-lg')}
              {SkeletonBlock('mt-2 h-4 w-56 rounded-lg')}
            </div>
          </div>
          <div className="h-14 w-16 rounded-2xl bg-bg-tertiary/70" />
        </div>

        <div className="monthly-workout-weekdays">
          {MONTH_WEEKDAYS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="monthly-workout-grid">
          {Array.from({ length: 35 }).map((_, index) => (
            <div key={index} className="monthly-workout-day bg-bg-tertiary/45" />
          ))}
        </div>
      </div>

      <div className="today-workout-shell rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            {SkeletonBlock('h-7 w-44 rounded-lg')}
            <div className="h-8 w-24 rounded-full bg-bg-tertiary/70" />
          </div>
        </div>

        <div className="-ml-2 -mt-1 grid grid-cols-1 gap-5 md:gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-stretch">
          <article className="min-w-0 p-4 md:p-4 xl:pr-8">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[164px_minmax(0,540px)] lg:items-start lg:gap-5">
              <div className="h-[176px] overflow-hidden rounded-[22px] border border-border-primary bg-bg-tertiary/25" />
              <div className="flex min-w-0 max-w-[540px] flex-col justify-center gap-3.5">
                <div className="min-w-0">
                  {SkeletonBlock('h-8 w-[72%] rounded-xl')}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <div className="h-7 w-24 rounded-full bg-bg-tertiary/70" />
                    <div className="h-7 w-24 rounded-full bg-bg-tertiary/70" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-9 w-24 rounded-full bg-bg-tertiary/65" />
                  <div className="h-9 w-24 rounded-full bg-bg-tertiary/65" />
                  <div className="h-9 w-24 rounded-full bg-bg-tertiary/65" />
                  <div className="h-9 w-24 rounded-full bg-bg-tertiary/65" />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-start gap-2">
                  <div className="h-10 w-40 rounded-xl bg-bg-tertiary/75" />
                  <div className="h-10 w-28 rounded-xl border border-border-primary bg-bg-tertiary/35" />
                </div>
              </div>
            </div>
          </article>

          <aside className="relative min-w-0 p-4 md:p-4 xl:-ml-2 xl:self-stretch xl:pl-5 xl:pt-4 xl:before:absolute xl:before:bottom-4 xl:before:left-0 xl:before:top-4 xl:before:w-px xl:before:bg-border-primary/70 xl:before:content-['']">
            {SkeletonBlock('mb-1 h-6 w-40 rounded-lg')}
            <div className="mt-3.5 space-y-2.5 max-h-[320px] pr-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="rounded-lg px-0 py-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="h-5 w-5 shrink-0 rounded-full bg-bg-tertiary/70" />
                      {SkeletonBlock('h-4 w-40 rounded-lg')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default function Exercises() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const cacheForToday =
    exercisesPageCache && exercisesPageCache.vnToday === getVietnamDateKey()
      ? exercisesPageCache
      : null;

  const [session, setSession] = useState<SessionExercise[]>(() => cacheForToday?.session || []);
  const [isLoading, setIsLoading] = useState(() => !cacheForToday);
  const [, setIsRefreshing] = useState(false);
  const [isCalendarLoading, setIsCalendarLoading] = useState(false);
  const [vnToday, setVnToday] = useState(() => getVietnamDateKey());
  const [selectedDateKey, setSelectedDateKey] = useState(() => getVietnamDateKey());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [calendarStatsByDate, setCalendarStatsByDate] = useState<Record<string, CalendarDayStats>>({});
  const [isWorkoutSurveyOpen, setIsWorkoutSurveyOpen] = useState(false);
  const [replacingSessionId, setReplacingSessionId] = useState<string | null>(null);
  // Use the last server-confirmed quota while the fresh quota is loading.
  const [workoutPlanQuota, setWorkoutPlanQuota] = useState<WorkoutPlanQuota | null>(() => readCachedWorkoutPlanQuota(user?.id));
  const hasLoadedSessionRef = useRef(Boolean(cacheForToday));

  const selectedDate = useMemo(() => getDateFromKey(selectedDateKey), [selectedDateKey]);
  const selectedDayId = useMemo(() => getDayIndexFromDate(selectedDate), [selectedDate]);
  const selectedMonthStart = useMemo(() => getMonthStartDate(selectedDate), [selectedDate]);
  const selectedMonthEnd = useMemo(() => getMonthEndDate(selectedDate), [selectedDate]);
  const selectedMonthStartKey = useMemo(() => toDateKey(selectedMonthStart), [selectedMonthStart]);
  const selectedMonthEndKey = useMemo(() => toDateKey(selectedMonthEnd), [selectedMonthEnd]);
  const monthCalendarDates = useMemo(() => getMonthCalendarDates(selectedMonthStart), [selectedMonthStart]);
  const isTodaySelected = selectedDateKey === vnToday;
  const selectedDayTitle = isTodaySelected
    ? 'Bài tập hôm nay'
    : `Bài tập ${DAYS[selectedDayId]?.full.toLowerCase() || ''}`;
  const selectedMonthLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString('vi-VN', {
        month: 'long',
        year: 'numeric'
      }),
    [selectedDate]
  );
  const selectedDayDateLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
    [selectedDate]
  );
  const monthComplianceSummary = useMemo(() => {
    const dateKeys = monthCalendarDates
      .filter((date) => date.getMonth() === selectedMonthStart.getMonth())
      .map(toDateKey);

    const plannedDays = dateKeys.filter((dateKey) => (calendarStatsByDate[dateKey]?.planned || 0) > 0);
    const completedDays = plannedDays.filter((dateKey) => {
      const stats = calendarStatsByDate[dateKey] || EMPTY_DAY_STATS;
      return stats.planned > 0 && stats.completed >= stats.planned;
    });

    return {
      plannedDays: plannedDays.length,
      completedDays: completedDays.length,
      adherence: plannedDays.length > 0 ? Math.round((completedDays.length / plannedDays.length) * 100) : 0
    };
  }, [calendarStatsByDate, monthCalendarDates, selectedMonthStart]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextVnToday = getVietnamDateKey();
      setVnToday(prev => (prev === nextVnToday ? prev : nextVnToday));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (user) {
      const shouldLoadSilently = hasLoadedSessionRef.current || (!!cacheForToday && selectedDateKey === vnToday);
      loadSession(shouldLoadSilently);
    } else {
      setSession([]);
      setIsLoading(false);
    }
  }, [user, selectedDateKey, vnToday]);

  useEffect(() => {
    let isCancelled = false;

    if (!user?.id) {
      setWorkoutPlanQuota(null);
      return undefined;
    }

    setWorkoutPlanQuota(readCachedWorkoutPlanQuota(user.id));

    const loadWorkoutPlanQuota = async () => {
      try {
        const response = await fetchWithAuth('/api/ai/quota');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || isCancelled) return;

        const limit = Number(payload?.aiQuota?.limits?.planGenerations);
        const used = Number(payload?.aiQuota?.usage?.planGenerations);
        if (Number.isFinite(limit) && Number.isFinite(used)) {
          const quota = { used: Math.max(0, used), limit: Math.max(0, limit) };
          cacheWorkoutPlanQuota(user.id, quota);
          setWorkoutPlanQuota(quota);
        }
      } catch {}
    };

    void loadWorkoutPlanQuota();
    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    loadCalendarStats();
  }, [user, selectedMonthStartKey, selectedMonthEndKey]);

  const loadCalendarStats = async (silent = false) => {
    if (!user?.id) {
      setCalendarStatsByDate({});
      setIsCalendarLoading(false);
      return;
    }

    if (!silent) setIsCalendarLoading(true);

    try {
      const dailyRes = await supabase
        .from('daily_exercise_sessions')
        .select('log_date, is_completed')
        .eq('user_id', user.id)
        .gte('log_date', selectedMonthStartKey)
        .lte('log_date', selectedMonthEndKey);
      if (dailyRes.error) throw dailyRes.error;

      const dailyByDate = new Map<string, { total: number; completed: number }>();
      (dailyRes.data || []).forEach((row: any) => {
        const dateKey = String(row.log_date || '');
        if (!dateKey) return;
        const current = dailyByDate.get(dateKey) || { total: 0, completed: 0 };
        current.total += 1;
        if (row.is_completed) current.completed += 1;
        dailyByDate.set(dateKey, current);
      });

      const monthFirstWeekStartKey = getWeekStartKey(selectedMonthStart);
      const monthLastWeekStartKey = getWeekStartKey(selectedMonthEnd);
      const plansRes = await supabase
        .from('weekly_plans')
        .select('id, week_start_date, created_at, updated_at')
        .eq('user_id', user.id)
        .gte('week_start_date', monthFirstWeekStartKey)
        .lte('week_start_date', monthLastWeekStartKey)
        .eq('plan_status', 'active')
        .limit(40);
      if (plansRes.error) throw plansRes.error;

      const latestPlanByWeek = new Map<string, MonthlyPlanSummary>();
      (plansRes.data || []).forEach((plan: any) => {
        const weekStartDate = String(plan.week_start_date || '');
        if (!weekStartDate) return;
        const current = latestPlanByWeek.get(weekStartDate);
        const latest = pickLatestPlan([current, plan].filter(Boolean) as any[]);
        if (latest) latestPlanByWeek.set(weekStartDate, latest as MonthlyPlanSummary);
      });

      const planIds = Array.from(latestPlanByWeek.values()).map((plan) => plan.id);
      const weeklyByDate = new Map<string, { planned: number; isRestDay: boolean }>();

      if (planIds.length > 0) {
        const planItemsRes = await supabase
          .from('weekly_plan_exercises')
          .select('weekly_plan_id, day_of_week, exercise_id, is_rest_day')
          .in('weekly_plan_id', planIds);
        if (planItemsRes.error) throw planItemsRes.error;

        const weekStartByPlanId = new Map(
          Array.from(latestPlanByWeek.values()).map((plan) => [plan.id, plan.week_start_date])
        );

        (planItemsRes.data || []).forEach((item: any) => {
          const weekStartKey = weekStartByPlanId.get(String(item.weekly_plan_id || ''));
          if (!weekStartKey) return;

          const dayIndex = Math.max(0, Math.min(6, Number(item.day_of_week) || 0));
          const dateKey = toDateKey(addDays(getDateFromKey(weekStartKey), dayIndex));
          if (!isDateKeyBetween(dateKey, selectedMonthStartKey, selectedMonthEndKey)) return;

          const current = weeklyByDate.get(dateKey) || { planned: 0, isRestDay: false };
          if (item.is_rest_day) {
            current.isRestDay = true;
          } else if (item.exercise_id) {
            current.planned += 1;
            current.isRestDay = false;
          }
          weeklyByDate.set(dateKey, current);
        });
      }

      const nextStats: Record<string, CalendarDayStats> = {};
      monthCalendarDates.forEach((date) => {
        const dateKey = toDateKey(date);
        if (!isDateKeyBetween(dateKey, selectedMonthStartKey, selectedMonthEndKey)) return;

        const daily = dailyByDate.get(dateKey) || { total: 0, completed: 0 };
        const weekly = weeklyByDate.get(dateKey) || { planned: 0, isRestDay: false };
        const planned = daily.total > 0 ? daily.total : weekly.planned;

        nextStats[dateKey] = {
          planned,
          completed: daily.completed,
          isRestDay: planned === 0 && weekly.isRestDay,
          hasDailySession: daily.total > 0,
          hasWeeklyPlan: weekly.planned > 0 || weekly.isRestDay
        };
      });

      setCalendarStatsByDate(nextStats);
    } catch (error) {
      console.error('Error loading workout calendar:', error);
      setCalendarStatsByDate({});
    } finally {
      if (!silent) setIsCalendarLoading(false);
    }
  };

  const loadSession = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      // 1. Check if session already exists for the selected day
      const { data: existingSession, error: existingSessionError } = await supabase
        .from('daily_exercise_sessions')
        .select(`
          *,
          exercises:exercise_id (name, video_url, target_muscle, body_part, equipment, difficulty, movement_pattern, instructions, estimated_duration_seconds)
        `)
        .eq('user_id', user?.id)
        .eq('log_date', selectedDateKey)
        .order('order_index');
      if (existingSessionError) throw existingSessionError;

      if (existingSession && existingSession.length > 0) {
        setSession(existingSession.map(s => ({
          ...s,
          name: (s.exercises as any)?.name || 'Exercise',
          video_url: normalizeVideoUrl((s.exercises as any)?.video_url || '')
        })));
      } else {
        // 2. No session on this day. Try to clone from weekly plan
        setSession([]);
        await clonePlanToSelectedDate(selectedDateKey, selectedDayId);
      }
      // Calendar statistics are independent of today's session. Do not keep
      // the exercise cards and their media behind these extra queries.
      void loadCalendarStats(true);
    } catch (e) {
      console.error('Error loading session:', e);
    } finally {
      hasLoadedSessionRef.current = true;
      if (silent) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  };

  const getLatestDailyWorkoutSessionId = async (logDate: string): Promise<string | null> => {
    if (!user?.id || !logDate) return null;

    const { data, error } = await supabase
      .from('daily_workout_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('log_date', logDate)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.id || null;
  };

  const syncDailyCaloriesBurned = async (logDate: string) => {
    if (!user?.id || !logDate) return;

    const sessionsRes = await supabase
      .from('daily_exercise_sessions')
      .select('actual_kcal_estimated, estimated_kcal, is_completed')
      .eq('user_id', user.id)
      .eq('log_date', logDate);
    if (sessionsRes.error) throw sessionsRes.error;

    const caloriesBurned = Math.max(
      0,
      Math.round(
        (sessionsRes.data || []).reduce((sum, item: any) => {
          const actualKcal = Math.max(0, Number(item.actual_kcal_estimated) || 0);
          if (actualKcal > 0) return sum + actualKcal;
          return sum + (item.is_completed ? Math.max(0, Number(item.estimated_kcal) || 0) : 0);
        }, 0)
      )
    );

    const progressRes = await supabase
      .from('daily_progress_logs')
      .upsert(
        { user_id: user.id, log_date: logDate, calories_burned: caloriesBurned },
        { onConflict: 'user_id,log_date' }
      );
    if (progressRes.error) throw progressRes.error;
  };

  const clonePlanToSelectedDate = async (logDate: string, dayIndex: number) => {
    try {
      const response = await fetchWithAuth('/api/workout/daily-exercises/from-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          logDate,
          dayIndex,
          weekStartDate: getWeekStartKey(new Date(`${logDate}T00:00:00`))
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Khong the tao buoi tap tu ke hoach tuan'));
      }

      const createdExercises = Array.isArray(payload?.exercises) ? payload.exercises : [];
      if (createdExercises.length > 0) {
        setSession(createdExercises.map((s: any) => ({
          ...s,
          name: (s.exercises as any)?.name || 'Exercise',
          video_url: normalizeVideoUrl((s.exercises as any)?.video_url || '')
        })));
      }
    } catch (error) {
      console.error('Error cloning weekly plan to daily workout:', error);
    }
  };

  const handleWorkoutSurveyComplete = async () => {
    const response = await fetchWithAuth('/api/ai-coach/generate-daily-workout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logDate: selectedDateKey })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(payload?.details)
        ? payload.details.slice(0, 3).join('; ')
        : '';
      throw new Error([payload?.error || 'Không thể tạo kế hoạch tập. Vui lòng thử lại.', details].filter(Boolean).join(': '));
    }

    const nextLimit = Number(payload?.aiQuota?.limits?.planGenerations);
    const nextUsed = Number(payload?.aiQuota?.usage?.planGenerations);
    if (Number.isFinite(nextLimit) && Number.isFinite(nextUsed)) {
      const quota = { used: Math.max(0, nextUsed), limit: Math.max(0, nextLimit) };
      cacheWorkoutPlanQuota(user?.id, quota);
      setWorkoutPlanQuota(quota);
    }

    await refreshProfile();
    setIsWorkoutSurveyOpen(false);
    await loadSession(true);
    await loadCalendarStats(true);
    toast.success('Lịch tập hôm nay đã được tạo.');
  };

  const replaceExercise = async (exercise: SessionExercise) => {
    if (replacingSessionId) return;
    setReplacingSessionId(exercise.id);
    try {
      const response = await fetchWithAuth(`/api/workout/daily-exercises/${exercise.id}/replace`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Không thể đổi bài tập.'));
      }
      await loadSession(true);
      toast.success(`Đã đổi ${exercise.name} sang ${payload?.exercise?.exercises?.name || 'bài tập phù hợp'}.`);
    } catch (error: any) {
      toast.error(error?.message || 'Không thể đổi bài tập.');
    } finally {
      setReplacingSessionId(null);
    }
  };

  const toggleComplete = async (id: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    setSession(prev => prev.map(s => s.id === id ? { ...s, is_completed: newStatus } : s));

    try {
      const response = await fetchWithAuth(`/api/workout/daily-exercises/${id}/completion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isCompleted: newStatus })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Cap nhat trang thai that bai'));
      }
      const savedExercise = payload?.exercise as SessionExercise | undefined;
      if (savedExercise) {
        setSession(prev => prev.map(s => s.id === id ? {
          ...s,
          ...savedExercise,
          name: (savedExercise.exercises as any)?.name || s.name,
          video_url: normalizeVideoUrl((savedExercise.exercises as any)?.video_url || s.video_url)
        } : s));
      }
    } catch (error: any) {
      setSession(prev => prev.map(s => s.id === id ? { ...s, is_completed: currentStatus } : s));
      toast.error("Loi: " + (error?.message || 'Cap nhat trang thai that bai'));
    }
  };

  const deleteExercise = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa không?")) return;
    const removedItem = session.find(s => s.id === id);
    setSession(prev => prev.filter(s => s.id !== id));

    const { error: deleteSessionError } = await supabase.from('daily_exercise_sessions').delete().eq('id', id);
    if (deleteSessionError) {
      if (removedItem) {
        setSession(prev => [...prev, removedItem].sort((a, b) => a.order_index - b.order_index));
      }
      toast.error("Lỗi: " + (deleteSessionError.message || 'Xóa bài tập thất bại'));
      return;
    }

    try {
      await syncDailyCaloriesBurned(selectedDateKey);
    } catch (syncError) {
      console.error('Error syncing calories after deleting exercise:', syncError);
    }

    if (removedItem?.exercise_id) {
      try {
        const workoutSessionId = await getLatestDailyWorkoutSessionId(selectedDateKey);
        if (workoutSessionId) {
          const deleteWorkoutRow = await supabase
            .from('daily_workout_session_exercises')
            .delete()
            .eq('session_id', workoutSessionId)
            .eq('exercise_id', removedItem.exercise_id)
            .eq('order_index', removedItem.order_index);
          if (deleteWorkoutRow.error) throw deleteWorkoutRow.error;
        }
      } catch (syncError) {
        console.error('Error deleting daily workout session exercise:', syncError);
      }
    }
    return;

  };

  useEffect(() => {
    if (session.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const exists = session.some((s) => s.id === selectedSessionId);
    if (!exists) setSelectedSessionId(session[0].id);
  }, [session, selectedSessionId]);

  useEffect(() => {
    if (session.length === 0 || !isDateKeyBetween(selectedDateKey, selectedMonthStartKey, selectedMonthEndKey)) return;

    setCalendarStatsByDate((prev) => ({
      ...prev,
      [selectedDateKey]: {
        ...(prev[selectedDateKey] || EMPTY_DAY_STATS),
        planned: session.length,
        completed: session.filter((item) => item.is_completed).length,
        isRestDay: false,
        hasDailySession: true
      }
    }));
  }, [session, selectedDateKey, selectedMonthStartKey, selectedMonthEndKey]);

  const selectedSessionExercise = session.find((s) => s.id === selectedSessionId) || null;
  const selectedTargetMuscleLabel = formatTargetMuscleLabel(selectedSessionExercise?.exercises?.target_muscle);
  const selectedBodyPartLabel = formatBodyPartLabel(selectedSessionExercise?.exercises?.body_part);
  const selectedSessionDetailExercise = useMemo<ExerciseDetailItem | null>(() => {
    if (!selectedSessionExercise) return null;
    return {
      id: selectedSessionExercise.exercise_id,
      name: selectedSessionExercise.name || 'Exercise',
      body_part: String(selectedSessionExercise.exercises?.body_part || ''),
      target_muscle: String(selectedSessionExercise.exercises?.target_muscle || ''),
      video_url: normalizeVideoUrl(selectedSessionExercise.exercises?.video_url || selectedSessionExercise.video_url || ''),
      equipment: '',
      instructions: selectedSessionExercise.exercises?.instructions || []
    };
  }, [selectedSessionExercise]);
  const openExerciseDetailsPage = (exercise: ExerciseDetailItem) => {
    navigate('/exercises/details', { state: { exercise } });
  };
  const selectedExerciseStats = useMemo(() => {
    if (!selectedSessionExercise) {
      return { setsText: '0 hiệp', repsText: '0 lần', weightText: null, kcalText: '~0 kcal' };
    }
    const sets = Math.max(1, Number(selectedSessionExercise.actual_sets ?? selectedSessionExercise.sets) || 1);
    const reps = Math.max(1, parseRepAverage(String((selectedSessionExercise.actual_reps ?? selectedSessionExercise.reps) || '10')));
    const weightKg = selectedSessionExercise.actual_weight_kg ?? selectedSessionExercise.weight_kg;
    const isBodyweight = String(selectedSessionExercise.exercises?.equipment || '').trim().toLowerCase() === 'none';
    const kcal = getResolvedExerciseKcal(selectedSessionExercise);
    return {
      setsText: `${sets} hiệp`,
      repsText: `${reps} lần`,
      weightText: !isBodyweight && Number(weightKg) > 0 ? formatWeightKg(weightKg) : null,
      kcalText: `~${kcal} kcal`
    };
  }, [selectedSessionExercise]);

  const workoutOrderSummary = useMemo(() => {
    const completed = session.filter((item) => item.is_completed).length;
    const estimatedMinutes = estimateWorkoutDurationMinutes(session);
    const focusItems = Array.from(new Set(
      session
        .flatMap((item) => [
          formatTargetMuscleLabel(item.exercises?.target_muscle),
          formatBodyPartLabel(item.exercises?.body_part),
        ])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));

    return {
      completed,
      progress: session.length > 0 ? Math.round((completed / session.length) * 100) : 0,
      estimatedMinutes,
      focusText: focusItems.slice(0, 2).join(', ') || 'Toàn thân'
    };
  }, [session]);
  useEffect(() => {
    if (!user || selectedDateKey !== vnToday) return;
    exercisesPageCache = {
      vnToday,
      session
    };
  }, [user, selectedDateKey, vnToday, session]);

  if (isLoading) return <ExercisesSkeleton />;

  return (
    <div className="dashboard-page-shell exercise-page-shell flex flex-col gap-4 overflow-y-auto custom-scrollbar text-sm pb-4 md:gap-5 md:pb-6 lg:pb-7">
      {isWorkoutSurveyOpen ? (
        <SurveyForm
          isOpen
          modalPurpose="workout-plan"
          onClose={() => setIsWorkoutSurveyOpen(false)}
          onComplete={handleWorkoutSurveyComplete}
        />
      ) : null}

      <div className={`monthly-workout-calendar ${isCalendarLoading ? 'monthly-workout-calendar-loading' : ''}`}>
        <div className="monthly-workout-calendar-header">
          <div className="monthly-workout-calendar-title">
            <span className="monthly-workout-calendar-icon">
              <Calendar className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1>Lịch tập tháng</h1>
              <p>
                {selectedMonthLabel} · {monthComplianceSummary.plannedDays} ngày tập · {monthComplianceSummary.completedDays} ngày xong
              </p>
            </div>
          </div>
        </div>

        <div className="monthly-workout-weekdays" aria-hidden="true">
          {MONTH_WEEKDAYS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="monthly-workout-grid">
          {monthCalendarDates.map((date) => {
            const dateKey = toDateKey(date);
            const inMonth = date.getMonth() === selectedMonthStart.getMonth();
            const stats = calendarStatsByDate[dateKey] || EMPTY_DAY_STATS;
            const isToday = dateKey === vnToday;
            const isSelected = dateKey === selectedDateKey;
            const isComplete = stats.planned > 0 && stats.completed >= stats.planned;
            const isPlanned = stats.planned > 0 && !isComplete;
            const isRestDay = stats.isRestDay && stats.planned === 0;
            const dayTitle = date.toLocaleDateString('vi-VN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            });

            if (!inMonth) {
              return <div key={dateKey} className="monthly-workout-day monthly-workout-day-empty" aria-hidden="true" />;
            }

            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => {
                  // Clear the previous day's exercises before changing the date.
                  // Otherwise the calendar briefly assigns those exercises to a rest day.
                  setSession([]);
                  setSelectedSessionId(null);
                  setSelectedDateKey(dateKey);
                }}
                className={[
                  'monthly-workout-day',
                  isSelected ? 'monthly-workout-day-selected' : '',
                  isToday ? 'monthly-workout-day-today' : '',
                  isComplete ? 'monthly-workout-day-complete' : '',
                  isPlanned ? 'monthly-workout-day-planned' : '',
                  isRestDay ? 'monthly-workout-day-rest' : ''
                ].filter(Boolean).join(' ')}
                title={dayTitle}
                aria-pressed={isSelected}
              >
                <span className="monthly-workout-day-number">{date.getDate()}</span>
                {isToday ? <span className="monthly-workout-day-dot" aria-hidden="true" /> : null}
                <span className="monthly-workout-day-status">
                  {stats.planned > 0 ? (
                    `${stats.completed}/${stats.planned}`
                  ) : isRestDay ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : (
                    ''
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="today-workout-shell">
        <div className="today-workout-header">
          <div className="today-workout-title-row">
            <h2 className="today-workout-title">{selectedDayTitle}</h2>
          </div>
          <span className="today-workout-status-pill today-workout-status-active">
            {workoutPlanQuota
              ? `Lượt sử dụng: ${workoutPlanQuota.used}/${workoutPlanQuota.limit}`
              : 'Đang tải lượt sử dụng…'}
          </span>
        </div>

        <div className="today-workout-content">
          {selectedSessionExercise ? (
            <article className="min-w-0">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,560px)] lg:items-center lg:gap-5">
                <div className="themed-image-surface aspect-[4/3] w-full overflow-hidden rounded-xl">
                  <ExerciseThumb
                    src={selectedSessionExercise.video_url}
                    alt={selectedSessionExercise.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="today-workout-feature flex flex-col justify-center gap-3.5 min-w-0 max-w-[580px]">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-black text-text-primary leading-tight md:text-[1.75rem] md:leading-[1.08] line-clamp-2">{selectedSessionExercise.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedTargetMuscleLabel ? (
                        <span className="rounded-full border border-info/20 bg-info/10 px-3 py-1 text-xs font-bold text-info">
                          {selectedTargetMuscleLabel}
                        </span>
                      ) : null}
                      {selectedBodyPartLabel ? (
                        <span className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
                          {selectedBodyPartLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="today-workout-meta flex flex-wrap items-center gap-2">
                    <span className="today-workout-meta-item">{selectedExerciseStats.setsText}</span>
                    <span className="today-workout-meta-item">{selectedExerciseStats.repsText}</span>
                    {selectedExerciseStats.weightText ? (
                      <span className="today-workout-meta-item">{selectedExerciseStats.weightText}</span>
                    ) : null}
                    <span className="today-workout-meta-item">{selectedExerciseStats.kcalText}</span>
                  </div>
                  <div className="today-workout-actions mt-1 flex flex-wrap items-center justify-start gap-2">
                    <button
                      onClick={() =>
                        navigate('/exercises/session', {
                          state: {
                            session,
                            selectedSessionId: selectedSessionExercise.id,
                            logDate: selectedDateKey
                          }
                        })
                      }
                      className={`h-10 px-4 rounded-xl font-black text-sm transition-colors inline-flex items-center gap-2 ${selectedSessionExercise.is_completed ? 'bg-accent text-text-inverse' : 'bg-accent text-text-inverse hover:bg-accent-hover'}`}
                    >
                      <Play className="w-4 h-4" />
                      {selectedSessionExercise.is_completed ? 'Mở lại buổi tập' : 'Bắt đầu buổi tập'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedSessionDetailExercise) openExerciseDetailsPage(selectedSessionDetailExercise);
                      }}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary/45 px-4 text-sm font-black text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
                    >
                      <Eye className="w-4 h-4" />
                      Xem chi tiết
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ) : (
            <div className="today-workout-empty-state">
              <span className="today-workout-empty-icon">
                <AlertCircle className="h-6 w-6" />
              </span>
              <p>
                {isTodaySelected ? 'Chưa có bài tập nào hôm nay.' : 'Chưa có bài tập cho ngày này.'}
              </p>
              {isTodaySelected ? (
                <p className="today-workout-empty-note">
                  Tạo lịch tập hôm nay để Fitly sắp xếp bài tập, số hiệp và lần lặp phù hợp với mục tiêu của bạn.
                </p>
              ) : null}
              {isTodaySelected ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsWorkoutSurveyOpen(true)}
                    disabled={!workoutPlanQuota || workoutPlanQuota.used >= workoutPlanQuota.limit}
                    className="today-workout-empty-action"
                  >
                    <Plus className="h-4 w-4" />
                    Tạo lịch tập hôm nay
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <section className={`workout-order-shell ${session.length === 0 ? 'workout-order-rest-shell' : ''}`}>
          <div className="workout-order-header">
            <div className="min-w-0">
              <p className="workout-order-eyebrow">THỨ TỰ BÀI TẬP</p>
              <h2>{`Ngày ${selectedDayId + 1} · ${selectedDayDateLabel}${session.length === 0 ? ' · Nghỉ' : ''}`}</h2>
            </div>
            {session.length > 0 ? (
              <div className="workout-order-progress">
                <strong>{workoutOrderSummary.progress}%</strong>
                <span>hoàn thành</span>
              </div>
            ) : null}
          </div>

          {session.length > 0 ? (
            <>
              <div className="workout-order-summary">
                <span>{session.length} bài trong buổi</span>
                <span>~{workoutOrderSummary.estimatedMinutes} phút ước tính</span>
                <span>Trọng tâm {workoutOrderSummary.focusText}</span>
              </div>

              <div className="workout-order-list">
                {session.map((exercise, index) => {
                  const isActive = exercise.id === selectedSessionExercise?.id;
                  const sets = Math.max(1, Number(exercise.actual_sets ?? exercise.sets) || 1);
                  const reps = Math.max(1, parseRepAverage(String((exercise.actual_reps ?? exercise.reps) || '10')));
                  const restSeconds = exercise.actual_rest_seconds ?? exercise.rest_seconds;
                  const kcal = getResolvedExerciseKcal(exercise);
                  const tags = [
                    formatTargetMuscleLabel(exercise.exercises?.target_muscle),
                    formatBodyPartLabel(exercise.exercises?.body_part),
                    formatEquipmentLabel(exercise.exercises?.equipment),
                    formatMovementPatternLabel(exercise.exercises?.movement_pattern),
                  ].filter((item): item is string => Boolean(item)).slice(0, 4);
                  const openExercise = () => {
                    if (!isActive) {
                      setSelectedSessionId(exercise.id);
                      return;
                    }
                    navigate('/exercises/session', {
                      state: {
                        session,
                        selectedSessionId: exercise.id,
                        logDate: selectedDateKey,
                      },
                    });
                  };

                  return (
                    <div
                      key={exercise.id}
                      className={`workout-order-item ${isActive ? 'workout-order-item-active' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={openExercise}
                        className="workout-order-select"
                        aria-label={isActive ? `Bắt đầu từ bài ${exercise.name}` : `Chọn bài ${exercise.name}`}
                      >
                      <div className="workout-order-thumb-wrap">
                        <div className="workout-order-thumb">
                          <ExerciseThumb
                            src={exercise.video_url}
                            alt={exercise.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <span className={`workout-order-index${exercise.is_completed ? ' workout-order-index--done' : ''}`}>
                          {exercise.is_completed ? <Check style={{ width: '0.85rem', height: '0.85rem', strokeWidth: 3 }} /> : index + 1}
                        </span>
                      </div>

                      <div className="workout-order-item-body">
                        <div className="workout-order-item-title">
                          <h3 className={exercise.is_completed ? 'line-through' : ''}>{exercise.name}</h3>
                          <span>{formatDifficultyLabel(exercise.exercises?.difficulty)}</span>
                        </div>
                        <div className="workout-order-tags">
                          {tags.length > 0 ? tags.map((tag, tagIndex) => (
                            <span key={`${exercise.id}-${tag}-${tagIndex}`}>{tag}</span>
                          )) : (
                            <span>Toàn thân</span>
                          )}
                        </div>
                        <p className="workout-order-meta-line">
                          <strong>{sets}×{reps}</strong>
                          <span>·</span>
                          <span>Nghỉ {formatRestTime(restSeconds)}</span>
                          <span>·</span>
                          <span>{kcal} kcal</span>
                        </p>
                      </div>
                      </button>

                      <div className="workout-order-actions">
                        <button
                          type="button"
                          className="workout-order-action workout-order-action-swap"
                          onClick={() => void replaceExercise(exercise)}
                          disabled={Boolean(replacingSessionId)}
                          aria-label={`Đổi bài ${exercise.name}`}
                          title="Đổi sang bài cùng nhóm cơ"
                        >
                          <RefreshCw className={`h-4 w-4 ${replacingSessionId === exercise.id ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          className={`workout-order-action ${isActive ? 'workout-order-action-play' : ''}`}
                          onClick={openExercise}
                          aria-label={isActive ? `Bắt đầu từ bài ${exercise.name}` : `Chọn bài ${exercise.name}`}
                        >
                          {isActive ? <Play className="h-4 w-4 fill-current" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="workout-order-rest-panel">
              <span className="workout-order-rest-icon">
                <Shield className="h-4 w-4" />
              </span>
              <div className="workout-order-rest-content">
                <span className="workout-order-rest-kicker">NGÀY NGHỈ</span>
                <h3>Phục hồi chủ động</h3>
                <p>Không có bài chính hôm nay. Giữ cơ thể nhẹ nhàng để buổi tập kế tiếp hiệu quả hơn.</p>
                <div className="workout-order-rest-chips">
                  <span>Đi bộ nhẹ</span>
                  <span>Mobility</span>
                  <span>Stretching 10–20 phút</span>
                </div>
              </div>
            </div>
          )}
        </section>
    </div>
  );
}
