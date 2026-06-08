import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pause, Play, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

interface SessionExercise {
  id: string;
  exercise_id: string;
  name: string;
  gif_url: string;
  sets: number;
  reps: string;
  weight_kg: number;
  rest_seconds: number;
  order_index: number;
  is_completed: boolean;
  instructions?: string[] | string;
  exercises?: {
    target_muscle?: string;
    body_part?: string;
    instructions?: string[] | string;
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
      <div className="h-full w-full rounded-[28px] bg-[radial-gradient(circle_at_top,_rgb(255_255_255_/_0.05),_transparent_55%),linear-gradient(180deg,_#171717,_#101010)]" />
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

  const raw = String(value || '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
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
    <div className="dashboard-page-shell flex flex-col overflow-hidden rounded-xl border border-border-primary/50 bg-bg-secondary/40 animate-pulse pb-4 md:pb-6 lg:pb-7">
      <div className="flex items-center justify-between border-b border-border-primary/50 px-4 py-3 md:px-6">
        <div className="h-6 w-64 rounded bg-bg-tertiary/60" />
        <div className="h-9 w-28 rounded-full bg-bg-tertiary/60" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="border-r border-border-primary/50 px-4 pt-4 pb-5">
          <div className="h-4 w-32 rounded bg-bg-tertiary/60" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
            ))}
          </div>
        </aside>
        <section className="min-h-0 px-4 py-5 md:px-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center">
            <div className="h-4 w-28 rounded bg-bg-tertiary/60" />
            <div className="mt-2 h-10 w-2/3 rounded bg-bg-tertiary/60" />
            <div className="mt-2 h-4 w-72 rounded bg-bg-tertiary/50" />
            <div className="mt-6 h-72 w-full rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
            <div className="mt-8 h-40 w-[420px] max-w-full rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
          </div>
        </section>
        <aside className="border-l border-border-primary/50 px-4 pt-4 pb-5">
          <div className="space-y-4">
            <div className="h-24 rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
            <div className="h-24 rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
            <div className="h-24 rounded-2xl border border-border-primary/40 bg-bg-tertiary/20" />
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
  const [isPageLoading, setIsPageLoading] = useState(true);
  const state = (location.state || {}) as WorkoutSessionLocationState;
  const [sessionItems, setSessionItems] = useState<SessionExercise[]>(() =>
    [...(state.session || [])].sort((a, b) => a.order_index - b.order_index)
  );
  const orderedSession = useMemo(
    () => [...sessionItems].sort((a, b) => a.order_index - b.order_index),
    [sessionItems]
  );

  const initialIndex = useMemo(() => {
    if (!state.selectedSessionId) return 0;
    const found = orderedSession.findIndex((item) => item.id === state.selectedSessionId);
    return found >= 0 ? found : 0;
  }, [orderedSession, state.selectedSessionId]);

  const initialExercise = orderedSession[initialIndex] || orderedSession[0] || null;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
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
  const [selectedRestSeconds, setSelectedRestSeconds] = useState<number>(initialExercise?.rest_seconds || 45);
  const [completedSetsByExercise, setCompletedSetsByExercise] = useState<Record<string, number>>({});
  const [completedIds, setCompletedIds] = useState<string[]>(
    orderedSession.filter((item) => item.is_completed).map((item) => item.id)
  );

  const activeExercise = orderedSession[activeIndex] || null;
  const startingSeconds = Math.max(30, activeExercise?.rest_seconds || 30);
  const [secondsLeft, setSecondsLeft] = useState(startingSeconds);
  const restOptions = [30, 45, 60, 90, 120];
  const completedSetCount = activeExercise ? (completedSetsByExercise[activeExercise.id] || 0) : 0;
  const currentSetNumber = activeExercise ? Math.min(activeExercise.sets, completedSetCount + 1) : 1;
  const timerProgress = startingSeconds > 0 ? secondsLeft / startingSeconds : 0;
  const timerAngle = Math.max(0, Math.min(360, timerProgress * 360));

  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    setSecondsLeft(Math.max(30, activeExercise?.rest_seconds || 30));
    setSelectedRestSeconds(activeExercise?.rest_seconds || 45);
    setIsRunning(false);
  }, [activeExercise?.id, activeExercise?.rest_seconds]);

  useEffect(() => {
    if (!isRunning || secondsLeft <= 0) return;
    const timer = window.setTimeout(() => setSecondsLeft((prev) => prev - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [isRunning, secondsLeft]);

  useEffect(() => {
    const id = window.setTimeout(() => setIsPageLoading(false), 200);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const loadExistingWorkoutSession = async () => {
      if (!user?.id || !state.logDate) return;
      const { data, error } = await supabase
        .from('daily_workout_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('log_date', state.logDate)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data?.id) {
        setWorkoutSessionId(data.id);
      }
    };

    void loadExistingWorkoutSession();
  }, [user?.id, state.logDate]);

  const totalSetsInSession = useMemo(
    () => orderedSession.reduce((sum, item) => sum + item.sets, 0),
    [orderedSession]
  );
  
  const completedSetsInSession = orderedSession.reduce((sum, item) => {
    if (completedIds.includes(item.id)) return sum + item.sets;
    return sum + (completedSetsByExercise[item.id] || 0);
  }, 0);

  const progressPercent = totalSetsInSession > 0 ? (completedSetsInSession / totalSetsInSession) * 100 : 0;
  const nextExercise = orderedSession[activeIndex + 1] || null;
  const activeExerciseSteps = activeExercise ? getExerciseSteps(activeExercise) : [];

  const updateEditForm = (exercise: SessionExercise | null) => {
    setEditForm({
      sets: String(Math.max(1, Number(exercise?.sets) || 1)),
      reps: String(exercise?.reps || '12'),
      weightKg: String(Math.max(0, Number(exercise?.weight_kg) || 0)),
      restSeconds: String(Math.max(0, Number(exercise?.rest_seconds) || 45))
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

  const syncDailyWorkoutSessionExercise = async (
    exercise: SessionExercise,
    updates: Partial<Pick<SessionExercise, 'sets' | 'reps' | 'weight_kg' | 'rest_seconds' | 'is_completed'>>
  ) => {
    if (!workoutSessionId) return;
    const { error } = await supabase
      .from('daily_workout_session_exercises')
      .update(updates)
      .eq('session_id', workoutSessionId)
      .eq('exercise_id', exercise.exercise_id)
      .eq('order_index', exercise.order_index);
    if (error) throw error;
  };

  const saveExerciseConfig = async () => {
    if (!activeExercise) return;

    const nextSets = Math.max(1, Number(editForm.sets) || 1);
    const nextReps = String(editForm.reps || '').trim() || '12';
    const nextWeightKg = Math.max(0, Number(editForm.weightKg) || 0);
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
      is_completed: nextIsCompleted
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
      const updateDaily = await supabase
        .from('daily_exercise_sessions')
        .update({
          sets: nextSets,
          reps: nextReps,
          weight_kg: nextWeightKg,
          rest_seconds: nextRestSeconds,
          is_completed: nextIsCompleted
        })
        .eq('id', previousExercise.id)
        .eq('user_id', user?.id)
        .eq('log_date', state.logDate || '');
      if (updateDaily.error) throw updateDaily.error;

      await syncDailyWorkoutSessionExercise(previousExercise, {
        sets: nextSets,
        reps: nextReps,
        weight_kg: nextWeightKg,
        rest_seconds: nextRestSeconds,
        is_completed: nextIsCompleted
      });

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
        const totalSets = orderedSession.reduce((sum, item) => sum + item.sets, 0);
        const estimatedDuration = Math.round(totalSets * 1.5);
        const estimatedCalories = Math.round(completedSetsInSession * 4);
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
            exercise_id: item.exercise_id,
            sets: item.sets,
            reps: item.reps,
            weight_kg: item.weight_kg,
            rest_seconds: item.rest_seconds,
            order_index: item.order_index,
            is_completed: completedIds.includes(item.id)
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

  if (!activeExercise) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center justify-center">
        <div className="rounded-3xl border border-border-primary bg-bg-secondary p-8 text-center">
          <p className="text-lg font-black text-text-primary">Không có dữ liệu buổi tập.</p>
          <button
            type="button"
            onClick={() => navigate('/exercises')}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-black text-black"
          >
            Quay lại bài tập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page-shell flex flex-col text-sm pb-4 md:pb-6 lg:pb-7">
      <div className="-mt-1 mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/exercises')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Buổi tập: {activeExercise.name}
        </button>
        <button
          type="button"
          onClick={() => {
            setFeedbackCompletedAll(completedIds.length >= orderedSession.length && orderedSession.length > 0);
            setIsFeedbackModalOpen(true);
          }}
          className="rounded-full border border-border-secondary bg-bg-tertiary px-4 py-2 text-xs font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
        >
          Kết thúc buổi tập
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-border-primary bg-bg-secondary shadow-[0_28px_80px_rgba(0,0,0,0.45)] xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="border-r border-border-primary bg-bg-secondary px-4 pt-4 pb-5">
          <p className="text-sm font-black tracking-[0.08em] text-text-tertiary">Danh sách bài tập</p>
          <div className="mt-4 space-y-2">
            {orderedSession.map((item, index) => {
              const isActive = index === activeIndex;
              const isDone = completedIds.includes(item.id);
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
                      isActive ? 'bg-accent text-black' : 'bg-bg-tertiary text-text-tertiary'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-bold ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}>{item.name}</p>
                    <p className="mt-1 text-xs text-text-tertiary">{item.reps} rep • {item.sets} hiệp</p>
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

        <section className="relative min-h-0 overflow-y-auto px-4 py-5 md:px-8 bg-transparent">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">
              Bài {Math.min(activeIndex + 1, orderedSession.length)} / {orderedSession.length}
            </p>
            <h1 className="mt-2 text-3xl font-black text-text-primary md:text-4xl">{activeExercise.name}</h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold text-text-secondary">
              <span>{activeExercise.exercises?.target_muscle || 'Cardio'}</span>
              <span>{activeExercise.reps} nhịp mỗi hiệp</span>
              <span>{activeExercise.sets} hiệp</span>
              <span>{activeExercise.weight_kg} kg</span>
              <span>Nghỉ {activeExercise.rest_seconds}s</span>
            </div>
            <button
              type="button"
              onClick={openEditModal}
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border-secondary bg-bg-secondary px-4 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Chỉnh thông số
            </button>

            <div className="mt-6 inline-flex flex-col md:flex-row items-center gap-4 md:gap-6 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/40 p-4 md:py-4 md:px-6">
              <div className="w-48 md:w-[240px] shrink-0 flex justify-center">
                <div className="aspect-square w-full overflow-hidden rounded-xl bg-transparent">
                  <ExercisePreview src={activeExercise.gif_url} alt={activeExercise.name} />
                </div>
              </div>
              <div className="w-full max-w-xs md:max-w-sm flex flex-col justify-center text-left">
                <ol className="space-y-4 text-sm text-text-secondary leading-relaxed">
                  {activeExerciseSteps.map((step, index) => (
                    <li key={`${step}-${index}`} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-black text-black">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-8 grid w-full max-w-4xl grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsRunning((prev) => !prev)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border-secondary bg-bg-secondary px-5 text-sm font-bold text-text-primary transition-colors hover:border-accent/30 hover:text-accent"
                >
                  {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isRunning ? 'Tạm dừng' : 'Bắt đầu'}
                </button>
              </div>

              <div
                className="relative flex h-[160px] w-[160px] items-center justify-center rounded-full transition-all duration-700"
                style={{
                  background: `conic-gradient(var(--accent-primary) 0deg ${timerAngle}deg, var(--accent-deep) ${timerAngle}deg 360deg)`
                }}
              >
                <div className="absolute inset-[8px] rounded-full bg-bg-secondary" />
                <div className="relative mt-1">
                  <p className="text-4xl font-black leading-none text-text-primary">{formatClock(secondsLeft)}</p>
                  <p className="mt-1.5 text-xs font-bold tracking-[0.08em] text-text-tertiary">
                    Hiệp {currentSetNumber} / {activeExercise.sets}
                  </p>
                </div>
              </div>

              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={async () => {
                    const nextCompletedSets = Math.min(activeExercise.sets, completedSetCount + 1);
                    setCompletedSetsByExercise((prev) => ({
                      ...prev,
                      [activeExercise.id]: nextCompletedSets
                    }));
                    if (nextCompletedSets >= activeExercise.sets) {
                      setSessionItems((prev) =>
                        prev.map((item) => (item.id === activeExercise.id ? { ...item, is_completed: true } : item))
                      );
                      setCompletedIds((prev) => (prev.includes(activeExercise.id) ? prev : [...prev, activeExercise.id]));
                      try {
                        const updateDailyRes = await supabase
                          .from('daily_exercise_sessions')
                          .update({ is_completed: true })
                          .eq('id', activeExercise.id)
                          .eq('user_id', user?.id)
                          .eq('log_date', state.logDate || '');
                        if (updateDailyRes.error) throw updateDailyRes.error;
                        await syncDailyWorkoutSessionExercise(activeExercise, { is_completed: true });
                      } catch (error) {
                        console.error('Không thể đồng bộ trạng thái hoàn thành bài tập:', error);
                      }
                      if (activeIndex < orderedSession.length - 1) {
                        setActiveIndex((prev) => prev + 1);
                      }
                    }
                    setSecondsLeft(startingSeconds);
                    setIsRunning(false);
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-black text-black hover:bg-accent-hover"
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

        <aside className="border-l border-border-primary bg-bg-secondary px-4 pt-4 pb-5">
          <div className="flex min-h-full flex-col gap-5">
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
                      {nextExercise.sets} hiệp x {nextExercise.reps} lần
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-6 text-text-secondary">Bạn đã ở bài cuối cùng.</p>
              )}
            </section>

            <section className="space-y-3 px-3">
              <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Hiệp</p>
              <div className="flex gap-2">
                {Array.from({ length: Math.min(activeExercise.sets, 4) }).map((_, index) => {
                  const isCompletedSet = index < completedSetCount;
                  const isCurrentSet = index === completedSetCount && completedSetCount < activeExercise.sets;
                  return (
                    <span
                      key={index}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${
                        isCompletedSet || isCurrentSet
                          ? 'bg-accent text-black'
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

            <section className="mt-auto mx-3 rounded-3xl border border-dashed border-border-secondary p-4">
              <p className="text-xs font-black tracking-[0.08em] text-text-tertiary">Ghi chú</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Giữ nhịp đều, siết core và hạ người có kiểm soát. Nếu mất form, giảm tốc độ trước khi tăng nhịp.
              </p>
            </section>
          </div>
        </aside>
      </div>

      {isFeedbackModalOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl rounded-3xl border border-border-primary bg-bg-secondary p-5 shadow-2xl">
            <h2 className="text-xl font-black text-text-primary">Buổi tập hôm nay thế nào?</h2>

            <div className="mt-5 space-y-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.08em] text-text-tertiary">Độ khó</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
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
                <div className="mt-2 grid grid-cols-5 gap-2">
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
                className="h-11 rounded-xl bg-accent px-5 text-sm font-black text-black transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {isSavingFeedback ? 'Đang lưu...' : 'Gửi feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditModalOpen && activeExercise && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-3xl border border-border-primary bg-bg-secondary p-5 shadow-2xl">
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
                className="h-11 rounded-xl bg-accent px-5 text-sm font-black text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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
