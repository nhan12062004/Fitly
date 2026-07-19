import { supabase } from '../config/Supabase';

type PrescriptionSource = 'ai_plan' | 'manual_add' | 'edit' | 'ai_adjustment';

type WorkoutPrescriptionInput = {
  userId: string;
  exerciseId: string;
  exercise?: any;
  source: PrescriptionSource;
  suggestedSets?: unknown;
  suggestedReps?: unknown;
  suggestedWeightKg?: unknown;
  suggestedRestSeconds?: unknown;
  suggestedTargetRpe?: unknown;
  forceManualWeight?: boolean;
};

export type WorkoutPrescription = {
  sets: number;
  reps: string;
  weightKg: number | null;
  restSeconds: number;
  targetRpe: number;
  estimatedKcal: number;
  loadInstruction: string | null;
};

const normalizeText = (value: unknown): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const includesAny = (text: string, keywords: string[]): boolean =>
  keywords.some((keyword) => text.includes(normalizeText(keyword)));

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const readNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (value === null || value === undefined || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const parseAverageRepsForPrescription = (repsText: string): number => {
  const numbers = String(repsText || '')
    .match(/\d+/g)
    ?.map(Number)
    .filter((value) => Number.isFinite(value)) || [];
  if (numbers.length === 0) return 10;
  if (numbers.length === 1) return numbers[0];
  return Math.round((numbers[0] + numbers[numbers.length - 1]) / 2);
};

export const estimateWorkoutKcal = ({
  exercise,
  bodyWeightKg,
  sets,
  repsText,
  weightKg,
  restSeconds
}: {
  exercise?: any;
  bodyWeightKg: number;
  sets: number;
  repsText: string;
  weightKg: number;
  restSeconds: number;
}): number => {
  const safeSets = Math.max(1, Number(sets) || 1);
  const safeReps = Math.max(1, parseAverageRepsForPrescription(repsText));
  const safeWeightKg = Math.max(0, Number(weightKg) || 0);
  const safeBodyWeightKg = Math.max(40, Number(bodyWeightKg) || 70);
  const workSeconds = safeSets * safeReps * (safeWeightKg > 0 ? 3.2 : 2.6);
  const pauseSeconds = Math.max(0, safeSets - 1) * Math.max(0, Number(restSeconds) || 0);
  const descriptor = getExerciseDescriptor(exercise);
  const difficulty = normalizeText(exercise?.difficulty);
  const catalogCaloriesPerMinute = Number(exercise?.calories_per_minute);
  const isCardioOrBodyweight = isBodyweightOrCardio(exercise) || includesAny(descriptor, ['locomotion', 'mountain climber']);
  const isMobilityOrRecovery = includesAny(descriptor, ['mobility', 'stretch', 'recovery', 'gi an', 'keo gian']);

  // MET lets the estimate scale with the member's body mass. A catalog value,
  // when present, remains authoritative and is converted from a 70 kg baseline.
  let activeMet = Number.isFinite(catalogCaloriesPerMinute) && catalogCaloriesPerMinute > 0
    ? (catalogCaloriesPerMinute * 200) / (3.5 * 70)
    : isMobilityOrRecovery
      ? 3
      : isCardioOrBodyweight
        ? 6.5
        : 5;
  if (includesAny(difficulty, ['hard', 'advanced', 'kho'])) activeMet += 1.25;
  if (includesAny(difficulty, ['easy', 'beginner', 'de'])) activeMet -= 0.75;
  activeMet += Math.min(1.5, (safeWeightKg / safeBodyWeightKg) * 1.5);

  const activeMinutes = workSeconds / 60;
  const restMinutes = pauseSeconds / 60;
  const activeCaloriesPerMinute = Math.max(1, (Math.max(2.5, activeMet) * 3.5 * safeBodyWeightKg) / 200);
  const restCaloriesPerMinute = (1.5 * 3.5 * safeBodyWeightKg) / 200;
  const calories = activeMinutes * activeCaloriesPerMinute + restMinutes * restCaloriesPerMinute;
  return Math.max(1, Math.min(300, Math.round(calories)));
};

const getExerciseDescriptor = (exercise?: any): string =>
  normalizeText(`${exercise?.name || ''} ${exercise?.body_part || ''} ${exercise?.target_muscle || ''} ${exercise?.equipment || ''} ${exercise?.movement_pattern || ''}`);

const isBodyweightOrCardio = (exercise?: any): boolean => {
  const descriptor = getExerciseDescriptor(exercise);
  const equipment = normalizeText(exercise?.equipment);
  return (
    equipment === 'none' ||
    includesAny(descriptor, ['cardio', 'aerobic', 'running', 'jump', 'nhay', 'chay']) ||
    includesAny(equipment, ['khong dung cu', 'bodyweight', 'body weight', 'resistance band', 'band', 'day khang luc'])
  );
};

const inferGoal = (lifestyle: any, exercise?: any, source?: PrescriptionSource): 'strength' | 'hypertrophy' | 'fat_loss' | 'general' | 'recovery' => {
  if (source === 'ai_adjustment') return 'recovery';
  const goalText = normalizeText(`${lifestyle?.fitness_goal || ''} ${exercise?.goal_type || ''}`);
  if (includesAny(goalText, ['strength', 'suc manh', 'power'])) return 'strength';
  if (includesAny(goalText, ['tang co', 'muscle', 'hypertrophy', 'build'])) return 'hypertrophy';
  if (includesAny(goalText, ['giam mo', 'giam can', 'fat loss', 'weight loss', 'lean'])) return 'fat_loss';
  return 'general';
};

const inferReps = (goal: ReturnType<typeof inferGoal>, exercise?: any, suggestedReps?: unknown): string => {
  const descriptor = getExerciseDescriptor(exercise);
  const suggested = String(suggestedReps || '').trim().slice(0, 20);
  const avgSuggested = suggested ? parseAverageRepsForPrescription(suggested) : 0;
  const isCoreOrBodyweight = includesAny(descriptor, ['abs', 'core', 'bung', 'plank', 'bodyweight']);
  const range =
    goal === 'strength'
      ? [4, 6]
      : goal === 'hypertrophy'
        ? [8, 12]
        : goal === 'recovery'
          ? [10, 15]
          : isCoreOrBodyweight
            ? [12, 20]
            : [10, 15];

  if (suggested && avgSuggested >= range[0] && avgSuggested <= range[1]) return suggested;
  return `${range[0]}-${range[1]}`;
};

const inferSets = ({
  goal,
  lifestyle,
  suggestedSets,
  recentCompletionRate
}: {
  goal: ReturnType<typeof inferGoal>;
  lifestyle: any;
  suggestedSets?: unknown;
  recentCompletionRate: number | null;
}): number => {
  const experience = normalizeText(lifestyle?.experience_level);
  const duration = Number(lifestyle?.workout_duration) || 30;
  const weeklyWorkouts = Number(lifestyle?.weekly_workouts) || 3;
  const suggested = readNumber(suggestedSets);

  let base = goal === 'strength' ? 4 : goal === 'hypertrophy' ? 3 : goal === 'recovery' ? 2 : 3;
  if (includesAny(experience, ['advanced', 'nang cao'])) base += 1;
  if (includesAny(experience, ['beginner', 'moi', 'de'])) base -= 1;
  if (duration < 25 || weeklyWorkouts >= 5) base -= 1;
  if (duration >= 50 && weeklyWorkouts <= 4 && goal !== 'recovery') base += 1;
  if (recentCompletionRate !== null && recentCompletionRate < 0.75) base -= 1;

  const algorithmSets = Math.round(clamp(base, 1, 6));
  if (suggested === null) return algorithmSets;
  return Math.round(clamp(Math.round((algorithmSets * 2 + suggested) / 3), 1, 6));
};

const inferRestSeconds = (goal: ReturnType<typeof inferGoal>, suggestedRestSeconds?: unknown): number => {
  const suggested = readNumber(suggestedRestSeconds);
  const fallback = goal === 'strength' ? 120 : goal === 'hypertrophy' ? 75 : goal === 'recovery' ? 90 : 60;
  if (suggested === null) return fallback;
  const min = goal === 'strength' ? 90 : 30;
  const max = goal === 'strength' ? 180 : 120;
  return Math.round(clamp(suggested, min, max));
};

const intensityForReps = (averageReps: number): number => {
  if (averageReps <= 3) return 0.9;
  if (averageReps <= 5) return 0.85;
  if (averageReps <= 8) return 0.78;
  if (averageReps <= 10) return 0.73;
  if (averageReps <= 12) return 0.67;
  if (averageReps <= 15) return 0.6;
  return 0.52;
};

const roundLoad = (weightKg: number, exercise?: any): number => {
  const equipment = normalizeText(exercise?.equipment);
  const increment = includesAny(equipment, ['barbell', 'thanh don', 'smith', 'machine', 'may']) ? 2.5 : 1;
  return Math.max(0, Math.round(weightKg / increment) * increment);
};

const suggestStartingWeightKg = ({ exercise, bodyWeightKg }: { exercise?: any; bodyWeightKg: number }): number => {
  if (isBodyweightOrCardio(exercise)) return 0;

  const descriptor = getExerciseDescriptor(exercise);
  const equipment = normalizeText(exercise?.equipment);
  const safeBodyWeightKg = Math.max(40, Number(bodyWeightKg) || 70);
  const isLowerBody = includesAny(descriptor, ['leg', 'legs', 'chan', 'dui', 'glute', 'mong', 'hamstring', 'quadriceps', 'calf']);
  const isLargeUpper = includesAny(descriptor, ['chest', 'nguc', 'back', 'lung', 'lat', 'row', 'press']);
  const isSmallUpper = includesAny(descriptor, ['shoulder', 'vai', 'arm', 'tay', 'bicep', 'tricep', 'forearm']);
  const isCore = includesAny(descriptor, ['abs', 'core', 'bung', 'oblique']);
  const isBarbellOrMachine = includesAny(equipment, ['barbell', 'thanh don', 'ta don lon', 'machine', 'may', 'smith']);
  const isDumbbellOrKettlebell = includesAny(equipment, ['dumbbell', 'ta don', 'kettlebell', 'ta chuong']);
  const isCable = includesAny(equipment, ['cable', 'cap']);
  const difficulty = normalizeText(exercise?.difficulty);

  let bodyWeightRatio = 0.08;
  if (isLowerBody) bodyWeightRatio = isBarbellOrMachine ? 0.35 : isDumbbellOrKettlebell ? 0.18 : isCable ? 0.14 : 0.16;
  else if (isLargeUpper) bodyWeightRatio = isBarbellOrMachine ? 0.22 : isDumbbellOrKettlebell ? 0.12 : isCable ? 0.1 : 0.12;
  else if (isSmallUpper) bodyWeightRatio = isBarbellOrMachine ? 0.12 : isDumbbellOrKettlebell ? 0.07 : isCable ? 0.06 : 0.07;
  else if (isCore) bodyWeightRatio = 0.05;

  const difficultyFactor = includesAny(difficulty, ['advanced', 'kho', 'hard'])
    ? 1.15
    : includesAny(difficulty, ['beginner', 'de', 'easy'])
      ? 0.75
      : 1;
  return Math.max(2.5, Math.min(80, roundLoad(safeBodyWeightKg * bodyWeightRatio * difficultyFactor, exercise)));
};

const getRecentExerciseHistory = async (userId: string, exerciseId: string) => {
  const sessionsRes = await supabase
    .from('daily_exercise_sessions')
    .select('id, log_date, actual_sets, sets, actual_reps, reps, actual_weight_kg, weight_kg, completed_sets, is_completed')
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .order('log_date', { ascending: false })
    .limit(8);
  if (sessionsRes.error) throw sessionsRes.error;
  return sessionsRes.data || [];
};

const inferWeightKg = async ({
  userId,
  exerciseId,
  exercise,
  bodyWeightKg,
  reps,
  suggestedWeightKg,
  forceManualWeight,
  recentHistory
}: {
  userId: string;
  exerciseId: string;
  exercise?: any;
  bodyWeightKg: number;
  reps: string;
  suggestedWeightKg?: unknown;
  forceManualWeight?: boolean;
  recentHistory: any[];
}): Promise<{ weightKg: number | null; recentCompletionRate: number | null }> => {
  const manualWeight = readNumber(suggestedWeightKg);
  if (isBodyweightOrCardio(exercise)) {
    return { weightKg: 0, recentCompletionRate: null };
  }
  if (forceManualWeight && manualWeight !== null) {
    return { weightKg: Math.max(0, manualWeight), recentCompletionRate: null };
  }

  const completedRates = recentHistory
    .map((item: any) => {
      const totalSets = Math.max(1, Number(item.actual_sets ?? item.sets) || 1);
      return clamp((Number(item.completed_sets) || (item.is_completed ? totalSets : 0)) / totalSets, 0, 1);
    })
    .filter((value: number) => Number.isFinite(value));
  const recentCompletionRate = completedRates.length > 0
    ? completedRates.reduce((sum: number, value: number) => sum + value, 0) / completedRates.length
    : null;

  const latestWeighted = recentHistory.find((item: any) => Number(item.actual_weight_kg ?? item.weight_kg) > 0);
  if (latestWeighted) {
    const lastWeight = Math.max(0, Number(latestWeighted.actual_weight_kg ?? latestWeighted.weight_kg) || 0);
    const lastAvgReps = parseAverageRepsForPrescription(String((latestWeighted.actual_reps ?? latestWeighted.reps) || '10'));
    const estimatedOneRm = lastWeight * (1 + lastAvgReps / 30);
    const targetWeight = estimatedOneRm * intensityForReps(parseAverageRepsForPrescription(reps));
    const adjusted = recentCompletionRate !== null && recentCompletionRate >= 0.95
      ? targetWeight * 1.025
      : recentCompletionRate !== null && recentCompletionRate < 0.75
        ? targetWeight * 0.92
        : targetWeight;
    return { weightKg: Math.max(0, roundLoad(adjusted, exercise)), recentCompletionRate };
  }

  const seeded = suggestStartingWeightKg({ exercise, bodyWeightKg });
  if (manualWeight !== null && manualWeight > 0) {
    return { weightKg: Math.min(manualWeight, seeded * 1.15), recentCompletionRate };
  }
  return { weightKg: seeded, recentCompletionRate };
};

export const prescribeWorkoutExercise = async ({
  userId,
  exerciseId,
  exercise,
  source,
  suggestedSets,
  suggestedReps,
  suggestedWeightKg,
  suggestedRestSeconds,
  suggestedTargetRpe,
  forceManualWeight
}: WorkoutPrescriptionInput): Promise<WorkoutPrescription> => {
  const [bodyMetricsRes, lifestyleRes, recentHistory] = await Promise.all([
    supabase
      .from('body_metrics')
      .select('weight, height, body_fat_percentage, body_fat, target_weight')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('lifestyle_settings')
      .select('fitness_goal, workout_duration, weekly_workouts, experience_level, activity_level, equipment_available')
      .eq('user_id', userId)
      .maybeSingle(),
    getRecentExerciseHistory(userId, exerciseId)
  ]);
  if (bodyMetricsRes.error) throw bodyMetricsRes.error;
  if (lifestyleRes.error) throw lifestyleRes.error;

  const bodyWeightKg = Math.max(40, Number(bodyMetricsRes.data?.weight) || 70);
  const lifestyle = lifestyleRes.data || {};
  const goal = inferGoal(lifestyle, exercise, source);
  const reps = inferReps(goal, exercise, suggestedReps);
  const { weightKg, recentCompletionRate } = await inferWeightKg({
    userId,
    exerciseId,
    exercise,
    bodyWeightKg,
    reps,
    suggestedWeightKg,
    forceManualWeight,
    recentHistory
  });
  const sets = inferSets({ goal, lifestyle, suggestedSets, recentCompletionRate });
  const restSeconds = inferRestSeconds(goal, suggestedRestSeconds);
  const targetRpe = Math.round(clamp(readNumber(suggestedTargetRpe) ?? (goal === 'recovery' ? 6 : 7), 5, 10) * 10) / 10;
  const estimatedKcal = estimateWorkoutKcal({
    exercise,
    bodyWeightKg,
    sets,
    repsText: reps,
    weightKg: weightKg ?? 0,
    restSeconds
  });

  return {
    sets,
    reps,
    weightKg,
    restSeconds,
    targetRpe,
    estimatedKcal,
    loadInstruction: weightKg && weightKg > 0
      ? 'Chọn mức tạ còn dư khoảng 2 reps; giảm tạ nếu mất form.'
      : 'Giữ form chắc, tăng độ khó bằng tempo hoặc biên độ nếu còn quá nhẹ.'
  };
};
