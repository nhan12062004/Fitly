import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMealPlanningCatalog,
  calculateMealNutritionTotals,
  calculateNutritionMacroTargets,
  classifyMealFoodComponent,
  completeAiMealDay,
  getMealSlotsForCount,
  isMealFoodEligible,
  optimizeMealPlanQuantities,
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

test('nutrition macro targets adapt to the fitness goal on the backend', () => {
  const gain = calculateNutritionMacroTargets({ targetCalories: 3082, fitnessGoal: 'Tăng cơ' });
  const loss = calculateNutritionMacroTargets({ targetCalories: 2000, fitnessGoal: 'Giảm mỡ' });

  assert.equal(gain.protein.grams, 158);
  assert.equal(gain.carbs.grams, 420);
  assert.equal(gain.fat.grams, 86);
  assert.equal(gain.summary, 'Tăng cơ (+250 kcal/ngày)');
  assert.equal(loss.protein.percentage, 35);
  assert.notEqual(loss.protein.percentage, gain.protein.percentage);
});

test('nutrition optimizer adjusts portions toward the daily target without changing food choices', () => {
  const target = calculateNutritionMacroTargets({ targetCalories: 1800, fitnessGoal: 'Tăng cơ' });
  const initial = [
    { meal_type: 'breakfast' as const, food_id: 'rice', quantity: 0.5, order_index: 0 },
    { meal_type: 'breakfast' as const, food_id: 'chicken', quantity: 0.5, order_index: 1 },
    { meal_type: 'breakfast' as const, food_id: 'banana', quantity: 0.5, order_index: 2 },
    { meal_type: 'lunch' as const, food_id: 'rice-2', quantity: 0.5, order_index: 3 },
    { meal_type: 'lunch' as const, food_id: 'broccoli', quantity: 1, order_index: 4 },
    { meal_type: 'dinner' as const, food_id: 'egg', quantity: 0.5, order_index: 5 },
  ];
  const before = calculateMealNutritionTotals(initial, catalog);
  const optimized = optimizeMealPlanQuantities(initial, catalog, target, 3);
  const after = calculateMealNutritionTotals(optimized, catalog);

  assert.deepEqual(optimized.map((item) => item.food_id), initial.map((item) => item.food_id));
  assert.ok(Math.abs(after.calories - target.calorieTarget) < Math.abs(before.calories - target.calorieTarget));
  assert.ok(optimized.every((item) => item.quantity >= 0.25 && item.quantity <= 3));
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
