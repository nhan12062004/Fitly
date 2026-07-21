type WorkoutDurationExercise = {
  sets?: unknown;
  actual_sets?: unknown;
  rest_seconds?: unknown;
  actual_rest_seconds?: unknown;
  estimated_duration_seconds?: unknown;
  exercises?: {
    estimated_duration_seconds?: unknown;
  } | null;
};

const DEFAULT_WORK_SECONDS_PER_SET = 50;

const positiveNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The catalog duration describes one working set. A workout's duration is the
 * sum of every exercise's working sets and its between-set rests.
 */
export const estimateWorkoutExerciseDurationSeconds = (exercise: WorkoutDurationExercise): number => {
  const sets = Math.max(1, Math.round(positiveNumber(exercise.actual_sets ?? exercise.sets, 1)));
  const workSecondsPerSet = positiveNumber(
    exercise.exercises?.estimated_duration_seconds ?? exercise.estimated_duration_seconds,
    DEFAULT_WORK_SECONDS_PER_SET,
  );
  const restSeconds = positiveNumber(exercise.actual_rest_seconds ?? exercise.rest_seconds);
  return sets * workSecondsPerSet + Math.max(0, sets - 1) * restSeconds;
};

export const estimateWorkoutDurationMinutes = (exercises: WorkoutDurationExercise[]): number => {
  if (exercises.length === 0) return 0;
  const totalSeconds = exercises.reduce(
    (sum, exercise) => sum + estimateWorkoutExerciseDurationSeconds(exercise),
    0,
  );
  return Math.max(1, Math.round(totalSeconds / 60));
};
