import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, AlertCircle, Calendar, ImageOff,
  ChevronDown, SlidersHorizontal, RotateCcw, Play, Eye, Layers, Repeat, Dumbbell, Flame
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { estimateExerciseKcalRealistic, parseRepsInput } from '../utils/Kcal';
import { type ExerciseDetailItem } from '../components/ExerciseDetailOverlay';

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
  exercises?: {
    name?: string;
    gif_url?: string;
    image_url?: string;
    target_muscle?: string;
    body_part?: string;
    instructions?: string[] | string;
  } | null;
}

interface ExerciseLibraryItem extends ExerciseDetailItem {
  id: string;
  name: string;
  body_part: string;
  target_muscle: string;
  gif_url: string;
  equipment?: string;
}

type ExercisesPageCache = {
  vnToday: string;
  session: SessionExercise[];
  library: ExerciseLibraryItem[];
  userWeightKg: number;
};

let exercisesPageCache: ExercisesPageCache | null = null;
const LIBRARY_VISIBLE_BATCH_SIZE = 12;

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

const getVietnamDayIndex = (date = new Date()): number => {
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIMEZONE,
    weekday: 'short'
  }).format(date);
  const mapping: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };
  return mapping[dayName] ?? 0;
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

const normalizeGifUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const normalizeForMatch = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

