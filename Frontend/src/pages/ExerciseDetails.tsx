import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ExerciseDetailOverlay, { type ExerciseDetailItem } from '../components/ExerciseDetailOverlay';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/Supabase';

interface ExerciseDetailsLocationState {
  exercise?: ExerciseDetailItem;
}

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

function ExerciseDetailsSkeleton() {
  return (
    <div className="flex-1 min-h-0 max-w-[1700px] mx-auto w-full animate-pulse">
      <div className="h-full rounded-xl border border-border-primary/50 bg-bg-secondary/40 p-4 md:p-5">
        <div className="mb-4 h-10 w-full rounded-xl bg-bg-tertiary/50" />
        <div className="grid gap-6 rounded-xl border border-border-primary/40 bg-bg-secondary/40 p-4 md:grid-cols-[minmax(0,0.9fr)_minmax(320px,1.1fr)] md:p-5">
          <div>
            <div className="aspect-video w-full rounded-xl border border-border-primary/40 bg-bg-tertiary/30" />
            <div className="mt-6 rounded-xl border border-border-primary/40 bg-bg-tertiary/20 p-4">
              <div className="h-5 w-44 rounded bg-bg-tertiary/60" />
              <div className="mt-3 space-y-2.5">
                <div className="h-4 w-full rounded bg-bg-tertiary/50" />
                <div className="h-4 w-11/12 rounded bg-bg-tertiary/50" />
                <div className="h-4 w-10/12 rounded bg-bg-tertiary/50" />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="h-8 w-2/3 rounded bg-bg-tertiary/60" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="h-20 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
              <div className="h-20 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
              <div className="h-20 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
              <div className="h-20 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
            </div>
            <div className="flex gap-2.5">
              <div className="h-10 w-40 rounded-xl bg-bg-tertiary/60" />
              <div className="h-10 w-32 rounded-xl bg-bg-tertiary/60" />
            </div>
            <div className="h-32 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
            <div className="h-28 rounded-xl border border-border-primary/40 bg-bg-tertiary/20" />
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
  const [exerciseDetail, setExerciseDetail] = useState<ExerciseDetailItem | null>(state.exercise || null);
  const [isResolvingDetail, setIsResolvingDetail] = useState(() => !!state.exercise?.id);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | ''>('');
  const [toastVisible, setToastVisible] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(true);

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
      const { error } = await supabase.from('daily_exercise_sessions').insert({
        user_id: user.id,
        log_date: today,
        exercise_id: exercise.id,
        sets: 3,
        reps: '12',
        weight_kg: 0,
        rest_seconds: 45,
        order_index: nextOrder,
        is_completed: false
      });

      if (error) throw error;
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
    const id = window.setTimeout(() => setIsPageLoading(false), 200);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const exerciseId = state.exercise?.id;
    if (!exerciseId) {
      setIsResolvingDetail(false);
      return;
    }

    const fetchDetail = async () => {
      try {
        const { data } = await supabase
          .from('exercises')
          .select('id, name, target_muscle, body_part, gif_url, image_url, equipment, instructions, secondary_muscles')
          .eq('id', String(exerciseId))
          .maybeSingle();

        if (!data) return;

        setExerciseDetail({
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
        });
      } finally {
        setIsResolvingDetail(false);
      }
    };

    fetchDetail();
  }, [state.exercise?.id]);

  if (isPageLoading || isResolvingDetail) {
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
    <div className="flex-1 min-h-0 max-w-[1700px] mx-auto w-full overflow-y-auto custom-scrollbar pr-1 text-sm">
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
        onStartNow={(exercise) =>
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
                  weight_kg: 0,
                  rest_seconds: 45,
                  order_index: 0,
                  is_completed: false,
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
          })
        }
        embedded
      />
    </div>
  );
}
