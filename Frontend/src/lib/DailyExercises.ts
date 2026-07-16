import { fetchWithAuth } from './Api';
import { supabase } from './Supabase';

const DAILY_EXERCISE_SESSION_SELECT = `
  *,
  exercises:exercise_id (name, video_url, target_muscle, body_part, instructions)
`;

type CreateDailyExerciseSessionInput = {
  userId: string;
  logDate: string;
  exerciseId: string;
  sets: number;
  reps: string;
  weightKg: number | null;
  restSeconds: number;
  orderIndex?: number | null;
  targetRpe?: number | null;
};

const resolveOrderIndex = async (
  userId: string,
  logDate: string,
  preferredOrderIndex?: number | null
): Promise<number> => {
  const numericOrderIndex = Number(preferredOrderIndex);
  if (Number.isFinite(numericOrderIndex) && numericOrderIndex >= 0) {
    return numericOrderIndex;
  }

  const latestRowRes = await supabase
    .from('daily_exercise_sessions')
    .select('order_index')
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRowRes.error) throw latestRowRes.error;
  return Math.max(0, Number(latestRowRes.data?.order_index ?? -1) + 1);
};

const loadLikelyCreatedExercise = async ({
  userId,
  logDate,
  exerciseId,
  orderIndex
}: {
  userId: string;
  logDate: string;
  exerciseId: string;
  orderIndex: number;
}) => {
  const query = supabase
    .from('daily_exercise_sessions')
    .select(DAILY_EXERCISE_SESSION_SELECT)
    .eq('user_id', userId)
    .eq('log_date', logDate)
    .eq('exercise_id', exerciseId)
    .eq('order_index', orderIndex)
    .order('created_at', { ascending: false })
    .limit(1);

  const existingRes = await query;
  if (existingRes.error) throw existingRes.error;
  return existingRes.data?.[0] || null;
};

export const createDailyExerciseSession = async ({
  userId,
  logDate,
  exerciseId,
  sets,
  reps,
  weightKg,
  restSeconds,
  orderIndex,
  targetRpe
}: CreateDailyExerciseSessionInput) => {
  const resolvedOrderIndex = await resolveOrderIndex(userId, logDate, orderIndex);
  let apiErrorMessage = 'Thêm bài tập thất bại';

  try {
    const response = await fetchWithAuth('/api/workout/daily-exercises', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        logDate,
        exerciseId,
        sets,
        reps,
        weightKg,
        restSeconds,
        orderIndex: resolvedOrderIndex,
        targetRpe
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.exercise) {
      return payload.exercise;
    }
    apiErrorMessage = String(payload?.error || apiErrorMessage);
  } catch (error: any) {
    apiErrorMessage = String(error?.message || apiErrorMessage);
  }

  const recoveredRow = await loadLikelyCreatedExercise({
    userId,
    logDate,
    exerciseId,
    orderIndex: resolvedOrderIndex
  });
  if (recoveredRow) {
    return recoveredRow;
  }

  // Direct database fallback is intentionally forbidden: all catalog adds
  // must pass the API's current ID, eligibility, and safety validation.
  throw new Error(apiErrorMessage);
};
