import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ExerciseDetailOverlay, { type ExerciseDetailItem } from '../components/ExerciseDetailOverlay';
import { useAuth } from '../contexts/AuthContext';
import { fetchWithAuth } from '../lib/Api';
import { supabase } from '../lib/Supabase';
import { SkeletonBlock } from '../components/PageSkeleton';

interface ExerciseDetailsLocationState {
  exercise?: ExerciseDetailItem;
}

const exerciseDetailsCache = new Map<string, ExerciseDetailItem>();

const normalizeMediaUrl = (value: unknown): string => {
  const url = String(value || '').trim();
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return `https://${url.slice(7)}`;
  return url;
};

const toGifStorageUrl = (gifUrl: unknown, imageUrl: unknown): string => {
  const direct = normalizeMediaUrl(gifUrl);
  if (direct) return direct.replace(/\.(jpg|jpeg|png|webp)(?=($|\?))/i, '.gif');

  const image = normalizeMediaUrl(imageUrl);
  return image.replace(/\.(jpg|jpeg|png|webp)(?=($|\?))/i, '.gif');
};

const normalizeForMatch = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');

const isBodyweightExercise = (equipment?: string | null): boolean => {
  const normalized = normalizeForMatch(equipment);
  return (
    normalized.includes('khong dung cu') ||
    normalized.includes('bodyweight') ||
    normalized.includes('body weight')
  );
};

const getManualSuggestedWeightKg = (equipment?: string | null): number | null =>
  isBodyweightExercise(equipment) ? 0 : null;

