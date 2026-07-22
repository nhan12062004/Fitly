type WorkoutDurationExercise = {
  sets?: unknown;
  actual_sets?: unknown;
  reps?: unknown;
  actual_reps?: unknown;
  rest_seconds?: unknown;
  actual_rest_seconds?: unknown;
  estimated_duration_seconds?: unknown;
  exercises?: {
    estimated_duration_seconds?: unknown;
  } | null;
};

const DEFAULT_WORK_SECONDS_PER_SET = 50;
const DEFAULT_SECONDS_PER_REP = 4;
const EXERCISE_CHANGEOVER_SECONDS = 45;

const positiveNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const averageReps = (value: unknown): number => {
  const reps = String(value ?? '')
    .match(/\d+/g)
    ?.map(Number)
    .filter((item) => Number.isFinite(item) && item > 0) || [];
  if (reps.length === 0) return 10;
  if (reps.length === 1) return reps[0];
  return (reps[0] + reps[reps.length - 1]) / 2;
};

/**
 * The catalog duration describes one working set. A workout's duration is the
 * sum of every exercise's working sets and its between-set rests.
 */
export const estimateWorkoutExerciseDurationSeconds = (exercise: WorkoutDurationExercise): number => {
  const sets = Math.max(1, Math.round(positiveNumber(exercise.actual_sets ?? exercise.sets, 1)));
  const catalogSecondsPerSet = positiveNumber(
    exercise.exercises?.estimated_duration_seconds ?? exercise.estimated_duration_seconds,
    DEFAULT_WORK_SECONDS_PER_SET,
  );
  const repBasedSecondsPerSet = averageReps(exercise.actual_reps ?? exercise.reps) * DEFAULT_SECONDS_PER_REP;
  const workSecondsPerSet = Math.max(catalogSecondsPerSet, repBasedSecondsPerSet);
  const restSeconds = positiveNumber(exercise.actual_rest_seconds ?? exercise.rest_seconds);
  return sets * workSecondsPerSet + Math.max(0, sets - 1) * restSeconds;
};

export const estimateWorkoutDurationMinutes = (exercises: WorkoutDurationExercise[]): number => {
  if (exercises.length === 0) return 0;
  const totalSeconds = exercises.reduce(
    (sum, exercise) => sum + estimateWorkoutExerciseDurationSeconds(exercise),
    0,
  ) + Math.max(0, exercises.length - 1) * EXERCISE_CHANGEOVER_SECONDS;
  return Math.max(1, Math.round(totalSeconds / 60));
};
