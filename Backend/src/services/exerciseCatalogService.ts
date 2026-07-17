import {
  type Exercise,
  type ExerciseEligibilityContext,
  type TrainingLocation,
  difficultyToMinimumExperienceMonths,
  experienceLevelToMonths,
  getExerciseForAI,
  isExerciseId,
  normalizeBodyPart,
  normalizeEquipment,
  normalizeExercise,
  normalizeGoalType,
  normalizeMovementPattern,
  normalizeStringArray,
  normalizeTextKey,
  normalizeTrainingLocation,
  parseAvailableEquipment,
} from '../../../shared/exerciseCatalog';
import {
  getExerciseSafetyDecision,
  type PersonalizationContext,
} from './ai/personalizationGuardService';

export type { Exercise, ExerciseEligibilityContext } from '../../../shared/exerciseCatalog';

export type ExerciseEligibilityDecision = {
  eligible: boolean;
  reasons: string[];
  exercise: Exercise;
};

export type ExerciseRankingInput = {
  targetMuscle?: string | null;
  bodyPart?: string | null;
  movementPattern?: string | null;
  recentExerciseIds?: Set<string>;
  preferLowerProgression?: boolean;
  completedWell?: boolean;
};

export type RankedExercise = {
  exercise: Exercise;
  score: number;
};

export type ExerciseIdValidation = {
  valid: boolean;
  validIds: string[];
  invalidIds: string[];
  errors: string[];
};

export type ExerciseProposalValidation = {
  valid: boolean;
  errors: string[];
  exerciseIds: string[];
};

type UserData = PersonalizationContext & {
  excludedExerciseIds?: Set<string>;
};

type EligibilityContextWithSafety = ExerciseEligibilityContext & {
  safetyContext?: PersonalizationContext;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const clampMonths = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(120, Math.round(parsed))) : 0;
};

const GENERIC_RESTRICTION_TOKENS = new Set([
  'pain', 'injury', 'condition', 'issue', 'dau', 'nhuc', 'chan', 'thuong', 'benh', 'ly',
]);

const hasCatalogContraindicationConflict = (exercise: Exercise, context: ExerciseEligibilityContext): boolean => {
  const userRestrictions = [...context.healthConditions, ...context.injuries]
    .map(normalizeTextKey)
    .filter(Boolean);
  if (userRestrictions.length === 0) return false;
  return exercise.contraindications.some((restriction) => {
    const normalizedRestriction = normalizeTextKey(restriction);
    if (!normalizedRestriction) return false;
    const restrictionTokens = normalizedRestriction.split('_').filter((token) => token.length >= 3 && !GENERIC_RESTRICTION_TOKENS.has(token));
    return userRestrictions.some((userRestriction) => {
      if (userRestriction.includes(normalizedRestriction) || normalizedRestriction.includes(userRestriction)) return true;
      const userTokens = new Set(userRestriction.split('_'));
      return restrictionTokens.some((token) => userTokens.has(token));
    });
  });
};

const toSafetyContext = (context: EligibilityContextWithSafety): PersonalizationContext => {
  if (context.safetyContext) return context.safetyContext;
  return {
    lifestyle: {
      fitness_goal: context.fitnessGoal,
      workout_location: context.workoutLocation,
      equipment_available: Array.from(context.availableEquipment).join(','),
    },
    health: {
      health_condition: context.healthConditions.join(', '),
      injuries: context.injuries.join(', '),
    },
  };
};

/** Builds the one eligibility context used by plans, AI and manual catalog selection. */
export const buildExerciseEligibilityContext = (userData: UserData = {}): ExerciseEligibilityContext => {
  const lifestyle = asRecord(userData.lifestyle);
  const health = asRecord(userData.health);
  const workoutLocation = normalizeTrainingLocation(lifestyle.workout_location);
  const experienceMonths = experienceLevelToMonths(lifestyle.experience_level);

  return {
    workoutLocation,
    availableEquipment: new Set(parseAvailableEquipment(lifestyle.equipment_available)),
    experienceMonths,
    fitnessGoal: typeof lifestyle.fitness_goal === 'string' && lifestyle.fitness_goal.trim()
      ? lifestyle.fitness_goal.trim()
      : null,
    healthConditions: normalizeStringArray(health.health_condition ?? health.medical_history),
    injuries: normalizeStringArray(health.injuries),
    ...(userData.excludedExerciseIds ? { excludedExerciseIds: new Set(userData.excludedExerciseIds) } : {}),
    safetyContext: {
      profile: userData.profile || null,
      lifestyle: userData.lifestyle || null,
      health: userData.health || null,
    },
  };
};

