import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMealPlanningCatalog,
  classifyMealFoodComponent,
  completeAiMealDay,
  getMealSlotsForCount,
  isMealFoodEligible,
} from './mealPlanningService';

const food = (id: string, name: string, category: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  category,
  calories: 150,
  protein: 0,
  carbs: 0,
  fat: 0,
  serving_unit: '100g',
  meal_type: ['breakfast', 'lunch', 'dinner'],
  ...overrides,
});

const catalog = [
  food('rice', 'Cơm gạo lứt', 'Carb', { carbs: 30 }),
  food('rice-2', 'Khoai lang', 'Carb', { carbs: 28 }),
  food('chicken', 'Ức gà', 'Chất đạm', { protein: 31 }),
  food('egg', 'Trứng luộc', 'Chất đạm', { protein: 13 }),
  food('broccoli', 'Bông cải xanh', 'Rau củ', { calories: 35, carbs: 7 }),
  food('banana', 'Chuối', 'Trái cây', { calories: 90, carbs: 22, meal_type: ['breakfast', 'snack'] }),
  food('lobster', 'Tôm hùm', 'Chất đạm', { protein: 20, price_level: 'Cao cấp' }),
];

test('meal planning slots follow the configured number of meals', () => {
  assert.deepEqual(getMealSlotsForCount(2), ['breakfast', 'dinner']);
  assert.deepEqual(getMealSlotsForCount(3), ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(getMealSlotsForCount(4), ['breakfast', 'lunch', 'dinner', 'snack']);
});

test('meal planning catalog applies backend safety before sending foods to AI', () => {
  const eligible = buildMealPlanningCatalog(catalog, {
    lifestyle: { budget_level: 'Sinh viên' },
    mealsPerDay: 3,
  });
  assert.ok(eligible.some((item) => item.id === 'chicken'));
  assert.ok(!eligible.some((item) => item.id === 'lobster'));
});

test('meal replacements must fit both the meal slot and the safety profile', () => {
  assert.ok(isMealFoodEligible(catalog[0], 'lunch', {}));
  assert.ok(!isMealFoodEligible(catalog[5], 'dinner', {}));
  assert.ok(!isMealFoodEligible(catalog[6], 'lunch', { lifestyle: { budget_level: 'Sinh viên' } }));
});

test('meal planning completes missing dinner components using the backend catalog', () => {
  const complete = completeAiMealDay([
    { meal_type: 'dinner', food_ids: ['chicken'] },
  ], catalog, 2);
  const foodById = new Map(catalog.map((item) => [item.id, item]));
  const dinnerComponents = complete
    .filter((item) => item.meal_type === 'dinner')
    .map((item) => classifyMealFoodComponent(foodById.get(item.food_id)));
  assert.ok(dinnerComponents.includes('carb'));
  assert.ok(dinnerComponents.includes('protein'));
  assert.ok(dinnerComponents.includes('vegetable'));
});
