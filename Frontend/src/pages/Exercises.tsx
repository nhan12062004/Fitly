import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, AlertCircle, Calendar, ImageOff,
  ChevronDown, SlidersHorizontal, RotateCcw, Play, Eye
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchWithAuth } from '../lib/Api';
import { createDailyExerciseSession } from '../lib/DailyExercises';
import { supabase } from '../lib/Supabase';
import { useAuth } from '../contexts/AuthContext';
import { type ExerciseDetailItem } from '../components/ExerciseDetailOverlay';
import { SkeletonBlock, SkeletonSurface } from '../components/PageSkeleton';
import { useToast } from '../components/ToastProvider';

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

const getManualSuggestedWeightKg = (_equipment?: string | null): number | null => null;

const formatWeightKg = (value: unknown, emptyLabel = 'Chưa có tạ đề xuất'): string => {
  if (value === null || value === undefined || value === '') return emptyLabel;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return emptyLabel;
  return `${parsed} kg`;
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
  library: ExerciseLibraryItem[];
};

let exercisesPageCache: ExercisesPageCache | null = null;
const LIBRARY_VISIBLE_BATCH_SIZE = 12;

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

const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getWeekStartDate = (baseDate: Date): Date => new Date(`${getWeekStartKey(baseDate)}T00:00:00`);

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
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
const ExerciseThumb = ({ src, alt, className }: { src?: string; alt: string; className?: string }) => {
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
      className={className || "w-full h-full object-cover"}
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
    <div className="dashboard-page-shell flex flex-col gap-4 animate-pulse overflow-y-auto custom-scrollbar text-sm pb-4 md:gap-5 md:pb-6 lg:pb-7" aria-hidden="true">
      <div className="rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            {SkeletonBlock('h-7 w-44 rounded-lg')}
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-bg-tertiary/70" />
              {SkeletonBlock('h-4 w-32 rounded-lg')}
            </div>
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

      <div className="rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
        <div className="relative mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            {SkeletonBlock('h-8 w-48 rounded-xl')}
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-8 w-16 rounded-lg bg-bg-tertiary/70" />
              ))}
            </div>
          </div>
          <div className="h-9 w-24 shrink-0 rounded-lg bg-bg-tertiary/70" />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border-primary/30 bg-bg-tertiary/20">
              <div className="relative aspect-[16/9] bg-bg-secondary/50" />
              <div className="p-3">
                <div className="h-4 w-3/4 rounded bg-bg-tertiary/75" />
                <div className="mt-2 h-3 w-5/6 rounded bg-bg-tertiary/60" />
                <div className="mt-1 h-3 w-1/2 rounded bg-bg-tertiary/50" />
                <div className="mt-3 h-8 w-full rounded-lg border border-border-primary bg-bg-tertiary/35" />
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
  const toast = useToast();
  const cacheForToday =
    exercisesPageCache && exercisesPageCache.vnToday === getVietnamDateKey()
      ? exercisesPageCache
      : null;

  const [session, setSession] = useState<SessionExercise[]>(() => cacheForToday?.session || []);
  const [isLoading, setIsLoading] = useState(() => !cacheForToday);
  const [, setIsRefreshing] = useState(false);
  const [savingExerciseId, setSavingExerciseId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | ''>('');
  const [library, setLibrary] = useState<ExerciseLibraryItem[]>(() => cacheForToday?.library || []);
  const [vnToday, setVnToday] = useState(() => getVietnamDateKey());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [appliedMuscleFilter, setAppliedMuscleFilter] = useState('all');
  const [appliedEquipmentFilter, setAppliedEquipmentFilter] = useState('all');
  const [draftEquipmentFilter, setDraftEquipmentFilter] = useState('all');
  const [visibleLibraryCount, setVisibleLibraryCount] = useState(LIBRARY_VISIBLE_BATCH_SIZE);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const dayTabContainerRef = useRef<HTMLDivElement | null>(null);
  const dayTabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const hasLoadedSessionRef = useRef(Boolean(cacheForToday));
  const [selectedDayId, setSelectedDayId] = useState(() => getVietnamDayIndex());
  const [dayIndicatorStyle, setDayIndicatorStyle] = useState<{ x: number; y: number; width: number; height: number; visible: boolean }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false
  });

  const selectedWeekStart = useMemo(() => getWeekStartDate(new Date(`${vnToday}T00:00:00`)), [vnToday]);
  const selectedDate = useMemo(() => addDays(selectedWeekStart, selectedDayId), [selectedWeekStart, selectedDayId]);
  const selectedDateKey = useMemo(() => toDateKey(selectedDate), [selectedDate]);
  const isTodaySelected = selectedDateKey === vnToday;
  const selectedDayTitle = isTodaySelected
    ? 'Bài tập hôm nay'
    : `Bài tập ${DAYS[selectedDayId]?.full.toLowerCase() || ''}`;
  const selectedDayDateLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }),
    [selectedDate]
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextVnToday = getVietnamDateKey();
      setVnToday(prev => (prev === nextVnToday ? prev : nextVnToday));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setSelectedDayId(getVietnamDayIndex());
  }, [vnToday]);

  useEffect(() => {
    if (user) {
      const shouldLoadSilently = hasLoadedSessionRef.current || (!!cacheForToday && selectedDateKey === vnToday);
      loadSession(shouldLoadSilently);
    } else {
      setSession([]);
      loadLibrary();
    }
  }, [user, selectedDateKey, vnToday]);

  useEffect(() => {
    if (isLoading) return;

    const updateDayIndicator = () => {
      const container = dayTabContainerRef.current;
      const activeTab = dayTabRefs.current[selectedDayId];
      if (!container || !activeTab) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeTab.getBoundingClientRect();
      setDayIndicatorStyle({
        x: activeRect.left - containerRect.left,
        y: activeRect.top - containerRect.top,
        width: activeRect.width,
        height: activeRect.height,
        visible: true
      });
    };

    const frame = window.requestAnimationFrame(updateDayIndicator);
    window.addEventListener('resize', updateDayIndicator);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateDayIndicator);
    };
  }, [isLoading, selectedDayId, selectedWeekStart]);

  const loadSession = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      // 1. Check if session already exists for the selected day
      const { data: existingSession } = await supabase
        .from('daily_exercise_sessions')
        .select(`
          *,
          exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
        `)
        .eq('user_id', user?.id)
        .eq('log_date', selectedDateKey)
        .order('order_index');

      if (existingSession && existingSession.length > 0) {
        setSession(existingSession.map(s => ({
          ...s,
          name: (s.exercises as any)?.name || 'Exercise',
          gif_url: normalizeGifUrl((s.exercises as any)?.image_url || '')
        })));
      } else {
        // 2. No session on this day. Try to clone from weekly plan
        setSession([]);
        await clonePlanToSelectedDate(selectedDateKey, selectedDayId);
      }
      await loadLibrary(silent);

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
          gif_url: normalizeGifUrl((s.exercises as any)?.image_url || (s.exercises as any)?.gif_url || '')
        })));
      }
    } catch (error) {
      console.error('Error cloning weekly plan to daily workout:', error);
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
          gif_url: normalizeGifUrl((savedExercise.exercises as any)?.image_url || (savedExercise.exercises as any)?.gif_url || s.gif_url)
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


  const saveExerciseFromPopup = async (exerciseToSave: ExerciseLibraryItem) => {
    const currentUser = user!;
    if (!currentUser) {
      setSaveMessage('Bạn cần đăng nhập để thêm bài tập.');
      setSaveStatus('error');
      return;
    }

    if (session.some((item) => item.exercise_id === exerciseToSave.id)) {
      setSaveMessage('Bài tập này đã có trong buổi tập đã chọn.');
      setSaveStatus('error');
      return;
    }

    setSavingExerciseId(exerciseToSave.id);
    setSaveMessage('');
    try {
      const existedRes = await supabase
        .from('daily_exercise_sessions')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('log_date', selectedDateKey)
        .eq('exercise_id', exerciseToSave.id)
        .limit(1);
      if (existedRes.error) throw existedRes.error;

      if ((existedRes.data || []).length > 0) {
        setSaveMessage('Bài tập này đã có trong buổi tập đã chọn.');
        setSaveStatus('error');
        return;
      }

      const cleanSets = 3;
      const cleanReps = '12';
      const cleanKg = getManualSuggestedWeightKg(exerciseToSave.equipment);
      const createdSession = await createDailyExerciseSession({
        userId: currentUser.id,
        logDate: selectedDateKey,
        exerciseId: exerciseToSave.id,
        sets: cleanSets,
        reps: cleanReps,
        weightKg: cleanKg,
        restSeconds: 60
      }) as SessionExercise | undefined;
      if (createdSession) {
        setSession(prev => {
          if (prev.some((item) => item.exercise_id === exerciseToSave.id)) return prev;
          return [...prev, {
            ...createdSession,
            name: (createdSession.exercises as any)?.name || 'Exercise',
            gif_url: normalizeGifUrl((createdSession.exercises as any)?.image_url || '')
          }];
        });
      }

      setSaveMessage(isTodaySelected ? 'Đã thêm vào buổi tập hôm nay.' : 'Đã thêm vào buổi tập đã chọn.');
      setSaveStatus('success');
    } catch (e: any) {
      setSaveMessage(e?.message || 'Thêm bài tập thất bại. Vui lòng thử lại.');
      setSaveStatus('error');
    } finally {
      setSavingExerciseId(null);
    }
  };

  useEffect(() => {
    if (!saveMessage) return;
    if (saveStatus === 'success') {
      toast.success(saveMessage);
    } else {
      toast.error(saveMessage);
    }
    const clear = window.setTimeout(() => {
      setSaveMessage('');
      setSaveStatus('');
    }, 0);
    return () => {
      window.clearTimeout(clear);
    };
  }, [saveMessage, saveStatus, toast]);

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
      return { setsText: '0 hiệp', repsText: '0 lần', weightText: 'Chưa đặt', kcalText: '~0 kcal' };
    }
    const sets = Math.max(1, Number(selectedSessionExercise.actual_sets ?? selectedSessionExercise.sets) || 1);
    const reps = Math.max(1, parseRepAverage(String((selectedSessionExercise.actual_reps ?? selectedSessionExercise.reps) || '10')));
    const weightKg = selectedSessionExercise.actual_weight_kg ?? selectedSessionExercise.weight_kg;
    const kcal = getResolvedExerciseKcal(selectedSessionExercise);
    return {
      setsText: `${sets} hiệp`,
      repsText: `${reps} lần`,
      weightText: formatWeightKg(weightKg),
      kcalText: `~${kcal} kcal`
    };
  }, [selectedSessionExercise]);
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
    if (!user || selectedDateKey !== vnToday) return;
    exercisesPageCache = {
      vnToday,
      session,
      library
    };
  }, [user, selectedDateKey, vnToday, session, library]);

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
    <div className="dashboard-page-shell flex flex-col gap-4 overflow-y-auto custom-scrollbar text-sm pb-4 md:gap-5 md:pb-6 lg:pb-7">
      <div className="today-workout-shell overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-4 md:p-5">
        <div className="today-workout-header mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2">
            <h1 className="text-[1.35rem] font-black leading-tight text-text-primary md:text-2xl">{selectedDayTitle}</h1>
            <div className="today-workout-date inline-flex items-center gap-1.5 rounded-full border border-border-primary bg-bg-tertiary/45 px-3 py-1.5 text-xs font-bold text-text-tertiary md:text-sm">
              <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
              <p>{selectedDayDateLabel}</p>
            </div>
          </div>
        </div>

        <div className="today-workout-day-tabs mb-4 overflow-x-auto rounded-xl border border-border-primary bg-bg-tertiary/40 p-1 custom-scrollbar">
          <div ref={dayTabContainerRef} className="relative flex min-w-max gap-1 md:grid md:min-w-0 md:grid-cols-7">
            <span
              className={`diet-tab-indicator pointer-events-none absolute rounded-lg transition-[transform,width,height,opacity] duration-300 ease-out ${dayIndicatorStyle.visible ? 'opacity-100' : 'opacity-0'}`}
              style={{
                width: `${dayIndicatorStyle.width}px`,
                height: `${dayIndicatorStyle.height}px`,
                transform: `translate(${dayIndicatorStyle.x}px, ${dayIndicatorStyle.y}px)`
              }}
            />
            {DAYS.map((day) => {
              const dayDate = addDays(selectedWeekStart, day.id);
              const isSelected = selectedDayId === day.id;
              const isToday = toDateKey(dayDate) === vnToday;
              const label = isToday ? 'Hôm nay' : day.label;

              return (
                <button
                  key={day.id}
                  ref={(node) => {
                    dayTabRefs.current[day.id] = node;
                  }}
                  type="button"
                  onClick={() => setSelectedDayId(day.id)}
                  className={`inline-flex min-h-[40px] min-w-[4.25rem] items-center justify-center whitespace-nowrap rounded-lg px-3 text-[11px] font-black uppercase tracking-[0.08em] transition md:min-w-0 ${
                    isSelected ? 'diet-tab-selected relative z-10' : 'diet-tab'
                  }`}
                  title={`${day.full} - ${dayDate.toLocaleDateString('vi-VN')}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="today-workout-content grid grid-cols-1 gap-5 md:-ml-2 md:-mt-1 md:gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-stretch">
          {selectedSessionExercise ? (
            <>
              <article className="min-w-0 p-4 md:p-4 xl:pr-8">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[176px_minmax(0,540px)] lg:items-stretch lg:gap-5">
                  <div className="themed-image-surface overflow-hidden rounded-xl border border-border-primary h-[184px] lg:h-full">
                    <ExerciseThumb
                      src={selectedSessionExercise.gif_url}
                      alt={selectedSessionExercise.name}
                      className="w-full h-full object-contain p-2"
                    />
                  </div>
                  <div className="today-workout-feature flex flex-col justify-center gap-3.5 min-w-0 max-w-[560px]">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {selectedSessionExercise.is_completed ? (
                          <span className="rounded-full border border-border-primary bg-bg-tertiary/55 px-3 py-1 text-xs font-black text-text-secondary">
                            Đã hoàn thành
                          </span>
                        ) : null}
                      </div>
                      <h2 className="text-2xl font-black text-text-primary leading-tight md:text-[1.75rem] md:leading-[1.08] line-clamp-2">{selectedSessionExercise.name}</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedSessionExercise.exercises?.target_muscle ? (
                          <span className="rounded-full border border-info/20 bg-info/10 px-3 py-1 text-xs font-bold text-info">
                            {selectedSessionExercise.exercises.target_muscle}
                          </span>
                        ) : null}
                        {selectedSessionExercise.exercises?.body_part ? (
                          <span className="rounded-full border border-warning/20 bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
                            {selectedSessionExercise.exercises.body_part}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="today-workout-meta flex flex-wrap items-center gap-2">
                      <span className="today-workout-meta-item">{selectedExerciseStats.setsText}</span>
                      <span className="today-workout-meta-item">{selectedExerciseStats.repsText}</span>
                      <span className="today-workout-meta-item">{selectedExerciseStats.weightText}</span>
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
              <aside className="today-workout-list relative min-w-0 p-4 md:p-4 xl:-ml-2 xl:self-stretch xl:pl-5 xl:pt-4 xl:before:absolute xl:before:bottom-4 xl:before:left-0 xl:before:top-4 xl:before:w-px xl:before:bg-border-primary/70 xl:before:content-['']">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-black text-text-primary">Danh sách bài tập</h3>
                </div>
                <div className="today-workout-list-scroll mt-3.5 space-y-2.5 max-h-[320px] overflow-y-auto custom-scrollbar pr-1">
                  {session.slice(0, 4).map((ex, idx) => (
                    <button
                      key={ex.id}
                      onClick={() => setSelectedSessionId(ex.id)}
                      className={`today-workout-list-item w-full text-left rounded-lg px-0 py-1.5 transition-colors ${ex.id === selectedSessionExercise.id ? 'today-workout-list-item-active' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                        <span className="today-workout-list-index inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full border border-accent/55 text-xs font-black leading-none text-accent">{idx + 1}</span>
                          <span className={`text-sm font-medium ${ex.is_completed ? 'text-text-tertiary line-through' : 'text-text-primary'}`}>{ex.name}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </aside>
            </>
          ) : (
            <div className="today-workout-empty-state flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border-primary bg-bg-tertiary/30 px-5 py-8 text-center">
              <span className="today-workout-empty-icon mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-text-tertiary">
                <AlertCircle className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-text-secondary">
                {isTodaySelected ? 'Chưa có bài tập nào hôm nay.' : 'Chưa có bài tập cho ngày này.'}
              </p>
              <button
                type="button"
                onClick={() => navigate('/smart-planner')}
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-black text-text-inverse transition-colors hover:bg-accent-hover"
              >
                <Plus className="h-4 w-4" />
                Tạo kế hoạch
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-secondary border border-border-primary rounded-xl p-4 md:p-5">
        <div className="relative mb-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xl md:text-2xl font-black text-text-primary">Thư viện bài tập</h2>
            <div className="relative shrink-0" ref={filterPopoverRef}>
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
                    setAppliedEquipmentFilter('all');
                    setIsFilterModalOpen(false);
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-colors ${draftEquipmentFilter === opt.id ? 'bg-accent text-text-inverse' : 'bg-bg-tertiary border border-border-primary text-text-secondary hover:border-accent/40 hover:text-text-primary'}`}
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
                  className="h-10 px-6 rounded-xl bg-accent text-text-inverse text-sm font-black tracking-wide transition-colors hover:bg-accent-hover"
                >
                  Lưu bộ lọc
                </button>
              </div>
            </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
            {muscleFilterOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setAppliedMuscleFilter(opt.id)}
                className={`inline-flex min-h-8 w-full items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold tracking-wide transition-colors sm:w-auto sm:px-3 ${appliedMuscleFilter === opt.id ? 'bg-accent text-text-inverse' : 'bg-bg-tertiary border border-border-primary text-text-secondary hover:border-accent/40 hover:text-text-primary'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {visibleLibrary.map((ex) => {
            const isSavingThisExercise = savingExerciseId === ex.id;
            const isAlreadyInSession = session.some((item) => item.exercise_id === ex.id);

            return (
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
                    className="h-8 flex-1 rounded-lg border border-border-primary bg-bg-tertiary/45 px-3 text-xs font-bold text-text-primary transition-colors hover:border-accent/30 hover:bg-bg-tertiary"
                  >
                    Xem chi tiết
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      saveExerciseFromPopup(ex);
                    }}
                    disabled={isSavingThisExercise || isAlreadyInSession}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                      isAlreadyInSession
                        ? 'cursor-not-allowed border border-accent/35 bg-accent/15 text-accent'
                        : 'bg-accent text-text-inverse hover:bg-accent-hover disabled:opacity-60'
                    }`}
                    aria-label={isAlreadyInSession ? 'Bài tập đã có trong buổi tập' : 'Thêm bài tập'}
                    title={isAlreadyInSession ? 'Bài tập đã có trong buổi tập' : 'Thêm bài tập'}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            );
          })}
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