export const getExerciseEligibilityDecision = (
  exerciseValue: unknown,
  context: ExerciseEligibilityContext,
): ExerciseEligibilityDecision => {
  const exercise = normalizeExercise(exerciseValue);
  const reasons: string[] = [];
  if (!isExerciseId(exercise.id)) reasons.push('invalid_exercise_id');
  if (context.excludedExerciseIds?.has(exercise.id)) reasons.push('excluded_exercise_id');

  // A missing profile location must not silently choose home or gym. Existing
  // flows remain compatible by skipping only this criterion in that case.
  if (context.workoutLocation && !exercise.training_locations.includes(context.workoutLocation)) {
    reasons.push('training_location_mismatch');
  }

  const equipment = normalizeEquipment(exercise.equipment);
  if (!equipment) {
    reasons.push('unknown_exercise_equipment');
  } else if (equipment !== 'none' && !context.availableEquipment.has(equipment)) {
    reasons.push('equipment_not_available');
  }

  const minimumExperience = Number.isFinite(exercise.min_experience_months)
    ? exercise.min_experience_months
    : difficultyToMinimumExperienceMonths(exercise.difficulty);
  if (clampMonths(context.experienceMonths) < minimumExperience) {
    reasons.push('insufficient_experience');
  }
  if (hasCatalogContraindicationConflict(exercise, context)) {
    reasons.push('catalog_contraindication_conflict');
  }

  const safety = getExerciseSafetyDecision(
    { ...exercise, exercise_id: exercise.id },
    toSafetyContext(context as EligibilityContextWithSafety),
  );
  if (!safety.allowed) reasons.push(...safety.reasons.map((reason) => `safety:${reason}`));

  return { eligible: reasons.length === 0, reasons, exercise };
};

export const isExerciseEligible = (exercise: unknown, context: ExerciseEligibilityContext): boolean =>
  getExerciseEligibilityDecision(exercise, context).eligible;

export const getEligibleExercises = (
  exercises: unknown[] | null | undefined,
  context: ExerciseEligibilityContext,
): Exercise[] => (exercises || [])
  .map((exercise) => getExerciseEligibilityDecision(exercise, context))
  .filter((decision) => decision.eligible)
  .map((decision) => decision.exercise);

const experienceToProgressionLevel = (months: number): number => {
  if (months <= 0) return 1;
  if (months <= 3) return 2;
  if (months <= 6) return 3;
  if (months <= 12) return 4;
  return 5;
};

export const rankExercises = (
  exercises: Exercise[] | null | undefined,
  context: ExerciseEligibilityContext,
  rankingInput: ExerciseRankingInput = {},
): RankedExercise[] => {
  const goal = normalizeGoalType(context.fitnessGoal);
  const targetMuscle = normalizeBodyPart(rankingInput.targetMuscle);
  const bodyPart = normalizeBodyPart(rankingInput.bodyPart);
  const movementPattern = normalizeMovementPattern(rankingInput.movementPattern);
  const preferredProgression = experienceToProgressionLevel(context.experienceMonths);

  return (exercises || [])
    .map((exercise) => {
      let score = 0;
      if (goal && exercise.goal_type.map(normalizeGoalType).includes(goal)) score += 5;
      if (targetMuscle && normalizeBodyPart(exercise.target_muscle) === targetMuscle) score += 4;
      if (bodyPart && normalizeBodyPart(exercise.body_part) === bodyPart) score += 3;
      if (movementPattern && normalizeMovementPattern(exercise.movement_pattern) === movementPattern) score += 3;
      if (normalizeEquipment(exercise.equipment) === 'none') score += context.availableEquipment.size <= 1 ? 2 : 0;
      score -= Math.abs(exercise.progression_level - preferredProgression);
      if (rankingInput.preferLowerProgression) score -= exercise.progression_level;
      if (rankingInput.completedWell && exercise.progression_level <= Math.min(5, preferredProgression + 1)) score += 1;
      if (rankingInput.recentExerciseIds?.has(exercise.id)) score -= 3;
      return { exercise, score };
    })
    .sort((left, right) => right.score - left.score || left.exercise.id.localeCompare(right.exercise.id));
};

