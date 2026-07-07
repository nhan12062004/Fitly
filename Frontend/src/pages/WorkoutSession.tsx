import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Pause, Play, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { SkeletonBlock } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';
import { syncChallengeCheckin } from '../lib/Challenges';

interface SessionExercise {
  id: string;
  exercise_id: string;
  name: string;
  gif_url: string;
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
  instructions?: string[] | string | Record<string, unknown>;
  exercises?: {
    target_muscle?: string;
    body_part?: string;
    instructions?: string[] | string | Record<string, unknown>;
  } | null;
}

interface WorkoutSessionLocationState {
  session?: SessionExercise[];
  selectedSessionId?: string;
  logDate?: string;
}

interface EditExerciseForm {
  sets: string;
  reps: string;
  weightKg: string;
  restSeconds: string;
}

type WorkoutDifficulty = 'too_easy' | 'just_right' | 'too_hard';
type WorkoutPainArea = 'none' | 'knee' | 'back' | 'shoulder' | 'wrist';

const normalizeGifUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const ExercisePreview = ({ src, alt }: { src?: string; alt: string }) => {
  const [failed, setFailed] = useState(false);
  const normalized = normalizeGifUrl(src);

  if (!normalized || failed) {
    return (
      <div className="themed-image-surface h-full w-full rounded-[28px]" />
    );
  }

  return (
    <img
      src={normalized}
      alt={alt}
      className="h-full w-full object-contain"
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
    />
  );
};