const equipmentMatchesPreference = (exerciseEquipment: string | undefined, preference: string): boolean => {
  const pref = normalizeForMatch(preference);
  if (!pref) return true;
  if (pref.includes('day du ta') || pref.includes('may moc') || pref.includes('gym')) return true;

  const equipment = normalizeForMatch(exerciseEquipment);

  if (pref.includes('khong dung cu')) {
    return equipment.includes('khong dung cu') || equipment.includes('bodyweight') || equipment.includes('body weight');
  }

  if (pref.includes('ta don')) {
    return (
      equipment.includes('ta don') ||
      equipment.includes('dumbbell') ||
      equipment.includes('khong dung cu') ||
      equipment.includes('bodyweight') ||
      equipment.includes('body weight')
    );
  }

  if (pref.includes('day khang luc') || pref.includes('resistance')) {
    return (
      equipment.includes('day khang luc') ||
      equipment.includes('resistance band') ||
      equipment.includes('band') ||
      equipment.includes('day thung') ||
      equipment.includes('rope') ||
      equipment.includes('khong dung cu') ||
      equipment.includes('bodyweight') ||
      equipment.includes('body weight')
    );
  }

  return true;
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
const ExerciseThumb = ({ src, alt }: { src?: string; alt: string }) => {
  const candidates = useMemo(() => {
    const primary = String(src || '').trim();
    if (!primary) return [];

    const normalized = primary.startsWith('http://') ? `https://${primary.slice(7)}` : primary;
    const urlWithoutProtocol = normalized.replace(/^https?:\/\//, '');
    const proxy = `https://images.weserv.nl/?url=${encodeURIComponent(urlWithoutProtocol)}`;

    return [normalized, proxy];
  }, [src]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  const currentSrc = candidates[candidateIndex];
  const hasError = !currentSrc;

  if (hasError) {
    return (
      <div className="w-full h-full bg-bg-quaternary flex items-center justify-center text-text-tertiary">
        <ImageOff className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      loading="lazy"
      className="w-full h-full object-cover"
      onError={() => {
        if (candidateIndex < candidates.length - 1) {
          setCandidateIndex(candidateIndex + 1);
        } else {
          setCandidateIndex(candidates.length);
        }
      }}
      referrerPolicy="no-referrer"
    />
  );
};


// ====================================================================
export const ExercisesSkeleton = () => {
  return (
    <div className="flex-1 min-h-0 max-w-[1700px] mx-auto w-full flex flex-col gap-4 md:gap-5 animate-pulse">
      <div className="bg-bg-secondary/40 border border-border-primary/50 rounded-xl p-4 md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-44 bg-bg-tertiary rounded-lg" />
            <div className="h-4 w-32 bg-bg-tertiary rounded-md" />
          </div>
        </div>

        <div className="bg-bg-tertiary/35 border border-border-primary/50 rounded-xl p-3 md:p-4">
          <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_380px] gap-4 md:gap-5 items-stretch">
            <div className="rounded-xl border border-border-primary/30 bg-bg-tertiary/20 h-[180px] md:h-[210px] xl:h-full" />
            <div className="flex flex-col justify-center gap-4 md:gap-5 min-w-0">
              <div className="h-7 w-2/3 bg-bg-tertiary rounded-lg" />
              <div className="ml-0 flex flex-wrap items-start gap-x-14 gap-y-3">
                <div className="h-10 w-24 bg-bg-tertiary rounded-lg" />
                <div className="h-10 w-24 bg-bg-tertiary rounded-lg" />
                <div className="h-10 w-24 bg-bg-tertiary rounded-lg" />
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-start gap-2.5">
                <div className="h-10 w-36 bg-bg-tertiary rounded-xl" />
                <div className="h-10 w-28 bg-bg-tertiary rounded-xl" />
              </div>
            </div>
            <div className="relative rounded-xl p-3 md:p-4 xl:pt-1 xl:pl-6">
              <div className="mb-1 h-6 w-40 bg-bg-tertiary rounded-lg" />
              <div className="space-y-2.5 max-h-[240px]">
                <div className="h-8 w-full bg-bg-tertiary rounded-lg" />
                <div className="h-8 w-full bg-bg-tertiary rounded-lg" />
                <div className="h-8 w-full bg-bg-tertiary rounded-lg" />
                <div className="h-8 w-full bg-bg-tertiary rounded-lg" />
                <div className="h-8 w-full bg-bg-tertiary rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-secondary/40 border border-border-primary/50 rounded-xl p-4 md:p-5">
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <div className="h-6 w-40 bg-bg-tertiary rounded-lg" />
            <div className="mt-2 flex flex-wrap gap-2">
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
              <div className="h-7 w-16 bg-bg-tertiary rounded-lg" />
            </div>
          </div>
          <div className="h-8 w-24 bg-bg-tertiary rounded-lg shrink-0" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border-primary/30 bg-bg-tertiary/20">
              <div className="relative aspect-[16/9] bg-bg-secondary/50" />
              <div className="p-3">
                <div className="h-4 w-3/4 bg-bg-tertiary rounded" />
                <div className="mt-2 h-3 w-5/6 bg-bg-tertiary rounded" />
                <div className="mt-1 h-3 w-1/2 bg-bg-tertiary rounded" />
                <div className="mt-3 h-8 w-full bg-bg-secondary/50 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function Exercises() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const cacheForToday =
    exercisesPageCache && exercisesPageCache.vnToday === getVietnamDateKey()
      ? exercisesPageCache
      : null;

  const [session, setSession] = useState<SessionExercise[]>(() => cacheForToday?.session || []);
  const [isLoading, setIsLoading] = useState(() => !cacheForToday);
  const [isSavingExercise, setIsSavingExercise] = useState(false);
  const [library, setLibrary] = useState<ExerciseLibraryItem[]>(() => cacheForToday?.library || []);
  const [vnToday, setVnToday] = useState(() => getVietnamDateKey());
  const [userWeightKg, setUserWeightKg] = useState(() => cacheForToday?.userWeightKg || 70);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [appliedMuscleFilter, setAppliedMuscleFilter] = useState('all');
  const [appliedEquipmentFilter, setAppliedEquipmentFilter] = useState('all');
  const [draftEquipmentFilter, setDraftEquipmentFilter] = useState('all');
  const [visibleLibraryCount, setVisibleLibraryCount] = useState(LIBRARY_VISIBLE_BATCH_SIZE);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);

  const currentDayIdx = getVietnamDayIndex();

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextVnToday = getVietnamDateKey();
      setVnToday(prev => (prev === nextVnToday ? prev : nextVnToday));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (user) {
      loadSession(!!cacheForToday);
    } else {
      setSession([]);
      loadLibrary();
    }
  }, [user, vnToday]);

  useEffect(() => {
    const loadWeight = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('body_metrics')
        .select('weight')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setUserWeightKg(Math.max(45, Number(data?.weight || 70)));
    };
    loadWeight();
  }, [user]);

  const loadSession = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      // 1. Check if session already exists for today
      const { data: existingSession } = await supabase
        .from('daily_exercise_sessions')
        .select(`
          *,
          exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
        `)
        .eq('user_id', user?.id)
        .eq('log_date', vnToday)
        .order('order_index');

      if (existingSession && existingSession.length > 0) {
        setSession(existingSession.map(s => ({
          ...s,
          name: (s.exercises as any)?.name || 'Exercise',
          gif_url: normalizeGifUrl((s.exercises as any)?.image_url || '')
        })));
      } else {
        // 2. No session today. Try to clone from weekly plan
        await clonePlanToToday();
      }
      await loadLibrary(silent);

    } catch (e) {
      console.error('Error loading session:', e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const loadLibrary = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const { data: libData } = await supabase.from('exercises').select('*').limit(100);
      if (libData) {
        setLibrary(
          libData.map((item: any) => ({
            ...item,
            gif_url: normalizeGifUrl(item?.gif_url ?? item?.gifUrl ?? item?.gif ?? ''),
            image_url: normalizeGifUrl(item?.image_url ?? item?.imageUrl ?? ''),
            equipment: String(item?.equipment || '')
          }))
        );
      } else {
        setLibrary([]);
      }
    } catch (e) {
      console.error('Error loading library:', e);
      setLibrary([]);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const clonePlanToToday = async () => {
    const weekStartKey = getWeekStartKey(new Date(`${vnToday}T00:00:00`));
    let plan: any = null;
    const byWeek = await supabase
      .from('weekly_plans')
      .select('id')
      .eq('user_id', user?.id)
      .eq('week_start_date', weekStartKey)
      .maybeSingle();

    if (byWeek.error && isWeekStartColumnError(byWeek.error)) {
      const fallback = await supabase
        .from('weekly_plans')
        .select('id')
        .eq('user_id', user?.id)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      plan = fallback.data;
    } else {
      plan = byWeek.data;
    }

    if (plan) {
      const { data: planExercises } = await supabase
        .from('weekly_plan_exercises')
        .select('*')
        .eq('weekly_plan_id', plan.id)
        .eq('day_of_week', currentDayIdx);

      if (planExercises && planExercises.length > 0 && !planExercises[0].is_rest_day) {
        const sessionItems = planExercises.map((p, idx) => ({
          user_id: user?.id,
          log_date: vnToday,
          exercise_id: p.exercise_id,
          sets: p.sets,
          reps: p.reps,
          weight_kg: p.weight_kg,
          rest_seconds: p.rest_seconds,
          order_index: idx,
          is_completed: false
        }));

        const { data: inserted, error } = await supabase
          .from('daily_exercise_sessions')
          .insert(sessionItems)
          .select(`
            *,
            exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
          `);

        if (inserted) {
          setSession(inserted.map(s => ({
            ...s,
            name: (s.exercises as any)?.name || 'Exercise',
            gif_url: normalizeGifUrl((s.exercises as any)?.image_url || '')
          })));

          // Priority 3: Sync to new daily_workout_sessions table for parallel migration
          try {
            const totalSets = planExercises.reduce((sum, item) => sum + (item.sets || 3), 0);
            const estimatedDuration = Math.round(totalSets * 1.5);
            const { data: newSession, error: sessionError } = await supabase
              .from('daily_workout_sessions')
              .insert({
                user_id: user?.id,
                weekly_plan_id: plan.id,
                log_date: vnToday,
                title: inserted[0]?.exercises ? `Buổi tập ${vnToday}` : 'Buổi tập',
                duration_minutes: estimatedDuration,
                calories_burned: 0,
                status: 'planned'
              })
              .select('id')
              .single();

            if (!sessionError && newSession?.id) {
              const newExerciseRows = inserted.map((item) => ({
                session_id: newSession.id,
                exercise_id: item.exercise_id,
                sets: item.sets,
                reps: item.reps,
                weight_kg: item.weight_kg,
                rest_seconds: item.rest_seconds,
                order_index: item.order_index,
                is_completed: false
              }));
              await supabase.from('daily_workout_session_exercises').insert(newExerciseRows);
            }
          } catch (e) {
            console.error('Lỗi khi đồng bộ sang bảng workout sessions mới:', e);
          }
        }
      }
    }
  };

  const toggleComplete = async (id: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    setSession(prev => prev.map(s => s.id === id ? { ...s, is_completed: newStatus } : s));

    const { error } = await supabase
      .from('daily_exercise_sessions')
      .update({ is_completed: newStatus })
      .eq('id', id);
    if (error) {
      setSession(prev => prev.map(s => s.id === id ? { ...s, is_completed: currentStatus } : s));
      alert("Lỗi: " + (error.message || 'Cập nhật trạng thái thất bại'));
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
      alert("Lỗi: " + (deleteSessionError.message || 'Xóa bài tập thất bại'));
      return;
    }

    // Keep the current weekly plan in sync with today's session changes.
    if (removedItem?.exercise_id && user?.id) {
      const weekStartKey = getWeekStartKey(new Date(`${vnToday}T00:00:00`));
      let weeklyPlanId: string | null = null;

      const byWeek = await supabase
        .from('weekly_plans')
        .select('id, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('week_start_date', weekStartKey)
        .limit(20);

      if (byWeek.error && isWeekStartColumnError(byWeek.error)) {
        const fallback = await supabase
          .from('weekly_plans')
          .select('id, created_at, updated_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        weeklyPlanId = fallback.data?.id || null;
      } else if (byWeek.error) {
        weeklyPlanId = null;
      } else {
        weeklyPlanId = pickLatestPlan(byWeek.data)?.id || null;
      }

      if (weeklyPlanId) {
        const toDelete = await supabase
          .from('weekly_plan_exercises')
          .select('id')
          .eq('weekly_plan_id', weeklyPlanId)
          .eq('day_of_week', currentDayIdx)
          .eq('exercise_id', removedItem.exercise_id)
          .order('order_index', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (toDelete.data?.id) {
          await supabase.from('weekly_plan_exercises').delete().eq('id', toDelete.data.id);
        }
      }
    }
  };


  const saveExerciseFromPopup = async (exerciseToSave: ExerciseLibraryItem) => {
    if (!user) return;
    setIsSavingExercise(true);
    try {
      const cleanSets = 3;
      const cleanReps = '12';
      const cleanKg = 20;
      const cleanKcal = estimateExerciseKcalRealistic({
        exercise: exerciseToSave,
        sets: cleanSets,
        repsText: cleanReps,
        externalLoadKg: cleanKg,
        userWeightKg,
        restSeconds: 60
      });

      // Save today's exercise session
      const { data, error } = await supabase
        .from('daily_exercise_sessions')
        .insert({
          user_id: user.id,
          log_date: vnToday,
          exercise_id: exerciseToSave.id,
          sets: cleanSets,
          reps: cleanReps,
          weight_kg: cleanKg,
          rest_seconds: 60,
          order_index: session.length,
          is_completed: false
        })
        .select(`
          *,
        exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
        `)
        .single();
      if (error) throw error;

      // Sync to new daily_workout_session_exercises if a session already exists
      try {
        const { data: existingSession } = await supabase
          .from('daily_workout_sessions')
          .select('id')
          .eq('user_id', user.id)
          .eq('log_date', vnToday)
          .limit(1)
          .maybeSingle();

        if (existingSession?.id) {
          await supabase.from('daily_workout_session_exercises').insert({
            session_id: existingSession.id,
            exercise_id: exerciseToSave.id,
            sets: cleanSets,
            reps: cleanReps,
            weight_kg: cleanKg,
            rest_seconds: 60,
            order_index: session.length,
            is_completed: false
          });
        }
      } catch (e) {
        console.error('Lỗi khi đồng bộ sang daily_workout_session_exercises:', e);
      }

      // Keep kcal from popup in daily progress summary
      const progress = await supabase
        .from('daily_progress_logs')
        .select('calories_burned')
        .eq('user_id', user.id)
        .eq('log_date', vnToday)
        .maybeSingle();
      if (progress.error) throw progress.error;
      const nextBurned = (progress.data?.calories_burned || 0) + cleanKcal;
      const upsertProgress = await supabase
        .from('daily_progress_logs')
        .upsert(
          { user_id: user.id, log_date: vnToday, calories_burned: nextBurned },
          { onConflict: 'user_id,log_date' }
        );
      if (upsertProgress.error) throw upsertProgress.error;

      // Sync to the weekly plan for the current VN week/day.
      const weekStartKey = getWeekStartKey(new Date(`${vnToday}T00:00:00`));
      let weeklyPlanId: string | null = null;
      const byWeek = await supabase
        .from('weekly_plans')
        .select('id, created_at, updated_at')
        .eq('user_id', user.id)
        .eq('week_start_date', weekStartKey)
        .limit(20);

      if (byWeek.error && isWeekStartColumnError(byWeek.error)) {
        const fallbackPlan = await supabase
          .from('weekly_plans')
          .select('id, created_at, updated_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (fallbackPlan.error) throw fallbackPlan.error;
        weeklyPlanId = fallbackPlan.data?.id || null;
      } else if (byWeek.error) {
        throw byWeek.error;
      } else {
        weeklyPlanId = pickLatestPlan(byWeek.data)?.id || null;
      }

      if (!weeklyPlanId) {
        const create = await supabase
          .from('weekly_plans')
          .insert({
            user_id: user.id,
            name: 'Workout Creator',
            week_start_date: weekStartKey
          })
          .select('id')
          .single();
        if (create.error && isWeekStartColumnError(create.error)) {
          const createFallback = await supabase
            .from('weekly_plans')
            .insert({
              user_id: user.id,
              name: 'Workout Creator'
            })
            .select('id')
            .single();
          if (createFallback.error) throw createFallback.error;
          weeklyPlanId = createFallback.data.id;
        } else if (create.error) {
          throw create.error;
        } else {
          weeklyPlanId = create.data.id;
        }
      }

      const orderRes = await supabase
        .from('weekly_plan_exercises')
        .select('order_index')
        .eq('weekly_plan_id', weeklyPlanId)
        .eq('day_of_week', currentDayIdx)
        .order('order_index', { ascending: false })
        .limit(1);
      if (orderRes.error) throw orderRes.error;
      const nextOrder = (orderRes.data?.[0]?.order_index ?? -1) + 1;

      const addToCreator = await supabase
        .from('weekly_plan_exercises')
        .insert({
          weekly_plan_id: weeklyPlanId,
          day_of_week: currentDayIdx,
          exercise_id: exerciseToSave.id,
          sets: cleanSets,
          reps: cleanReps,
          weight_kg: cleanKg,
          rest_seconds: 60,
          order_index: nextOrder,
          is_rest_day: false
        });
      if (addToCreator.error) throw addToCreator.error;

      if (data) {
        setSession(prev => [...prev, {
          ...data,
          name: (data.exercises as any)?.name || 'Exercise',
          gif_url: normalizeGifUrl((data.exercises as any)?.image_url || '')
        }]);
      }
      alert("Đã thêm vào buổi tập hôm nay");
    } catch (e: any) {
      alert("Lỗi: " + (e?.message || 'Lưu bài tập thất bại'));
    } finally {
      setIsSavingExercise(false);
    }
  };

  useEffect(() => {
    if (session.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const exists = session.some((s) => s.id === selectedSessionId);
    if (!exists) setSelectedSessionId(session[0].id);
  }, [session, selectedSessionId]);

  const selectedSessionExercise = session.find((s) => s.id === selectedSessionId) || null;
  const selectedSessionDetailExercise = useMemo<ExerciseLibraryItem | null>(() => {
    if (!selectedSessionExercise) return null;
    const fromLibrary = library.find((item) => item.id === selectedSessionExercise.exercise_id);
    if (fromLibrary) return fromLibrary;
    return {
      id: selectedSessionExercise.exercise_id,
      name: selectedSessionExercise.name || 'Exercise',
      body_part: String(selectedSessionExercise.exercises?.body_part || ''),
      target_muscle: String(selectedSessionExercise.exercises?.target_muscle || ''),
      gif_url: normalizeGifUrl(
        selectedSessionExercise.exercises?.gif_url || ''
      ),
      image_url: normalizeGifUrl(
        selectedSessionExercise.gif_url || selectedSessionExercise.exercises?.image_url || ''
      ),
      equipment: ''
    };
  }, [selectedSessionExercise, library]);
  const openExerciseDetailsPage = (exercise: ExerciseLibraryItem) => {
    navigate('/exercises/details', { state: { exercise } });
  };
  const selectedExerciseStats = useMemo(() => {
    if (!selectedSessionExercise) {
      return { setsText: '0 hiệp', repsText: '0 lần', weightText: '0 kg', kcalText: '~0 kcal' };
    }
    const sets = Math.max(1, Number(selectedSessionExercise.sets) || 1);
    const reps = Math.max(1, parseRepsInput(String(selectedSessionExercise.reps || '10')));
    const restSeconds = Math.max(0, Number(selectedSessionExercise.rest_seconds) || 0);
    const weightKg = Math.max(0, Number(selectedSessionExercise.weight_kg) || 0);
    const kcal = estimateExerciseKcalRealistic({
      exercise: {
        target_muscle: selectedSessionExercise.exercises?.target_muscle || '',
        body_part: selectedSessionExercise.exercises?.body_part || ''
      },
      sets,
      repsText: String(selectedSessionExercise.reps || '10'),
      externalLoadKg: weightKg,
      userWeightKg,
      restSeconds
    });
    return {
      setsText: `${sets} hiệp`,
      repsText: `${reps} lần`,
      weightText: `${weightKg} kg`,
      kcalText: `~${kcal} kcal`
    };
  }, [selectedSessionExercise, userWeightKg]);
  const muscleAliases: Record<string, string[]> = {
    all: [],
    back: ['back', 'lung', 'co xo', 'xa', 'trap', 'lat', 'upper back'],
    legs: ['leg', 'chan', 'dui', 'mong', 'but', 'calf', 'glute', 'hamstring', 'quadriceps', 'quat'],
    chest: ['chest', 'nguc', 'pec', 'pectoral'],
    shoulders: ['shoulder', 'vai', 'deltoid'],
    arms: ['arm', 'tay', 'bicep', 'tricep', 'forearm'],
    abs: ['abs', 'abdom', 'core', 'bung', 'oblique'],
    cardio: ['cardio', 'tim mach', 'hiit', 'aerobic', 'running', 'jump']
  };

  const matchesFilter = (ex: ExerciseLibraryItem, filterId: string) => {
    if (filterId === 'all') return true;
    const haystack = normalizeForMatch(`${ex.name} ${ex.target_muscle} ${ex.body_part}`);
    const aliases = muscleAliases[filterId] || [];
    return aliases.some((kw) => haystack.includes(normalizeForMatch(kw)));
  };

  const baseFilteredLibrary = library.filter((ex) => matchesFilter(ex, appliedMuscleFilter));
  const filteredLibrary = baseFilteredLibrary.filter((ex) =>
    appliedEquipmentFilter === 'all' ? true : equipmentMatchesPreference(ex.equipment, appliedEquipmentFilter)
  );
  const visibleLibrary = filteredLibrary.slice(0, visibleLibraryCount);
  const hasMoreLibraryItems = visibleLibrary.length < filteredLibrary.length;
  const isEquipmentFilterActive = appliedEquipmentFilter !== 'all';

  const equipmentFilterOptions = [
    { id: 'all', label: 'Tất cả' },
    { id: 'Phòng Gym', label: 'Phòng Gym' },
    { id: 'Đầy đủ tạ & máy móc', label: 'Đầy đủ tạ & máy móc' },
    { id: 'Tạ đơn & Thảm', label: 'Tạ đơn & Thảm' },
    { id: 'Dây kháng lực', label: 'Dây kháng lực' },
    { id: 'Không dụng cụ', label: 'Không dụng cụ' }
  ];

  const muscleFilterOptions = [
    { id: 'all', label: 'Tất cả' },
    { id: 'back', label: 'Lưng' },
    { id: 'legs', label: 'Chân' },
    { id: 'chest', label: 'Ngực' },
    { id: 'shoulders', label: 'Vai' },
    { id: 'arms', label: 'Tay' },
    { id: 'abs', label: 'Bụng' },
    { id: 'cardio', label: 'Cardio' }
  ];

  useEffect(() => {
    if (!user) return;
    exercisesPageCache = {
      vnToday,
      session,
      library,
      userWeightKg
    };
  }, [user, vnToday, session, library, userWeightKg]);

  useEffect(() => {
    setVisibleLibraryCount(LIBRARY_VISIBLE_BATCH_SIZE);
  }, [appliedMuscleFilter, appliedEquipmentFilter]);

  useEffect(() => {
    if (!isFilterModalOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (filterPopoverRef.current && target && !filterPopoverRef.current.contains(target)) {
        setIsFilterModalOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isFilterModalOpen]);

    if (isLoading) return <ExercisesSkeleton />;

  return (
    <div className="flex-1 min-h-0 max-w-[1700px] mx-auto w-full flex flex-col gap-4 md:gap-5 overflow-y-auto custom-scrollbar pr-1 text-sm">
      <div className="bg-bg-secondary border border-border-primary rounded-xl p-4 md:p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-black text-text-primary">Bài tập hôm nay</h1>
            <div className="flex items-center gap-1.5 text-xs md:text-sm text-text-tertiary">
              <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
              <p>
                {new Intl.DateTimeFormat('vi-VN', {
                  timeZone: VIETNAM_TIMEZONE,
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long'
                }).format(new Date())}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-bg-tertiary/35 border border-border-primary rounded-xl p-3 md:p-4">
          {selectedSessionExercise ? (
            <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)_380px] gap-4 md:gap-5 items-stretch">
              <div className="rounded-xl overflow-hidden border border-border-primary bg-bg-secondary h-[160px] md:h-[190px] xl:h-full">
                <ExerciseThumb src={selectedSessionExercise.gif_url} alt={selectedSessionExercise.name} />
              </div>
              <div className="flex flex-col justify-center gap-4 md:gap-5 min-w-0">
                <h2 className="text-xl md:text-2xl font-black text-text-primary leading-tight line-clamp-2">{selectedSessionExercise.name}</h2>
                <div className="grid grid-cols-2 gap-2.5 text-base text-text-primary">
                  <div className="inline-flex min-w-0 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
                    <span className="inline-flex items-start gap-1.5">
                      <Layers className="self-center w-4 h-4 text-accent md:w-[18px] md:h-[18px]" />
                      <span className="inline-flex flex-col items-center">
                        <span>{selectedExerciseStats.setsText}</span>
                        <span className="text-xs text-accent-muted">Số hiệp</span>
                      </span>
                    </span>
                  </div>
                  <div className="inline-flex min-w-0 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
                    <span className="inline-flex items-start gap-1.5">
                      <Repeat className="self-center w-4 h-4 text-accent md:w-[18px] md:h-[18px]" />
                      <span className="inline-flex flex-col items-start">
                        <span>{selectedExerciseStats.repsText}</span>
                        <span className="text-xs text-accent-muted">Số lần</span>
                      </span>
                    </span>
                  </div>
                  <div className="inline-flex min-w-0 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
                    <span className="inline-flex items-start gap-1.5 text-text-primary">
                      <Dumbbell className="self-center w-4 h-4 text-accent md:w-[18px] md:h-[18px]" />
                      <span className="inline-flex flex-col items-center">
                        <span>{selectedExerciseStats.weightText}</span>
                        <span className="text-xs text-accent-muted">Mức tạ</span>
                      </span>
                    </span>
                  </div>
                  <div className="inline-flex min-w-0 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5">
                    <span className="inline-flex items-start gap-1.5 text-text-primary">
                      <Flame className="self-center w-4 h-4 text-accent md:w-[18px] md:h-[18px]" />
                      <span className="inline-flex flex-col items-center">
                        <span>{selectedExerciseStats.kcalText}</span>
                        <span className="text-xs text-accent-muted">Calo đốt</span>
                      </span>
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-start gap-2.5">
                  <button
                    onClick={() =>
                      navigate('/exercises/session', {
                        state: {
                          session,
                          selectedSessionId: selectedSessionExercise.id,
                          logDate: vnToday
                        }
                      })
                    }
                    className={`h-10 px-4 rounded-xl font-bold text-sm transition-colors inline-flex items-center gap-2 ${selectedSessionExercise.is_completed ? 'bg-accent text-black' : 'bg-accent text-black hover:bg-accent-hover'}`}
                  >
                    <Play className="w-4 h-4" />
                    {selectedSessionExercise.is_completed ? 'Mở lại buổi tập' : 'Bắt đầu buổi tập'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSessionDetailExercise) openExerciseDetailsPage(selectedSessionDetailExercise);
                    }}
                    className="h-10 px-4 rounded-xl border border-[#a7afbd]/45 bg-[#8b94a3]/55 text-white text-sm font-bold hover:border-[#b7bfcb]/60 hover:bg-[#98a1af]/65 transition-colors inline-flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    Xem chi tiết
                  </button>
                </div>
              </div>
              <div className="relative rounded-xl p-3 md:p-4 xl:pt-1 xl:pl-4 xl:before:content-[''] xl:before:absolute xl:before:left-[-8px] xl:before:-top-4 xl:before:-bottom-4 xl:before:w-px xl:before:bg-border-primary">
                <h3 className="mb-1 text-lg font-bold text-text-primary">Danh sách bài tập</h3>
                <div className="space-y-2.5 max-h-[240px] overflow-y-auto custom-scrollbar pr-1">
                  {session.slice(0, 4).map((ex, idx) => (
                    <button
                      key={ex.id}
                      onClick={() => setSelectedSessionId(ex.id)}
                      className="w-full text-left rounded-lg px-0 py-1.5 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full border border-accent/55 text-xs font-black leading-none text-accent">{idx + 1}</span>
                          <span className={`text-sm font-medium ${ex.is_completed ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{ex.name}</span>
                        </div>
                        <span className="shrink-0 text-sm font-medium text-text-tertiary">
                          {`${ex.sets || 1} hiệp x ${ex.reps || '10'} lần x ${Math.max(0, Number(ex.weight_kg) || 0)} kg`}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[220px] flex flex-col items-center justify-center text-center">
              <AlertCircle className="w-10 h-10 text-text-tertiary mb-3" />
              <p className="text-sm text-text-secondary">Chưa có bài tập nào hôm nay.</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-secondary border border-border-primary rounded-xl p-4 md:p-5">
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-text-primary">Thư viện bài tập</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {muscleFilterOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAppliedMuscleFilter(opt.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-colors ${appliedMuscleFilter === opt.id ? 'bg-accent text-black' : 'bg-bg-tertiary border border-border-primary text-text-secondary hover:border-accent/40 hover:text-text-primary'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative" ref={filterPopoverRef}>
            <button
              type="button"
              onClick={() => {
                setIsFilterModalOpen((prev) => {
                  if (prev) return false;
                  setDraftEquipmentFilter(appliedEquipmentFilter);
                  return true;
                });
              }}
              className={`group relative inline-flex h-8 items-center gap-1.5 px-2.5 rounded-lg border transition-all ${
                isEquipmentFilterActive
                  ? 'border-accent/45 bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)_/_0.08)]'
                  : 'border-border-primary bg-bg-tertiary text-text-secondary hover:border-accent/40 hover:text-text-primary'
              }`}
            >
              {isEquipmentFilterActive && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-bg-secondary bg-accent" />
              )}
              <SlidersHorizontal className={`w-3.5 h-3.5 ${isEquipmentFilterActive ? 'text-accent' : 'text-text-secondary'}`} />
              <span className="text-xs font-medium leading-none">Bộ lọc</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isFilterModalOpen ? 'rotate-180' : ''} ${isEquipmentFilterActive ? 'text-accent' : 'text-text-secondary group-hover:text-text-primary'}`} />
            </button>

            {isFilterModalOpen && (
              <div className="absolute z-[120] right-[calc(100%+8px)] top-1/2 -translate-y-1/2 w-[min(92vw,320px)] max-h-[72vh] overflow-y-auto custom-scrollbar rounded-2xl border border-border-primary bg-bg-secondary p-4 md:p-5 shadow-2xl max-md:right-0 max-md:top-full max-md:translate-y-0 max-md:mt-2">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm md:text-base font-black tracking-wide text-text-primary">Bộ lọc</h3>
                <button
                  type="button"
                  onClick={() => {
                    setDraftEquipmentFilter('all');
                  }}
                  className="h-8 px-1 text-accent hover:text-accent-hover inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold tracking-wide">Xóa tất cả</span>
                </button>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-xs font-black tracking-wide text-text-secondary">Thiết bị</p>
                  <div className="flex flex-wrap gap-2">
                    {equipmentFilterOptions.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setDraftEquipmentFilter(opt.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-colors ${draftEquipmentFilter === opt.id ? 'bg-accent text-black' : 'bg-bg-tertiary border border-border-primary text-text-secondary hover:border-accent/40 hover:text-text-primary'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setAppliedEquipmentFilter(draftEquipmentFilter);
                    setIsFilterModalOpen(false);
                  }}
                  className="h-10 px-6 rounded-xl bg-accent text-black text-sm font-black tracking-wide transition-colors hover:bg-accent-hover"
                >
                  Lưu bộ lọc
                </button>
              </div>
            </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {visibleLibrary.map((ex) => (
            <div
              key={ex.id}
              onClick={() => openExerciseDetailsPage(ex)}
              className="overflow-hidden rounded-xl border border-border-primary bg-bg-tertiary/50 cursor-pointer transition-colors hover:border-accent/45"
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-bg-secondary">
                <ExerciseThumb src={ex.image_url} alt={ex.name} />
              </div>

              <div className="p-3">
                <h4 className="truncate text-sm font-black text-text-primary">{ex.name}</h4>
                <p className="mt-1 truncate text-xs font-semibold text-text-secondary">
                  Cơ chính: {ex.target_muscle || 'Không rõ'}
                </p>
                <p className="mt-1 truncate text-xs text-text-tertiary">
                  Thiết bị: {ex.equipment || 'Không rõ'}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openExerciseDetailsPage(ex)}
                    className="h-8 flex-1 rounded-lg border border-[#a7afbd]/45 bg-[#8b94a3]/55 text-xs font-bold text-white hover:border-[#b7bfcb]/60 hover:bg-[#98a1af]/65 transition-colors"
                  >
                    Xem chi tiết
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      saveExerciseFromPopup(ex);
                    }}
                    disabled={isSavingExercise}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-black hover:bg-accent-hover disabled:opacity-60"
                    aria-label="Thêm bài tập"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {hasMoreLibraryItems && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleLibraryCount((count) => count + LIBRARY_VISIBLE_BATCH_SIZE)}
              className="h-10 px-5 rounded-xl border border-border-primary bg-bg-tertiary text-sm font-black text-text-primary transition-colors hover:border-accent/45 hover:text-accent inline-flex items-center gap-2"
            >
              <ChevronDown className="w-4 h-4" />
              Xem thêm
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

