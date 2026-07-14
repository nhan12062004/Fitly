import { AIActionType } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const isIntegerBetween = (value: unknown, min: number, max: number): boolean => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= min && numberValue <= max;
};

const isNumberBetween = (value: unknown, min: number, max: number): boolean => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= min && numberValue <= max;
};

const hasValidReps = (value: unknown): boolean => {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return Boolean(text) && text.length <= 20;
};

const validateWorkoutPayload = (data: Record<string, unknown>): { valid: boolean; message?: string } => {
  if (!hasOnlyKeys(data, ['day_of_week', 'duration_minutes', 'exercises'])) {
    return { valid: false, message: 'Workout proposal contains unsupported fields' };
  }
  if (!isIntegerBetween(data.day_of_week, 0, 6)) return { valid: false, message: 'day_of_week must be between 0 and 6' };
  if (!isNumberBetween(data.duration_minutes, 0, 240)) return { valid: false, message: 'duration_minutes must be between 0 and 240' };
  if (!Array.isArray(data.exercises) || data.exercises.length === 0) return { valid: false, message: 'exercises must be a non-empty array' };

  const allowedExerciseKeys = ['exercise_id', 'name', 'sets', 'reps', 'rest_seconds', 'weight_kg', 'target_rpe', 'load_instruction', 'note'];
  for (const [index, value] of data.exercises.entries()) {
    if (!isRecord(value)) return { valid: false, message: `exercises[${index}] must be an object` };
    if (!hasOnlyKeys(value, allowedExerciseKeys)) return { valid: false, message: `exercises[${index}] contains unsupported fields` };
    if (typeof value.exercise_id !== 'string' || !value.exercise_id.trim()) return { valid: false, message: `exercises[${index}].exercise_id is required` };
    if (!isIntegerBetween(value.sets, 1, 8)) return { valid: false, message: `exercises[${index}].sets must be between 1 and 8` };
    if (!hasValidReps(value.reps)) return { valid: false, message: `exercises[${index}].reps is required` };
    if (!isNumberBetween(value.rest_seconds, 30, 300)) return { valid: false, message: `exercises[${index}].rest_seconds must be between 30 and 300` };
    if (!isNumberBetween(value.weight_kg, 0, 500)) return { valid: false, message: `exercises[${index}].weight_kg must be between 0 and 500` };
    if (!isNumberBetween(value.target_rpe, 5, 10)) return { valid: false, message: `exercises[${index}].target_rpe must be between 5 and 10` };
    if (value.load_instruction !== undefined && (typeof value.load_instruction !== 'string' || value.load_instruction.length > 160)) {
      return { valid: false, message: `exercises[${index}].load_instruction is invalid` };
    }
    if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 200)) {
      return { valid: false, message: `exercises[${index}].note is invalid` };
    }
  }
  return { valid: true };
};

const validateMealPayload = (data: Record<string, unknown>): { valid: boolean; message?: string } => {
  const allowedKeys = ['day_of_week', 'old_weekly_food_item_id', 'old_food_id', 'old_food_name', 'new_food_id', 'new_food_name', 'meal_type', 'quantity', 'calories', 'protein', 'carbs', 'fat', 'notes'];
  if (!hasOnlyKeys(data, allowedKeys)) return { valid: false, message: 'Meal proposal contains unsupported fields' };
  if (!isIntegerBetween(data.day_of_week, 0, 6)) return { valid: false, message: 'day_of_week must be between 0 and 6' };
  for (const key of ['old_weekly_food_item_id', 'old_food_id', 'new_food_id', 'meal_type']) {
    if (typeof data[key] !== 'string' || !data[key]?.trim()) return { valid: false, message: `${key} is required` };
  }
  if (!isNumberBetween(data.quantity, 0.25, 6)) return { valid: false, message: 'quantity must be between 0.25 and 6' };
  for (const key of ['calories', 'protein', 'carbs', 'fat']) {
    if (!isNumberBetween(data[key], 0, 10000)) return { valid: false, message: `${key} must be a non-negative number` };
  }
  return { valid: true };
};

export const validateActionPayload = (actionType: AIActionType, payload: unknown): { valid: boolean; message?: string } => {
  if (!isRecord(payload)) return { valid: false, message: 'actionPayload must be an object' };
  if (actionType === 'replace_today_workout') return validateWorkoutPayload(payload);
  if (actionType === 'replace_today_meal') return validateMealPayload(payload);

  if (actionType === 'create_weekly_workout_plan' || actionType === 'create_weekly_meal_plan') {
    if (!hasOnlyKeys(payload, ['summary', 'details'])) return { valid: false, message: 'Plan proposal contains unsupported fields' };
    if (typeof payload.summary !== 'string' || !payload.summary.trim() || payload.summary.length > 500) {
      return { valid: false, message: 'summary is required' };
    }
    return { valid: true };
  }

  return { valid: false, message: 'Unsupported actionType' };
};