const formatClock = (totalSeconds: number) => {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

const formatWeightKg = (value: unknown, emptyLabel = 'Chưa có tạ đề xuất'): string => {
  if (value === null || value === undefined || value === '') return emptyLabel;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return emptyLabel;
  return `${parsed} kg`;
};

const getExerciseSets = (exercise: SessionExercise | null | undefined): number =>
  Math.max(1, Number(exercise?.actual_sets ?? exercise?.sets) || 1);

const getExerciseReps = (exercise: SessionExercise | null | undefined): string =>
  String((exercise?.actual_reps ?? exercise?.reps) || '12');

const getExerciseWeightKg = (exercise: SessionExercise | null | undefined): number | null =>
  exercise?.actual_weight_kg ?? exercise?.weight_kg ?? null;

const getExerciseRestSeconds = (exercise: SessionExercise | null | undefined): number =>
  Math.max(0, Number(exercise?.actual_rest_seconds ?? exercise?.rest_seconds) || 0);

const getExerciseCompletedSets = (exercise: SessionExercise | null | undefined): number => {
  const totalSets = getExerciseSets(exercise);
  const completedSets = Math.max(0, Number(exercise?.completed_sets) || 0);
  return Math.min(totalSets, exercise?.is_completed ? Math.max(completedSets, totalSets) : completedSets);
};

const getExerciseKcal = (exercise: SessionExercise | null | undefined): number => {
  const actualKcal = Math.max(0, Math.round(Number(exercise?.actual_kcal_estimated) || 0));
  if (actualKcal > 0) return actualKcal;
  return exercise?.is_completed ? Math.max(0, Math.round(Number(exercise?.estimated_kcal) || 0)) : 0;
};

const getExercisePlannedKcal = (exercise: SessionExercise | null | undefined): number =>
  Math.max(0, Math.round(Number(exercise?.estimated_kcal) || 0));

const normalizeSessionExercise = (row: any): SessionExercise => ({
  ...row,
  id: String(row?.id || ''),
  exercise_id: String(row?.exercise_id || ''),
  name: row?.name || row?.exercises?.name || 'Bai tap',
  gif_url: normalizeGifUrl(row?.gif_url || row?.exercises?.image_url || row?.exercises?.gif_url || ''),
  order_index: Number(row?.order_index || 0),
  is_completed: !!row?.is_completed,
  exercises: row?.exercises || null,
  instructions: row?.instructions || row?.exercises?.instructions || []
});

const getResumeExerciseIndex = (items: SessionExercise[], selectedSessionId?: string): number => {
  if (items.length === 0) return 0;

  const inProgressIndex = items.findIndex((item) => {
    const completedSets = getExerciseCompletedSets(item);
    return !item.is_completed && completedSets > 0 && completedSets < getExerciseSets(item);
  });
  if (inProgressIndex >= 0) return inProgressIndex;

  const firstPendingIndex = items.findIndex((item) => !item.is_completed);
  if (firstPendingIndex >= 0) return firstPendingIndex;

  if (selectedSessionId) {
    const selectedIndex = items.findIndex((item) => item.id === selectedSessionId);
    if (selectedIndex >= 0) return selectedIndex;
  }

  return 0;
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

const getDayOfWeekIndex = (baseDate: Date): number => {
  const day = baseDate.getDay();
  return day === 0 ? 6 : day - 1;
};

const toTextList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['steps', 'instructions', 'instruction', 'technique_notes']) {
      const nested = toTextList(record[key]);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  const raw = String(value || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
    if (parsed && typeof parsed === 'object') {
      return toTextList(parsed);
    }
  } catch {
    // ignore
  }

  return raw
    .split(/\r?\n|(?:\d+\.\s*)|[;•]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getExerciseSteps = (exercise: SessionExercise): string[] => {
  const steps = toTextList(exercise.instructions || exercise.exercises?.instructions);
  if (steps.length > 0) return steps.slice(0, 3);

  return [
    'Giữ lưng trung tính và siết core suốt bài.',
    'Thực hiện chậm, kiểm soát cả chiều lên và xuống.',
    'Thở ra khi dùng lực, hít vào khi trở về.',
    'Dừng lại nếu mất form hoặc thấy đau nhói.'
  ].slice(0, 3);
};

function WorkoutSessionSkeleton() {
  return (
    <div className="dashboard-page-shell workout-session-page flex flex-col animate-pulse text-sm pb-4 md:pb-6 lg:pb-7" aria-hidden="true">
      <div className="-mt-1 mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <div className="h-4 w-4 rounded-full bg-bg-tertiary/70" />
          {SkeletonBlock('h-4 w-40 rounded-lg')}
        </div>
        <div className="h-11 w-32 rounded-full bg-bg-tertiary/70" />
      </div>

      <div className="workout-session-layout grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[28px] border border-border-primary bg-bg-secondary shadow-[0_28px_80px_rgba(0,0,0,0.45)] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="order-3 border-t border-border-primary bg-bg-secondary px-4 pb-5 pt-4 lg:col-span-2 xl:order-1 xl:col-span-1 xl:border-r xl:border-t-0">
          {SkeletonBlock('h-4 w-32')}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl border border-border-primary bg-bg-secondary px-3 py-3">
                <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-bg-tertiary/70" />
                <div className="min-w-0 flex-1">
                  {SkeletonBlock('h-4 w-[78%] rounded-lg')}
                  {SkeletonBlock('mt-2 h-3 w-24 rounded-lg')}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="order-1 relative min-h-0 overflow-y-auto bg-transparent px-4 py-5 md:px-6 lg:px-8 xl:order-2">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            {SkeletonBlock('h-4 w-24 rounded-lg')}
            {SkeletonBlock('mt-2 h-10 w-[68%] rounded-xl')}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-4 w-20 rounded-lg bg-bg-tertiary/70" />
              ))}
            </div>
            <div className="mt-4 h-10 w-36 rounded-xl border border-border-primary bg-bg-secondary/70" />

            <div className="mt-6 inline-flex w-full flex-col items-center gap-4 overflow-hidden rounded-[24px] border border-border-primary bg-bg-secondary/40 p-4 md:gap-6 md:p-6 lg:flex-row">
              <div className="flex w-full max-w-[220px] shrink-0 justify-center md:max-w-[240px]">
                <div className="aspect-square w-full rounded-xl bg-bg-tertiary/35" />
              </div>
              <div className="w-full max-w-xl">
                <div className="space-y-4 text-left">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-bg-tertiary/70" />
                      <div className="min-w-0 flex-1">
                        {SkeletonBlock('h-4 w-full rounded-lg')}
                        {index % 2 === 0 ? SkeletonBlock('mt-2 h-4 w-[88%] rounded-lg') : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-8 grid w-full max-w-xl grid-cols-1 justify-items-center gap-3 lg:max-w-4xl lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <div className="flex w-full justify-center lg:justify-end">
                <div className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary/70" />
              </div>
              <div className="order-first flex h-[168px] w-[168px] items-center justify-center rounded-full bg-bg-tertiary/45 lg:order-none">
                <div className="h-[152px] w-[152px] rounded-full bg-bg-secondary" />
              </div>
              <div className="flex w-full justify-center lg:justify-start">
                <div className="h-11 w-full rounded-xl bg-bg-tertiary/75" />
              </div>
            </div>

            <div className="mt-10 w-full">
              <div className="mb-2 flex items-center justify-between">
                {SkeletonBlock('h-4 w-24 rounded-lg')}
                {SkeletonBlock('h-4 w-10 rounded-lg')}
              </div>
              <div className="h-2 rounded-full bg-bg-tertiary/60" />
            </div>
          </div>
        </section>

        <aside className="order-2 border-t border-border-primary bg-bg-secondary px-4 pb-5 pt-4 lg:border-l lg:border-t-0 xl:order-3">
          <div className="grid min-h-full gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <section className="space-y-3 px-3">
              {SkeletonBlock('h-4 w-20 rounded-lg')}
              <div className="flex items-center gap-3">
                <div className="h-20 w-20 shrink-0 rounded-xl bg-bg-tertiary/35" />
                <div className="min-w-0 flex-1">
                  {SkeletonBlock('h-4 w-[82%] rounded-lg')}
                  {SkeletonBlock('mt-2 h-4 w-[58%] rounded-lg')}
                </div>
              </div>
            </section>

            <section className="space-y-3 px-3">
              {SkeletonBlock('h-4 w-12 rounded-lg')}
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-8 w-8 rounded-full bg-bg-tertiary/70" />
                ))}
              </div>
            </section>

            <section className="space-y-2.5 px-3">
              {SkeletonBlock('h-4 w-24 rounded-lg')}
              <div className="h-11 rounded-xl border border-border-primary bg-bg-secondary/70" />
            </section>

            <div className="px-3">
              <div className="h-11 rounded-xl border border-border-primary bg-bg-secondary/70" />
            </div>

            <section className="mx-3 rounded-3xl border border-dashed border-border-secondary p-4 sm:col-span-2 lg:mt-auto lg:col-span-1">
              {SkeletonBlock('h-4 w-16 rounded-lg')}
              {SkeletonBlock('mt-3 h-4 w-full rounded-lg')}
              {SkeletonBlock('mt-2 h-4 w-[84%] rounded-lg')}
              {SkeletonBlock('mt-2 h-4 w-[72%] rounded-lg')}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function WorkoutSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const toast = useToast();
  const alert = (message: unknown) => {
    const text = String(message || '');
    if (/lỗi|loi|không thể|khong the|thất bại|that bai/i.test(text)) {
      toast.error(text);
      return;
    }
    toast.success(text);
  };
  const state = (location.state || {}) as WorkoutSessionLocationState;
  const [isPageLoading, setIsPageLoading] = useState(() => !state.session || state.session.length === 0);
  const [, setIsRefreshing] = useState(false);
  const [sessionItems, setSessionItems] = useState<SessionExercise[]>(() =>
    [...(state.session || [])].map(normalizeSessionExercise).sort((a, b) => a.order_index - b.order_index)
  );
  const orderedSession = useMemo(
    () => [...sessionItems].sort((a, b) => a.order_index - b.order_index),
    [sessionItems]
  );
  const initialExerciseIndex = getResumeExerciseIndex(orderedSession, state.selectedSessionId);
  const initialExercise = orderedSession[initialExerciseIndex] || orderedSession[0] || null;
  const [activeIndex, setActiveIndex] = useState(initialExerciseIndex);
  const [isRunning, setIsRunning] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [workoutSessionId, setWorkoutSessionId] = useState<string | null>(null);
  const [feedbackDifficulty, setFeedbackDifficulty] = useState<WorkoutDifficulty>('just_right');
  const [feedbackPainArea, setFeedbackPainArea] = useState<WorkoutPainArea>('none');
  const [feedbackCompletedAll, setFeedbackCompletedAll] = useState(true);
  const [feedbackEnergyLevel, setFeedbackEnergyLevel] = useState(4);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [editForm, setEditForm] = useState<EditExerciseForm>({
    sets: '',
    reps: '',
    weightKg: '',
    restSeconds: ''
  });
  const [selectedRestSeconds, setSelectedRestSeconds] = useState<number>(getExerciseRestSeconds(initialExercise) || 45);
  const [completedSetsByExercise, setCompletedSetsByExercise] = useState<Record<string, number>>(() =>
    Object.fromEntries(orderedSession.map((item) => [item.id, getExerciseCompletedSets(item)]))
  );
  const [completedIds, setCompletedIds] = useState<string[]>(
    orderedSession.filter((item) => item.is_completed).map((item) => item.id)
  );
  const syncedChallengeSessionId = useRef<string | null>(null);

  const activeExercise = orderedSession[activeIndex] || null;
  const activeExerciseSets = getExerciseSets(activeExercise);
  const activeExerciseReps = getExerciseReps(activeExercise);
  const activeExerciseRestSeconds = getExerciseRestSeconds(activeExercise);
  const startingSeconds = Math.max(30, activeExerciseRestSeconds || 30);
  const [secondsLeft, setSecondsLeft] = useState(startingSeconds);
  const restOptions = [30, 45, 60, 90, 120];
  const completedSetCount = activeExercise ? Math.min(activeExerciseSets, completedSetsByExercise[activeExercise.id] || 0) : 0;
  const currentSetNumber = activeExercise ? Math.min(activeExerciseSets, completedSetCount + 1) : 1;
  const timerProgress = startingSeconds > 0 ? secondsLeft / startingSeconds : 0;
  const timerAngle = Math.max(0, Math.min(360, timerProgress * 360));

  useEffect(() => {
    setCompletedSetsByExercise(
      Object.fromEntries(orderedSession.map((item) => [item.id, getExerciseCompletedSets(item)]))
    );
    setCompletedIds(
      orderedSession
        .filter((item) => item.is_completed || getExerciseCompletedSets(item) >= getExerciseSets(item))
        .map((item) => item.id)
    );
  }, [orderedSession]);

  useEffect(() => {
    setActiveIndex((previousIndex) => {
      if (orderedSession.length === 0) return 0;
      const current = orderedSession[previousIndex];
      if (current && !current.is_completed && getExerciseCompletedSets(current) < getExerciseSets(current)) {
        return previousIndex;
      }
      return getResumeExerciseIndex(orderedSession, state.selectedSessionId);
    });
  }, [orderedSession, state.selectedSessionId]);

  useEffect(() => {
    const nextRestSeconds = getExerciseRestSeconds(activeExercise);
    setSecondsLeft(Math.max(30, nextRestSeconds || 30));
    setSelectedRestSeconds(nextRestSeconds || 45);
    setIsRunning(false);
  }, [activeExercise?.id, activeExercise?.actual_rest_seconds, activeExercise?.rest_seconds]);

  useEffect(() => {
    if (!isRunning || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [isRunning, secondsLeft]);

  useEffect(() => {
    const loadExistingWorkoutSession = async () => {
      if (!user?.id || !state.logDate) {
        setIsPageLoading(false);
        setIsRefreshing(false);
        return;
      }
      const hasWarmState = !!state.session?.length;
      setIsPageLoading(!hasWarmState);
      setIsRefreshing(hasWarmState);
      try {
        const [workoutSessionRes, dailyExercisesRes] = await Promise.all([
          supabase
            .from('daily_workout_sessions')
            .select('id')
            .eq('user_id', user.id)
            .eq('log_date', state.logDate)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('daily_exercise_sessions')
            .select(`
              *,
              exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
            `)
            .eq('user_id', user.id)
            .eq('log_date', state.logDate)
            .order('order_index', { ascending: true })
        ]);

        if (!workoutSessionRes.error && workoutSessionRes.data?.id) {
          setWorkoutSessionId(workoutSessionRes.data.id);
        }
        if (!dailyExercisesRes.error && (dailyExercisesRes.data || []).length > 0) {
          setSessionItems((dailyExercisesRes.data || []).map(normalizeSessionExercise));
        }
      } finally {
        setIsPageLoading(false);
        setIsRefreshing(false);
      }
    };

    void loadExistingWorkoutSession();
  }, [user?.id, state.logDate]);

  const totalSetsInSession = useMemo(
    () => orderedSession.reduce((sum, item) => sum + getExerciseSets(item), 0),
    [orderedSession]
  );
  
  const completedSetsInSession = orderedSession.reduce((sum, item) => {
    const totalSets = getExerciseSets(item);
    if (completedIds.includes(item.id)) return sum + totalSets;
    return sum + (completedSetsByExercise[item.id] || 0);
  }, 0);

  const progressPercent = totalSetsInSession > 0 ? (completedSetsInSession / totalSetsInSession) * 100 : 0;
  const isSessionExerciseDone = (item: SessionExercise): boolean => {
    if (completedIds.includes(item.id)) return true;
    return (completedSetsByExercise[item.id] || getExerciseCompletedSets(item)) >= getExerciseSets(item);
  };
  const allExercisesCompleted = orderedSession.length > 0 && orderedSession.every(isSessionExerciseDone);
  const nextExercise = orderedSession.find((item, index) => index > activeIndex && !isSessionExerciseDone(item)) || null;
  const activeExerciseSteps = activeExercise ? getExerciseSteps(activeExercise) : [];
  const totalActualKcal = orderedSession.reduce((sum, item) => sum + getExerciseKcal(item), 0);
  const totalPlannedKcal = orderedSession.reduce((sum, item) => sum + getExercisePlannedKcal(item), 0);

  useEffect(() => {
    if (!user?.id || !workoutSessionId || !allExercisesCompleted) return;
    if (syncedChallengeSessionId.current === workoutSessionId) return;

    const todayInVietnam = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (state.logDate && state.logDate !== todayInVietnam) return;

    syncedChallengeSessionId.current = workoutSessionId;
    void syncChallengeCheckin(user.id, 'workout', workoutSessionId).catch((challengeError) => {
      syncedChallengeSessionId.current = null;
      console.warn('Challenge workout-completion sync failed:', challengeError);
    });
  }, [allExercisesCompleted, state.logDate, user?.id, workoutSessionId]);

  const updateEditForm = (exercise: SessionExercise | null) => {
    const setsValue = getExerciseSets(exercise);
    const repsValue = getExerciseReps(exercise);
    const resolvedWeightKg = getExerciseWeightKg(exercise);
    const restValue = getExerciseRestSeconds(exercise) || 45;
    setEditForm({
      sets: String(setsValue),
      reps: repsValue,
      weightKg: resolvedWeightKg === null || resolvedWeightKg === undefined ? '' : String(resolvedWeightKg),
      restSeconds: String(restValue)
    });
  };

  const openEditModal = () => {
    updateEditForm(activeExercise);
    setIsEditModalOpen(true);
  };

  const resolveWeeklyPlanId = async (): Promise<string | null> => {
    if (!user?.id || !state.logDate) return null;

    const weekStartKey = getWeekStartKey(new Date(`${state.logDate}T00:00:00`));
    const byWeek = await supabase
      .from('weekly_plans')
      .select('id, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('week_start_date', weekStartKey)
      .limit(20);

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

    if (byWeek.error && isWeekStartColumnError(byWeek.error)) {
      const fallback = await supabase
        .from('weekly_plans')
        .select('id, created_at, updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return fallback.data?.id || null;
    }

    if (byWeek.error) throw byWeek.error;
    return pickLatestPlan(byWeek.data)?.id || null;
  };

  const syncDailyCaloriesBurned = async () => {
    if (!user?.id || !state.logDate) return;

    const sessionsRes = await supabase
      .from('daily_exercise_sessions')
      .select('actual_kcal_estimated, estimated_kcal, is_completed')
      .eq('user_id', user.id)
      .eq('log_date', state.logDate);
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
        { user_id: user.id, log_date: state.logDate, calories_burned: caloriesBurned },
        { onConflict: 'user_id,log_date' }
      );
    if (progressRes.error) throw progressRes.error;
  };

  const saveExerciseConfig = async () => {
    if (!activeExercise) return;

    const nextSets = Math.max(1, Number(editForm.sets) || 1);
    const nextReps = String(editForm.reps || '').trim() || '12';
    const trimmedWeightKg = String(editForm.weightKg || '').trim();
    const nextWeightKg = trimmedWeightKg === '' ? null : Math.max(0, Number(trimmedWeightKg) || 0);
    const nextRestSeconds = Math.max(0, Number(editForm.restSeconds) || 0);
    const previousExercise = activeExercise;
    const previousCompletedSetCount = completedSetsByExercise[previousExercise.id] || 0;
    const nextCompletedSetCount = Math.min(nextSets, previousCompletedSetCount);
    const nextIsCompleted = nextCompletedSetCount >= nextSets;
    const nextExercise = {
      ...previousExercise,
      sets: nextSets,
      reps: nextReps,
      weight_kg: nextWeightKg,
      rest_seconds: nextRestSeconds,
      is_completed: nextIsCompleted,
      actual_sets: nextSets,
      actual_reps: nextReps,
      actual_weight_kg: nextWeightKg,
      actual_rest_seconds: nextRestSeconds,
      completed_sets: nextCompletedSetCount
    };

    setIsSavingEdit(true);
    setSessionItems((prev) => prev.map((item) => (item.id === previousExercise.id ? nextExercise : item)));
    setCompletedSetsByExercise((prev) => ({
      ...prev,
      [previousExercise.id]: nextCompletedSetCount
    }));
    setCompletedIds((prev) => {
      const filtered = prev.filter((id) => id !== previousExercise.id);
      return nextIsCompleted ? [...filtered, previousExercise.id] : filtered;
    });
    setSelectedRestSeconds(nextRestSeconds);
    setSecondsLeft(Math.max(30, nextRestSeconds || 30));
    setIsRunning(false);

    try {
      const response = await fetchWithAuth(`/api/workout/daily-exercises/${previousExercise.id}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sets: nextSets,
          reps: nextReps,
          weightKg: nextWeightKg,
          restSeconds: nextRestSeconds
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Cap nhat thong so that bai'));
      }

      const savedExercise = payload?.exercise as SessionExercise | undefined;
      if (savedExercise) {
        setSessionItems((prev) =>
          prev.map((item) =>
            item.id === previousExercise.id
              ? {
                  ...savedExercise,
                  name: item.name,
                  gif_url: item.gif_url,
                  exercises: savedExercise.exercises ?? item.exercises
                }
              : item
          )
        );
      }
      setIsEditModalOpen(false);
    } catch (error: any) {
      setSessionItems((prev) => prev.map((item) => (item.id === previousExercise.id ? previousExercise : item)));
      setCompletedSetsByExercise((prev) => ({
        ...prev,
        [previousExercise.id]: previousCompletedSetCount
      }));
      setCompletedIds((prev) => {
        const filtered = prev.filter((id) => id !== previousExercise.id);
        return previousExercise.is_completed ? [...filtered, previousExercise.id] : filtered;
      });
      updateEditForm(previousExercise);
      alert('Lỗi: ' + (error?.message || 'Cập nhật thông số thất bại'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const removeExercise = async (exerciseId: string) => {
    const removeIndex = orderedSession.findIndex((item) => item.id === exerciseId);
    if (removeIndex < 0) return;

    const previousItems = sessionItems;
    const previousCompletedIds = completedIds;
    const previousCompletedSets = completedSetsByExercise;
    const nextActiveIndex =
      orderedSession.length <= 1
        ? activeIndex
        : removeIndex < activeIndex
          ? Math.max(0, activeIndex - 1)
          : Math.min(activeIndex, orderedSession.length - 2);

    setSessionItems((prev) => prev.filter((item) => item.id !== exerciseId));
    setCompletedIds((prev) => prev.filter((id) => id !== exerciseId));
    setCompletedSetsByExercise((prev) => {
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });
    setIsRunning(false);

    if (orderedSession.length > 1) {
      setActiveIndex(nextActiveIndex);
    }

    if (!user?.id || !state.logDate) return;

    const { error } = await supabase
      .from('daily_exercise_sessions')
      .delete()
      .eq('id', exerciseId)
      .eq('user_id', user.id)
      .eq('log_date', state.logDate);

    if (error) {
      setSessionItems(previousItems);
      setCompletedIds(previousCompletedIds);
      setCompletedSetsByExercise(previousCompletedSets);
      setActiveIndex(activeIndex);
      return;
    }

    try {
      await syncDailyCaloriesBurned();
    } catch (syncError) {
      console.error('Error syncing calories after removing exercise:', syncError);
    }

    const removedExercise = previousItems.find((item) => item.id === exerciseId);
    if (removedExercise && workoutSessionId) {
      const syncDeleteRes = await supabase
        .from('daily_workout_session_exercises')
        .delete()
        .eq('session_id', workoutSessionId)
        .eq('exercise_id', removedExercise.exercise_id)
        .eq('order_index', removedExercise.order_index);
      if (syncDeleteRes.error) {
        setSessionItems(previousItems);
        setCompletedIds(previousCompletedIds);
        setCompletedSetsByExercise(previousCompletedSets);
        setActiveIndex(activeIndex);
      }
    }
  };

  const submitWorkoutFeedback = async () => {
    if (!user?.id) return;

    const sessionIds = completedIds.length > 0 ? completedIds : (activeExercise ? [activeExercise.id] : []);
    if (sessionIds.length === 0) {
      navigate('/exercises');
      return;
    }

    setIsSavingFeedback(true);
    try {
      // Step 1: Upsert a daily_workout_sessions record (the new proper session table)
      let resolvedWorkoutSessionId = workoutSessionId;
      if (!resolvedWorkoutSessionId && user?.id && state.logDate) {
        const weeklyPlanId = await resolveWeeklyPlanId();
        const completedCount = completedIds.length;
        const totalSets = orderedSession.reduce((sum, item) => sum + getExerciseSets(item), 0);
        const estimatedDuration = Math.round(totalSets * 1.5);
        const estimatedCalories = orderedSession.reduce(
          (sum, item) => sum + getExerciseKcal(item),
          0
        );
        const { data: newSession, error: sessionError } = await supabase
          .from('daily_workout_sessions')
          .insert({
            user_id: user.id,
            weekly_plan_id: weeklyPlanId,
            log_date: state.logDate,
            title: orderedSession[0]?.name ? `Buổi tập ${state.logDate}` : 'Buổi tập',
            duration_minutes: estimatedDuration,
            calories_burned: estimatedCalories,
            status: completedCount >= orderedSession.length ? 'completed' : 'in_progress',
            started_at: new Date().toISOString(),
            completed_at: feedbackCompletedAll ? new Date().toISOString() : null
          })
          .select('id')
          .single();
        if (!sessionError && newSession?.id) {
          resolvedWorkoutSessionId = newSession.id;
          setWorkoutSessionId(newSession.id);

          // Step 2: Insert exercises into daily_workout_session_exercises
          const exerciseRows = orderedSession.map((item) => ({
            session_id: newSession.id,
            daily_exercise_session_id: item.id,
            weekly_plan_exercise_id: item.weekly_plan_exercise_id || null,
            exercise_id: item.exercise_id,
            sets: getExerciseSets(item),
            reps: getExerciseReps(item),
            weight_kg: getExerciseWeightKg(item),
            rest_seconds: getExerciseRestSeconds(item),
            order_index: item.order_index,
            is_completed: completedIds.includes(item.id),
            planned_sets: item.planned_sets ?? item.sets,
            planned_reps: item.planned_reps ?? item.reps,
            planned_weight_kg: item.planned_weight_kg ?? item.weight_kg,
            planned_rest_seconds: item.planned_rest_seconds ?? item.rest_seconds,
            actual_sets: getExerciseSets(item),
            actual_reps: getExerciseReps(item),
            actual_weight_kg: getExerciseWeightKg(item),
            actual_rest_seconds: getExerciseRestSeconds(item),
            target_rpe: item.target_rpe ?? 7,
            estimated_kcal: item.estimated_kcal ?? 0,
            actual_kcal_estimated: Math.max(0, Number(item.actual_kcal_estimated) || 0),
            completed_sets: completedSetsByExercise[item.id] || (completedIds.includes(item.id) ? getExerciseSets(item) : 0)
          }));
          await supabase.from('daily_workout_session_exercises').insert(exerciseRows);
        }
      }

      // Step 3: Save feedback — link to the new session if available, fallback to exercise id
      const feedbackRow = {
        user_id: user.id,
        session_id: sessionIds[0],                      // legacy: first exercise id
        workout_session_id: resolvedWorkoutSessionId,   // new: proper session id
        difficulty: feedbackDifficulty,
        completed_all: feedbackCompletedAll,
        pain_area: feedbackPainArea === 'none' ? null : feedbackPainArea,
        energy_level: feedbackEnergyLevel,
        comment: feedbackComment.trim() || null
      };
      const { error } = await supabase.from('workout_session_feedback').insert(feedbackRow);
      if (error) throw error;

      setIsFeedbackModalOpen(false);
      navigate('/exercises');
    } catch (error: any) {
      alert(`Không thể lưu feedback: ${error.message || 'Lỗi không xác định'}`);
    } finally {
      setIsSavingFeedback(false);
    }
  };

  if (isPageLoading) {
    return <WorkoutSessionSkeleton />;
  }

  if (allExercisesCompleted) {
    return (
      <div className="dashboard-page-shell flex min-h-[70vh] flex-col items-center justify-center text-sm">
        <div className="w-full max-w-3xl rounded-[28px] border border-border-primary bg-bg-secondary p-6 text-center shadow-[0_28px_80px_rgba(0,0,0,0.35)] md:p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Buổi tập hôm nay</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-text-primary md:text-4xl">
            Đã hoàn thành xong buổi tập hôm nay
          </h1>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border-primary bg-bg-tertiary p-4">
              <p className="text-2xl font-black text-text-primary">{orderedSession.length}/{orderedSession.length}</p>
              <p className="mt-1 text-xs font-bold text-text-tertiary">Bài đã xong</p>
            </div>
            <div className="rounded-2xl border border-border-primary bg-bg-tertiary p-4">
              <p className="text-2xl font-black text-text-primary">{completedSetsInSession}/{totalSetsInSession}</p>
              <p className="mt-1 text-xs font-bold text-text-tertiary">Hiệp đã xong</p>
            </div>
            <div className="rounded-2xl border border-border-primary bg-bg-tertiary p-4">
              <p className="text-2xl font-black text-text-primary">~{totalActualKcal || totalPlannedKcal}</p>
              <p className="mt-1 text-xs font-bold text-text-tertiary">Kcal ghi nhận</p>
            </div>
          </div>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate('/exercises')}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary bg-bg-tertiary px-5 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
            >
              Quay lại bài tập
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedbackCompletedAll(true);
                setIsFeedbackModalOpen(true);
              }}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
            >
              Gửi feedback
            </button>
          </div>
        </div>

        {isFeedbackModalOpen && (
          <div className="themed-modal-backdrop responsive-sheet-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4">
            <div className="responsive-sheet-panel w-full max-w-xl rounded-3xl border border-border-primary bg-bg-secondary p-5 shadow-2xl">
              <h2 className="text-xl font-black text-text-primary">Buổi tập hôm nay thế nào?</h2>
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Độ khó</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      { value: 'too_easy', label: 'Quá dễ' },
                      { value: 'just_right', label: 'Vừa sức' },
                      { value: 'too_hard', label: 'Quá khó' }
                    ].map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setFeedbackDifficulty(item.value as WorkoutDifficulty)}
                        className={`h-10 rounded-xl border text-sm font-bold transition-colors ${
                          feedbackDifficulty === item.value
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={feedbackComment}
                  onChange={(event) => setFeedbackComment(event.target.value)}
                  placeholder="Ghi chú thêm (không bắt buộc)"
                  className="h-24 w-full resize-none rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                />
              </div>
              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsFeedbackModalOpen(false)}
                  disabled={isSavingFeedback}
                  className="h-11 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-border-secondary disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={submitWorkoutFeedback}
                  disabled={isSavingFeedback}
                  className="h-11 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
                >
                  {isSavingFeedback ? 'Đang lưu...' : 'Gửi feedback'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!activeExercise) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center justify-center">
        <div className="rounded-3xl border border-border-primary bg-bg-secondary p-8 text-center">
          <p className="text-lg font-black text-text-primary">Không có dữ liệu buổi tập.</p>
          <button
            type="button"
            onClick={() => navigate('/exercises')}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-black text-text-inverse"
          >
            Quay lại bài tập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page-shell workout-session-page flex flex-col text-sm pb-4 md:pb-6 lg:pb-7">
      <div className="-mt-1 mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => navigate('/exercises')}
          className="inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Buổi tập: {activeExercise.name}
        </button>
        <button
          type="button"
          onClick={() => {
            setFeedbackCompletedAll(completedIds.length >= orderedSession.length && orderedSession.length > 0);
            setIsFeedbackModalOpen(true);
          }}
          className="inline-flex h-11 items-center justify-center self-start rounded-full border border-border-secondary bg-bg-tertiary px-4 text-xs font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent sm:self-auto"
        >
          Kết thúc buổi tập
        </button>
      </div>

      <div className="workout-session-layout grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[28px] border border-border-primary bg-bg-secondary shadow-[0_28px_80px_rgba(0,0,0,0.45)] lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="order-3 border-t border-border-primary bg-bg-secondary px-4 pt-4 pb-5 lg:col-span-2 xl:order-1 xl:col-span-1 xl:border-t-0 xl:border-r">
          <p className="text-sm font-black tracking-[0.08em] text-text-tertiary">Danh sách bài tập</p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
            {orderedSession.map((item, index) => {
              const isActive = index === activeIndex;
              const isDone = completedIds.includes(item.id);
              const itemSets = getExerciseSets(item);
              const itemCompletedSets = Math.min(itemSets, completedSetsByExercise[item.id] || getExerciseCompletedSets(item));
              const statusText = isDone
                ? 'Đã xong'
                : itemCompletedSets > 0
                  ? `Đang dở ${itemCompletedSets}/${itemSets} hiệp`
                  : 'Chưa tập';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-all ${
                    isActive
                      ? 'border border-accent/50 bg-accent/10'
                      : 'border border-border-primary bg-bg-secondary'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      isActive ? 'bg-accent text-text-inverse' : 'bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-bold ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>{item.name}</p>
                    <p className="mt-1 text-xs text-text-tertiary">{getExerciseReps(item)} rep • {getExerciseSets(item)} hiệp</p>
                    <p className={`mt-1 text-[11px] font-bold ${isDone ? 'text-accent' : itemCompletedSets > 0 ? 'text-text-primary' : 'text-text-tertiary'}`}>
                      {statusText}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-start">
                    <span
                      role="button"
                      aria-label={`Xóa ${item.name}`}
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeExercise(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          removeExercise(item.id);
                        }
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  </span>
                  {isDone && <span className="sr-only">Đã hoàn thành</span>}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="order-1 relative min-h-0 overflow-y-auto bg-transparent px-4 py-5 md:px-6 lg:px-8 xl:order-2">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">
              Bài {Math.min(activeIndex + 1, orderedSession.length)} / {orderedSession.length}
            </p>
            <h1 className="mt-2 text-3xl font-black leading-tight text-text-primary md:text-4xl">{activeExercise.name}</h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-text-secondary">
              <span>{activeExercise.exercises?.target_muscle || 'Cardio'}</span>
              <span>{activeExerciseReps} nhịp mỗi hiệp</span>
              <span>{activeExerciseSets} hiệp</span>
              <span>{formatWeightKg(getExerciseWeightKg(activeExercise))}</span>
              <span>Nghỉ {activeExerciseRestSeconds}s</span>
            </div>
            <button
              type="button"
              onClick={openEditModal}
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border-secondary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Chỉnh thông số
            </button>

            <div className="mt-6 inline-flex w-full flex-col items-center gap-4 overflow-hidden rounded-[24px] border border-border-primary bg-bg-secondary/40 p-4 md:gap-6 md:p-6 lg:flex-row">
              <div className="flex w-full max-w-[220px] shrink-0 justify-center md:max-w-[240px]">
                <div className="aspect-square w-full overflow-hidden rounded-xl bg-transparent">
                  <ExercisePreview src={activeExercise.gif_url} alt={activeExercise.name} />
                </div>
              </div>
              <div className="w-full max-w-xl flex flex-col justify-center text-left">
                <ol className="space-y-4 text-sm text-text-secondary leading-relaxed">
                  {activeExerciseSteps.map((step, index) => (
                    <li key={`${step}-${index}`} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-black text-text-inverse">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-8 grid w-full max-w-xl grid-cols-1 justify-items-center gap-3 lg:max-w-4xl lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <div className="flex w-full justify-center lg:justify-end">
                <button
                  type="button"
                  onClick={() => setIsRunning((prev) => !prev)}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-secondary bg-bg-secondary px-5 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
                >
                  {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isRunning ? 'Tạm dừng' : 'Bắt đầu'}
                </button>
              </div>

              <div
                className="order-first relative flex h-[168px] w-[168px] items-center justify-center rounded-full transition-all duration-700 lg:order-none"
                style={{
                  background: `conic-gradient(var(--accent-primary) 0deg ${timerAngle}deg, var(--accent-deep) ${timerAngle}deg 360deg)`
                }}
              >
                <div className="absolute inset-[8px] rounded-full bg-bg-secondary" />
                <div className="relative mt-1">
                  <p className="text-4xl font-black leading-none text-text-primary">{formatClock(secondsLeft)}</p>
                  <p className="mt-1.5 text-xs font-bold tracking-[0.08em] text-text-tertiary">
                    Hiệp {currentSetNumber} / {activeExerciseSets}
                  </p>
                </div>
              </div>

              <div className="flex w-full justify-center lg:justify-start">
                <button
                  type="button"
                  onClick={async () => {
                    let nextCompletedSets = Math.min(activeExerciseSets, completedSetCount + 1);
                    let nextActualKcal = Math.max(0, Number(activeExercise.actual_kcal_estimated) || 0);
                    setCompletedSetsByExercise((prev) => ({
                      ...prev,
                      [activeExercise.id]: nextCompletedSets
                    }));
                    setSessionItems((prev) =>
                      prev.map((item) =>
                        item.id === activeExercise.id
                          ? { ...item, completed_sets: nextCompletedSets, actual_kcal_estimated: nextActualKcal }
                          : item
                      )
                    );
                    try {
                      const response = await fetchWithAuth(`/api/workout/daily-exercises/${activeExercise.id}/complete-set`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          restSeconds: selectedRestSeconds
                        })
                      });
                      const payload = await response.json().catch(() => ({}));
                      if (!response.ok) {
                        throw new Error(String(payload?.error || 'Khong the dong bo du lieu set tap'));
                      }
                      const savedExercise = payload?.exercise as SessionExercise | undefined;
                      nextCompletedSets = Math.max(
                        nextCompletedSets,
                        Number(savedExercise?.completed_sets ?? nextCompletedSets)
                      );
                      nextActualKcal = Math.max(
                        0,
                        Number(savedExercise?.actual_kcal_estimated ?? nextActualKcal)
                      );
                      if (savedExercise) {
                        setSessionItems((prev) =>
                          prev.map((item) =>
                            item.id === activeExercise.id
                              ? {
                                  ...item,
                                  ...savedExercise,
                                  name: item.name,
                                  gif_url: item.gif_url,
                                  exercises: savedExercise.exercises ?? item.exercises
                                }
                              : item
                          )
                        );
                      }
                    } catch (error) {
                      console.error('Khong the dong bo du lieu set tap:', error);
                    }
                    if (nextCompletedSets >= activeExerciseSets) {
                      setSessionItems((prev) =>
                        prev.map((item) =>
                          item.id === activeExercise.id
                            ? { ...item, is_completed: true, completed_sets: nextCompletedSets, actual_kcal_estimated: nextActualKcal }
                            : item
                        )
                      );
                      setCompletedIds((prev) => (prev.includes(activeExercise.id) ? prev : [...prev, activeExercise.id]));
                      try {
                        const updateDailyRes = await supabase
                          .from('daily_exercise_sessions')
                          .update({
                            is_completed: true,
                            completed_sets: nextCompletedSets,
                            actual_kcal_estimated: nextActualKcal
                          })
                          .eq('id', activeExercise.id)
                          .eq('user_id', user?.id)
                          .eq('log_date', state.logDate || '');
                        if (updateDailyRes.error) throw updateDailyRes.error;
                      } catch (error) {
                        console.error('Không thể đồng bộ trạng thái hoàn thành bài tập:', error);
                      }
                      const nextPendingIndex = orderedSession.findIndex((item, index) =>
                        index > activeIndex && item.id !== activeExercise.id && !isSessionExerciseDone(item)
                      );
                      if (nextPendingIndex >= 0) {
                        setActiveIndex(nextPendingIndex);
                      }
                    }
                    setSecondsLeft(startingSeconds);
                    setIsRunning(false);
                  }}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse hover:bg-accent-hover"
                >
                  Hoàn thành hiệp
                </button>
              </div>
            </div>

            <div className="mt-10 w-full">
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-text-secondary">
                <span>Tiến độ bài tập</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-2 rounded-full bg-bg-tertiary">
                <div
                  className="h-2 rounded-full bg-accent transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="order-2 border-t border-border-primary bg-bg-secondary px-4 pt-4 pb-5 lg:border-t-0 lg:border-l xl:order-3">
          <div className="grid min-h-full gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <section className="space-y-3 px-3">
              <p className="text-sm font-black tracking-[0.08em] text-text-tertiary">Tiếp theo</p>
              {nextExercise ? (
                <div className="flex items-center gap-3">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-bg-tertiary">
                    <ExercisePreview src={nextExercise.gif_url} alt={nextExercise.name} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black leading-5 text-text-primary">{nextExercise.name}</p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                      {getExerciseSets(nextExercise)} hiệp x {getExerciseReps(nextExercise)} lần
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-6 text-text-secondary">Bạn đã ở bài cuối cùng.</p>
              )}
            </section>

            <section className="space-y-3 px-3">
              <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Hiệp</p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: activeExerciseSets }).map((_, index) => {
                  const isCompletedSet = index < completedSetCount;
                  const isCurrentSet = index === completedSetCount && completedSetCount < activeExerciseSets;
                  return (
                    <span
                      key={index}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${
                        isCompletedSet || isCurrentSet
                          ? 'bg-accent text-text-inverse'
                          : 'border border-border-primary bg-bg-secondary text-text-tertiary'
                      }`}
                    >
                      {index + 1}
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2.5 px-3">
              <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Nghỉ giữa hiệp</p>
              <select
                value={selectedRestSeconds}
                onChange={(e) => {
                  const next = Number(e.target.value) || 45;
                  setSelectedRestSeconds(next);
                  setSecondsLeft(next);
                  setIsRunning(false);
                }}
                className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 text-sm font-bold text-text-primary outline-none transition-colors hover:border-border-secondary focus:border-accent"
              >
                {restOptions.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} giây
                  </option>
                ))}
              </select>
            </section>

            <div className="px-3">
              <button
                type="button"
                onClick={() => {
                  setIsRunning(false);
                  setSecondsLeft(0);
                }}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
              >
                Bỏ qua nghỉ
              </button>
            </div>

            <section className="mx-3 rounded-3xl border border-dashed border-border-secondary p-4 sm:col-span-2 lg:mt-auto lg:col-span-1">
              <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Ghi chú</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Giữ nhịp đều, siết core và hạ người có kiểm soát. Nếu mất form, giảm tốc độ trước khi tăng nhịp.
              </p>
            </section>
          </div>
        </aside>
      </div>

      {isFeedbackModalOpen && (
        <div className="themed-modal-backdrop responsive-sheet-backdrop fixed inset-0 z-[150] flex items-center justify-center px-4">
          <div className="responsive-sheet-panel w-full max-w-xl rounded-3xl border border-border-primary bg-bg-secondary p-5 shadow-2xl">
            <h2 className="text-xl font-black text-text-primary">Buổi tập hôm nay thế nào?</h2>

            <div className="mt-5 space-y-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Độ khó</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { value: 'too_easy', label: 'Quá dễ' },
                    { value: 'just_right', label: 'Vừa sức' },
                    { value: 'too_hard', label: 'Quá khó' }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFeedbackDifficulty(item.value as WorkoutDifficulty)}
                      className={`h-10 rounded-xl border text-sm font-bold transition-colors ${
                        feedbackDifficulty === item.value
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Bạn có đau ở đâu không?</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    { value: 'none', label: 'Không' },
                    { value: 'knee', label: 'Gối' },
                    { value: 'back', label: 'Lưng' },
                    { value: 'shoulder', label: 'Vai' },
                    { value: 'wrist', label: 'Cổ tay' }
                  ].map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFeedbackPainArea(item.value as WorkoutPainArea)}
                      className={`h-10 rounded-xl border text-sm font-bold transition-colors ${
                        feedbackPainArea === item.value
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Bạn có hoàn thành hết không?</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackCompletedAll(true)}
                    className={`h-10 rounded-xl border text-sm font-bold transition-colors ${
                      feedbackCompletedAll
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                    }`}
                  >
                    Có
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackCompletedAll(false)}
                    className={`h-10 rounded-xl border text-sm font-bold transition-colors ${
                      !feedbackCompletedAll
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                    }`}
                  >
                    Không
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Năng lượng buổi tập</p>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFeedbackEnergyLevel(value)}
                      className={`h-10 rounded-xl border text-sm font-black transition-colors ${
                        feedbackEnergyLevel === value
                          ? 'border-accent bg-accent/15 text-accent'
                          : 'border-border-primary bg-bg-secondary text-text-secondary hover:border-accent/30'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={feedbackComment}
                onChange={(event) => setFeedbackComment(event.target.value)}
                placeholder="Ghi chú thêm (không bắt buộc)"
                className="h-24 w-full resize-none rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIsFeedbackModalOpen(false);
                  navigate('/exercises');
                }}
                disabled={isSavingFeedback}
                className="h-11 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-border-secondary disabled:opacity-50"
              >
                Bỏ qua
              </button>
              <button
                type="button"
                onClick={submitWorkoutFeedback}
                disabled={isSavingFeedback}
                className="h-11 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {isSavingFeedback ? 'Đang lưu...' : 'Gửi feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditModalOpen && activeExercise && (
        <div className="themed-modal-backdrop responsive-sheet-backdrop fixed inset-0 z-[140] flex items-center justify-center px-4">
          <div className="responsive-sheet-panel w-full max-w-md rounded-3xl border border-border-primary bg-bg-secondary p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Chỉnh thông số</p>
                <h2 className="mt-1 text-xl font-black text-text-primary">{activeExercise.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => !isSavingEdit && setIsEditModalOpen(false)}
                className="text-sm font-bold text-text-tertiary transition-colors hover:text-text-primary"
              >
                Đóng
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-text-tertiary">Số hiệp</span>
                <input
                  type="number"
                  min="1"
                  value={editForm.sets}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, sets: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 text-sm font-bold text-text-primary outline-none transition-colors focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-text-tertiary">Số lần</span>
                <input
                  type="text"
                  value={editForm.reps}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, reps: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 text-sm font-bold text-text-primary outline-none transition-colors focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-text-tertiary">Mức tạ (kg)</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={editForm.weightKg}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, weightKg: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 text-sm font-bold text-text-primary outline-none transition-colors focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-text-tertiary">Nghỉ (giây)</span>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={editForm.restSeconds}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, restSeconds: e.target.value }))}
                  className="h-11 w-full rounded-xl border border-border-primary bg-bg-secondary px-3 text-sm font-bold text-text-primary outline-none transition-colors focus:border-accent"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSavingEdit}
                className="h-11 rounded-xl border border-border-primary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-border-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={saveExerciseConfig}
                disabled={isSavingEdit}
                className="h-11 rounded-xl bg-accent px-5 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