export const validateExerciseIds = (
  ids: unknown,
  catalog: unknown[] | null | undefined,
  context: ExerciseEligibilityContext,
): ExerciseIdValidation => {
  const requestedIds = Array.isArray(ids)
    ? ids.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean)
    : [];
  const catalogById = new Map(
    (catalog || []).map((item) => {
      const normalized = normalizeExercise(item);
      return [normalized.id, normalized] as const;
    }),
  );
  const invalidIds: string[] = [];
  const errors: string[] = [];
  const validIds: string[] = [];

  if (requestedIds.length === 0) errors.push('proposal contains no exercise ids');
  requestedIds.forEach((id) => {
    const exercise = catalogById.get(id);
    if (!exercise) {
      invalidIds.push(id);
      errors.push(`exercise id does not exist: ${id}`);
      return;
    }
    const decision = getExerciseEligibilityDecision(exercise, context);
    if (!decision.eligible) {
      invalidIds.push(id);
      errors.push(`exercise id is not eligible: ${id} (${decision.reasons.join(', ')})`);
      return;
    }
    validIds.push(id);
  });

  return { valid: errors.length === 0, validIds, invalidIds, errors };
};

const collectWorkoutExercisePayloads = (proposal: unknown): Array<Record<string, unknown>> => {
  const root = asRecord(proposal);
  const workout = asRecord(root.workout_plan ?? root.workoutPlan ?? root);
  const directExercises = workout.exercises;
  if (Array.isArray(directExercises)) return directExercises.map(asRecord);
  const days = workout.days;
  if (!Array.isArray(days)) return [];
  return days.flatMap((day) => {
    const exerciseValues = asRecord(day).exercises;
    return Array.isArray(exerciseValues) ? exerciseValues.map(asRecord) : [];
  });
};

const getWorkoutProposalRecord = (proposal: unknown): Record<string, unknown> => {
  const root = asRecord(proposal);
  return asRecord(root.workout_plan ?? root.workoutPlan ?? root);
};

const WEEKDAY_TO_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
  thu_2: 0,
  thu_3: 1,
  thu_4: 2,
  thu_5: 3,
  thu_6: 4,
  thu_7: 5,
  chu_nhat: 6,
};

const getWeekdayIndex = (value: unknown): number | null => {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
  return WEEKDAY_TO_INDEX[normalizeTextKey(value)] ?? null;
};

const validateSevenDayWorkoutShape = (proposal: unknown): string[] => {
  const workout = getWorkoutProposalRecord(proposal);
  const errors: string[] = [];
  const allowedWorkoutKeys = new Set(['plan_name', 'name', 'goal', 'explanation', 'description', 'days']);
  Object.keys(workout).forEach((key) => {
    if (!allowedWorkoutKeys.has(key)) errors.push(`workout_plan.${key} is not allowed`);
  });
  if (!Array.isArray(workout.days)) return [...errors, 'workout_plan.days must be an array'];
  if (workout.days.length !== 7) errors.push('workout_plan.days must contain exactly seven days');
  const seenDays = new Set<number>();
  workout.days.forEach((value, index) => {
    const day = asRecord(value);
    const path = `workout_plan.days[${index}]`;
    const allowedDayKeys = new Set(['day', 'day_of_week', 'type', 'is_rest_day', 'duration_minutes', 'exercises']);
    Object.keys(day).forEach((key) => {
      if (!allowedDayKeys.has(key)) errors.push(`${path}.${key} is not allowed`);
    });
    const dayIndex = getWeekdayIndex(day.day_of_week ?? day.day);
    if (dayIndex === null) errors.push(`${path}.day must resolve to 0 through 6`);
    else if (seenDays.has(dayIndex)) errors.push(`${path}.day is duplicated`);
    else seenDays.add(dayIndex);
    if (!Number.isFinite(Number(day.duration_minutes)) || Number(day.duration_minutes) < 0 || Number(day.duration_minutes) > 240) {
      errors.push(`${path}.duration_minutes must be from 0 to 240`);
    }
    // An omitted exercises field is an empty/rest day. The later prescription
    // check still rejects a schedule unless it has the exact required number
    // of active days, so this only tolerates a common AI JSON omission.
  });
  return errors;
};

