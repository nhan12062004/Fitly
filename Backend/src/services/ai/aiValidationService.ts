import { AIActionType } from './types';

export const validateActionPayload = (actionType: AIActionType, payload: unknown): { valid: boolean; message?: string } => {
  const data = payload as any;
  if (!data || typeof data !== 'object') {
    return { valid: false, message: 'actionPayload must be an object' };
  }

  if (actionType === 'replace_today_workout') {
    if (!Number.isInteger(Number(data.day_of_week))) return { valid: false, message: 'Missing day_of_week' };
    if (!Array.isArray(data.exercises) || data.exercises.length === 0) {
      return { valid: false, message: 'Missing exercises array' };
    }
    for (const item of data.exercises) {
      if (!item || typeof item !== 'object') return { valid: false, message: 'Invalid exercise item' };
      if (!item.exercise_id) return { valid: false, message: 'Missing exercise_id' };
      if (!Number.isInteger(Number(item.sets)) || Number(item.sets) < 1) {
        return { valid: false, message: 'Invalid sets' };
      }
      if (!String(item.reps || '').trim()) return { valid: false, message: 'Missing reps' };
      if (!Number.isInteger(Number(item.rest_seconds)) || Number(item.rest_seconds) < 0) {
        return { valid: false, message: 'Invalid rest_seconds' };
      }
    }
    return { valid: true };
  }

  if (actionType === 'replace_today_meal') {
    if (!Number.isInteger(Number(data.day_of_week))) return { valid: false, message: 'Missing day_of_week' };
    if (!String(data.old_weekly_food_item_id || '').trim()) return { valid: false, message: 'Missing old_weekly_food_item_id' };
    if (!String(data.old_food_id || '').trim()) return { valid: false, message: 'Missing old_food_id' };
    if (!String(data.new_food_id || '').trim()) return { valid: false, message: 'Missing new_food_id' };
    if (typeof data.meal_type !== 'string') return { valid: false, message: 'Missing meal_type' };
    if (!Number.isFinite(Number(data.quantity)) || Number(data.quantity) <= 0) {
      return { valid: false, message: 'Invalid quantity' };
    }
    for (const key of ['calories', 'protein', 'carbs', 'fat']) {
      if (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0) {
        return { valid: false, message: `Invalid ${key}` };
      }
    }
    return { valid: true };
  }

  if (actionType === 'create_weekly_workout_plan' || actionType === 'create_weekly_meal_plan') {
    if (typeof data.summary !== 'string') return { valid: false, message: 'Missing summary' };
    return { valid: true };
  }

  return { valid: false, message: 'Unsupported actionType' };
};
