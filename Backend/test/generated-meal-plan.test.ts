import { expect, it } from 'vitest';
import { mergeGeneratedMealRows, type MealPlanRow } from '../src/services/ai/generatedMealPlanService';

const item = (day: number, id?: string): MealPlanRow => ({
  id, day_of_week: day, meal_type: 'lunch', recipe_id: `recipe-${day}`,
  quantity: 1, order_index: 0, is_rest_day: false,
});

it('replaces only the selected day and retains IDs for all other days', () => {
  const rows = mergeGeneratedMealRows('day', 1, [item(0, 'existing-monday'), item(2, 'existing-wednesday')], [item(1)]);
  expect(rows).toEqual([item(0, 'existing-monday'), item(2, 'existing-wednesday'), { ...item(1), id: null }]);
});

it('requires every day when replacing a full week', () => {
  expect(() => mergeGeneratedMealRows('week', 0, [], [item(0), item(1)])).toThrow();
  expect(mergeGeneratedMealRows('week', 0, [item(0, 'old')], Array.from({ length: 7 }, (_, day) => item(day)))).toHaveLength(7);
});