const validatePrescriptionFields = (item: Record<string, unknown>, path: string): string[] => {
  const errors: string[] = [];
  const allowedKeys = new Set(['exercise_id', 'name', 'sets', 'reps', 'weight_kg', 'rest_seconds', 'target_rpe', 'load_instruction', 'note', 'order_index']);
  Object.keys(item).forEach((key) => {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not allowed`);
  });
  const sets = Number(item.sets);
  const restSeconds = Number(item.rest_seconds);
  const rpe = Number(item.target_rpe);
  if (!Number.isInteger(sets) || sets < 1 || sets > 8) errors.push(`${path}.sets must be an integer from 1 to 8`);
  const reps = typeof item.reps === 'number' ? String(item.reps) : typeof item.reps === 'string' ? item.reps.trim() : '';
  if (!reps || reps.length > 20) errors.push(`${path}.reps must be a non-empty string or number up to 20 chars`);
  if (!Number.isFinite(restSeconds) || restSeconds < 30 || restSeconds > 300) errors.push(`${path}.rest_seconds must be from 30 to 300`);
  if (!Number.isFinite(rpe) || rpe < 5 || rpe > 10) errors.push(`${path}.target_rpe must be from 5 to 10`);
  const weight = Number(item.weight_kg);
  if (!Number.isFinite(weight) || weight < 0 || weight > 500) errors.push(`${path}.weight_kg must be from 0 to 500`);
  return errors;
};

/**
 * Rejects the entire proposal when one AI-selected exercise fails. It never
 * returns a partially sanitized list for a mutation endpoint.
 */
export const validateExerciseProposal = (
  proposal: unknown,
  context: ExerciseEligibilityContext,
  catalog: unknown[] | null | undefined,
  options: { allowEmpty?: boolean; requireSevenDays?: boolean } = {},
): ExerciseProposalValidation => {
  const exercisePayloads = collectWorkoutExercisePayloads(proposal);
  const errors = options.requireSevenDays ? validateSevenDayWorkoutShape(proposal) : [];
  if (exercisePayloads.length === 0) {
    return options.allowEmpty
      ? { valid: errors.length === 0, errors, exerciseIds: [] }
      : { valid: false, errors: [...errors, 'proposal contains no workout exercises'], exerciseIds: [] };
  }
  const exerciseIds = exercisePayloads.map((item) => String(item.exercise_id || '').trim());
  errors.push(...exercisePayloads.flatMap((item, index) => validatePrescriptionFields(item, `exercises[${index}]`)));
  const idsValidation = validateExerciseIds(exerciseIds, catalog, context);
  errors.push(...idsValidation.errors);
  return { valid: errors.length === 0, errors, exerciseIds };
};

export const toEligibleExerciseCatalogForAI = (
  exercises: unknown[] | null | undefined,
  context: ExerciseEligibilityContext,
  rankingInput: ExerciseRankingInput = {},
) => rankExercises(getEligibleExercises(exercises, context), context, rankingInput)
  .map(({ exercise }) => getExerciseForAI(exercise));

export const summarizeEligibilityFailure = (decision: ExerciseEligibilityDecision): string =>
  `${decision.exercise.id || 'unknown'}: ${decision.reasons.join(', ') || 'not eligible'}`;