function ExerciseDetailsSkeleton() {
  return (
    <div className="dashboard-page-shell animate-pulse overflow-y-auto custom-scrollbar text-sm pb-4 md:pb-6 lg:pb-7" aria-hidden="true">
      <div className="-mt-1 mb-3 flex items-center gap-2 text-sm text-text-tertiary">
        <div className="h-4 w-4 rounded-full bg-bg-tertiary/70" />
        {SkeletonBlock('h-4 w-32 rounded-lg')}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border-primary bg-bg-secondary/85 p-3 md:p-4 lg:p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.94fr)_minmax(360px,1.06fr)] lg:items-stretch lg:gap-6">
            <div className="relative overflow-hidden rounded-2xl border border-border-primary/70 bg-bg-tertiary/25 p-3 sm:p-4">
              <div className="absolute right-3 top-3 h-8 w-24 rounded-full bg-bg-secondary/90" />
              <div className="h-[180px] w-full rounded-xl bg-bg-secondary/60 sm:h-[220px] lg:h-[260px]" />
            </div>

            <div className="flex flex-col justify-between">
              <div>
                {SkeletonBlock('h-10 w-[72%] rounded-xl')}
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:mt-5">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 rounded-xl border border-border-primary/70 bg-bg-tertiary/20 px-3.5 py-3"
                    >
                      <div className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-bg-tertiary/65" />
                      <div className="min-w-0 flex-1">
                        {SkeletonBlock('h-3 w-20 rounded-lg')}
                        {SkeletonBlock('mt-2 h-4 w-[78%] rounded-lg')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:mt-5">
                <div className="h-11 rounded-xl bg-bg-tertiary/70" />
                <div className="h-11 rounded-xl border border-border-primary bg-bg-tertiary/30" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.95fr]">
          <div className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
            {SkeletonBlock('h-8 w-52 rounded-xl')}
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="flex gap-2.5 border-b border-border-primary/60 pb-2.5 last:border-b-0 last:pb-0">
                  <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-bg-tertiary/70" />
                  <div className="min-w-0 flex-1">
                    {SkeletonBlock('h-4 w-full rounded-lg')}
                    {index % 2 === 0 ? SkeletonBlock('mt-2 h-4 w-[86%] rounded-lg') : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border-primary bg-bg-secondary/85 p-4 md:p-5">
            <div className="mb-3 flex items-center justify-between">
              {SkeletonBlock('h-8 w-44 rounded-xl')}
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2.5 rounded-lg border border-border-primary bg-bg-secondary px-2.5 py-2"
                >
                  <div className="h-12 w-12 shrink-0 rounded-md border border-border-primary bg-bg-tertiary/40" />
                  <div className="min-w-0 flex-1">
                    {SkeletonBlock('h-4 w-[72%] rounded-lg')}
                    {SkeletonBlock('mt-2 h-3 w-[52%] rounded-lg')}
                  </div>
                  <div className="h-4 w-4 rounded-full bg-bg-tertiary/70" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExerciseDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const state = (location.state || {}) as ExerciseDetailsLocationState;
  const cachedExercise = state.exercise?.id ? exerciseDetailsCache.get(String(state.exercise.id)) || null : null;
  const initialExerciseDetail = state.exercise || cachedExercise || null;
  const [exerciseDetail, setExerciseDetail] = useState<ExerciseDetailItem | null>(initialExerciseDetail);
  const [isResolvingDetail, setIsResolvingDetail] = useState(() => !!state.exercise?.id);
  const [, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | ''>('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(() => !initialExerciseDetail);

  const getVietnamDateKey = (date = new Date()): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value || '1970';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    const day = parts.find((p) => p.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
  };

  const addExerciseToToday = async (exercise: ExerciseDetailItem) => {
    if (!user) {
      setSaveMessage('Bạn cần đăng nhập để thêm bài tập.');
      setSaveStatus('error');
      return;
    }
    setIsSaving(true);
    setSaveMessage('');
    try {
      const today = getVietnamDateKey();
      const { data: existedRows, error: existedError } = await supabase
        .from('daily_exercise_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('log_date', today)
        .eq('exercise_id', exercise.id)
        .limit(1);

      if (existedError) throw existedError;

      if ((existedRows || []).length > 0) {
        setSaveMessage('Bài tập này đã có trong buổi tập hôm nay.');
        setSaveStatus('error');
        return;
      }

      const { data: latestRow } = await supabase
        .from('daily_exercise_sessions')
        .select('order_index')
        .eq('user_id', user.id)
        .eq('log_date', today)
        .order('order_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextOrder = Number(latestRow?.order_index ?? -1) + 1;
      const defaultSets = 3;
      const defaultReps = '12';
      const defaultWeightKg = getManualSuggestedWeightKg(exercise.equipment);
      const defaultRestSeconds = 45;
      const response = await fetchWithAuth('/api/workout/daily-exercises', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          logDate: today,
          exerciseId: exercise.id,
          sets: defaultSets,
          reps: defaultReps,
          weightKg: defaultWeightKg,
          restSeconds: defaultRestSeconds,
          orderIndex: nextOrder
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || 'Thêm bài tập thất bại'));
      }
      setSaveMessage('Đã thêm vào buổi tập hôm nay.');
      setSaveStatus('success');
    } catch {
      setSaveMessage('Thêm bài tập thất bại. Vui lòng thử lại.');
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!saveMessage) return;
    setToastVisible(true);
    const hide = window.setTimeout(() => {
      setToastVisible(false);
    }, 2200);
    const clear = window.setTimeout(() => {
      setSaveMessage('');
      setSaveStatus('');
    }, 2600);
    return () => {
      window.clearTimeout(hide);
      window.clearTimeout(clear);
    };
  }, [saveMessage]);

  useEffect(() => {
    const exerciseId = state.exercise?.id;
    if (!exerciseId) {
      setIsResolvingDetail(false);
      setIsPageLoading(false);
      return;
    }

    const fetchDetail = async () => {
      const cached = exerciseDetailsCache.get(String(exerciseId)) || null;
      if (cached) {
        setExerciseDetail(cached);
      }
      setIsPageLoading(!cached && !state.exercise);
      setIsRefreshing(!!cached || !!state.exercise);
      try {
        const { data } = await supabase
          .from('exercises')
          .select('id, name, target_muscle, body_part, gif_url, image_url, equipment, instructions, secondary_muscles')
          .eq('id', String(exerciseId))
          .maybeSingle();

        if (!data) return;

        const resolvedDetail = {
          id: String(data.id),
          name: String(data.name || state.exercise?.name || 'Bài tập'),
          target_muscle: String(data.target_muscle || ''),
          body_part: String(data.body_part || ''),
          gif_url: toGifStorageUrl(data.gif_url, (data as any).image_url),
          equipment: String(data.equipment || ''),
          instructions: (data as any).instructions || [],
          secondary_muscles: (data as any).secondary_muscles || [],
          description: String(state.exercise?.description || ''),
          image_url: normalizeMediaUrl((data as any).image_url || '')
        };
        exerciseDetailsCache.set(String(data.id), resolvedDetail);
        setExerciseDetail(resolvedDetail);
      } finally {
        setIsResolvingDetail(false);
        setIsPageLoading(false);
        setIsRefreshing(false);
      }
    };

    fetchDetail();
  }, [state.exercise?.id]);

  if (isPageLoading || (isResolvingDetail && !exerciseDetail)) {
    return <ExerciseDetailsSkeleton />;
  }

  if (!exerciseDetail) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center justify-center">
        <div className="rounded-3xl border border-border-primary bg-bg-secondary p-8 text-center">
          <p className="text-lg font-black text-text-primary">Không có dữ liệu bài tập.</p>
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
    <div className="dashboard-page-shell overflow-y-auto custom-scrollbar text-sm pb-4 md:pb-6 lg:pb-7">
      {saveMessage && (
        <div
          className={`fixed left-1/2 top-5 z-[200] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-xl transition-all duration-300 ${
            toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          } ${
            saveStatus === 'success'
              ? 'border-accent/50 bg-accent/15 text-accent-muted'
              : 'border-red-400/50 bg-red-500/15 text-red-200'
          }`}
        >
          {saveMessage}
        </div>
      )}

      <ExerciseDetailOverlay
        key={`${exerciseDetail.id}-${exerciseDetail.gif_url}`}
        exercise={exerciseDetail}
        isSaving={isSaving}
        onClose={() => navigate('/exercises')}
        onAdd={addExerciseToToday}
        onStartNow={async (exercise) => {
          const defaultWeightKg = getManualSuggestedWeightKg(exercise.equipment);
          if (user) {
            const today = getVietnamDateKey();
            const existingRes = await supabase
              .from('daily_exercise_sessions')
              .select(`
                *,
                exercises:exercise_id (name, gif_url, image_url, target_muscle, body_part, instructions)
              `)
              .eq('user_id', user.id)
              .eq('log_date', today)
              .eq('exercise_id', exercise.id)
              .limit(1)
              .maybeSingle();

            let sessionRow = existingRes.data as any;
            if (!sessionRow) {
              const latestRow = await supabase
                .from('daily_exercise_sessions')
                .select('order_index')
                .eq('user_id', user.id)
                .eq('log_date', today)
                .order('order_index', { ascending: false })
                .limit(1)
                .maybeSingle();
              const nextOrder = Number(latestRow.data?.order_index ?? -1) + 1;
              const response = await fetchWithAuth('/api/workout/daily-exercises', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  logDate: today,
                  exerciseId: exercise.id,
                  sets: 3,
                  reps: '12',
                  weightKg: defaultWeightKg,
                  restSeconds: 45,
                  orderIndex: nextOrder
                })
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(String(payload?.error || 'Khong tao duoc buoi tap'));
              }
              sessionRow = payload?.exercise;
            }

            if (sessionRow?.id) {
              navigate('/exercises/session', {
                state: {
                  session: [
                    {
                      ...sessionRow,
                      name: sessionRow.exercises?.name || exercise.name,
                      gif_url: normalizeMediaUrl(sessionRow.exercises?.image_url || exercise.gif_url)
                    }
                  ],
                  selectedSessionId: sessionRow.id,
                  logDate: today
                }
              });
              return;
            }
          }

          navigate('/exercises/session', {
            state: {
              session: [
                {
                  id: `detail-${exercise.id}`,
                  exercise_id: exercise.id,
                  name: exercise.name,
                  gif_url: exercise.gif_url,
                  sets: 3,
                  reps: '12',
                  weight_kg: defaultWeightKg,
                  rest_seconds: 45,
                  order_index: 0,
                  is_completed: false,
                  planned_sets: 3,
                  planned_reps: '12',
                  planned_weight_kg: defaultWeightKg,
                  planned_rest_seconds: 45,
                  actual_sets: 3,
                  actual_reps: '12',
                  actual_weight_kg: defaultWeightKg,
                  actual_rest_seconds: 45,
                  target_rpe: 7,
                  estimated_kcal: 0,
                  actual_kcal_estimated: 0,
                  completed_sets: 0,
                  exercises: {
                    target_muscle: exercise.target_muscle,
                    body_part: exercise.body_part,
                    instructions: exercise.instructions
                  },
                  instructions: exercise.instructions
                }
              ],
              selectedSessionId: `detail-${exercise.id}`
            }
          });
        }}
        embedded
      />
    </div>
  );
}
