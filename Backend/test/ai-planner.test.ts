import { expect, it } from 'vitest';
import { aiPlannerService } from '../src/services/ai/aiPlannerService';

it.each(['create_workout_plan', 'create_meal_plan'] as const)(
  'does not offer an apply action that the adjustment endpoint cannot execute: %s',
  async (intent) => {
    const response = await aiPlannerService(intent, { weeklyWorkouts: 3, mealsPerDay: 3 });
    expect(response.actionRequired).toBe(false);
    expect(response.actionType).toBeNull();
    expect(response.actionPayload).toBeNull();
  },
);
