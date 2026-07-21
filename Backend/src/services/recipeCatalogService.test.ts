import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  aggregateRecipeCost,
  aggregateRecipeNutrition,
  deriveRecipeAllergens,
  normalizeRecipe,
  normalizeRecipeInstructions,
  type Recipe,
  type RecipeIngredientWithFood,
  validateRecipe,
  validateRecipeDietarySemantics,
} from '../../../shared/recipeCatalog';

const linkedIngredient: RecipeIngredientWithFood = {
  recipe_id: 'test-recipe',
  food_id: 'food-1',
  ingredient_name: 'Known ingredient',
  amount: 100,
  unit: 'g',
  is_optional: false,
  order_index: 0,
  food: {
    id: 'food-1',
    serving_unit: '100g',
    calories: 100,
    protein: 20,
    carbs: 10,
    fat: 5,
    allergens: ['milk'],
    estimated_cost_min_vnd: 10000,
    estimated_cost_max_vnd: 15000,
  },
};

const activeRecipe: Recipe = {
  id: 'test-recipe',
  name: 'Test recipe',
  meal_type: ['lunch'],
  dietary_restrictions: [],
  diet_styles: ['balanced'],
  goal_type: ['general_fitness'],
  price_level: 'medium',
  calories: 500,
  protein: 30,
  carbs: 50,
  fat: 15,
  cooking_time_minutes: 15,
  cooking_difficulty: 'easy',
  allergens: [],
  instructions: { preparation: ['Wash ingredients'], steps: ['Cook safely'], tips: [] },
  is_active: true,
};

test('taxonomy normalization accepts JSON, delimited legacy values, and Vietnamese aliases', () => {
  const recipe = normalizeRecipe({
    id: 'legacy-recipe',
    name: 'Legacy',
    meal_type: '["Bữa sáng", "post_workout"]',
    dietary_restrictions: 'Ăn chay; vegan',
    diet_styles: 'Eat clean, Keto',
    goal_type: 'Tăng cơ; recovery',
    price_level: 'Tiết kiệm',
    cooking_difficulty: 'Trung bình',
    allergens: 'dairy, egg',
  });
  assert.deepEqual(recipe.meal_type, ['breakfast', 'post_workout']);
  assert.deepEqual(recipe.dietary_restrictions, ['vegetarian', 'vegan']);
  assert.deepEqual(recipe.diet_styles, ['clean', 'low_carb']);
  assert.deepEqual(recipe.goal_type, ['muscle_gain', 'recovery']);
  assert.equal(recipe.price_level, 'low');
  assert.equal(recipe.cooking_difficulty, 'medium');
  assert.deepEqual(recipe.allergens, ['milk', 'egg']);
});

test('recipe instruction normalization keeps the structured JSON contract', () => {
  assert.deepEqual(normalizeRecipeInstructions('Mix\nCook'), { preparation: [], steps: ['Mix', 'Cook'], tips: [] });
  assert.deepEqual(normalizeRecipeInstructions({ preparation: ['Prep'], steps: ['Cook'], tips: ['Serve warm'] }), {
    preparation: ['Prep'], steps: ['Cook'], tips: ['Serve warm'],
  });
});

test('active recipe requires recipe data and at least one ingredient while drafts remain possible', () => {
  assert.equal(validateRecipe(activeRecipe, [linkedIngredient]).valid, true);
  const invalid = validateRecipe({ id: 'draft', name: 'Incomplete', is_active: true }, []);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('missing_recipe_ingredient'));
  assert.ok(invalid.errors.includes('missing_meal_type'));
  assert.equal(validateRecipe({ id: 'draft', name: 'Incomplete', is_active: false }, []).valid, true);
});

test('vegetarian and vegan semantic checks use food metadata rather than recipe names', () => {
  const meat: RecipeIngredientWithFood = { ...linkedIngredient, food: { animal_source: ['meat'] } };
  const egg: RecipeIngredientWithFood = { ...linkedIngredient, food: { ingredient_metadata: ['egg'] } };
  assert.ok(validateRecipeDietarySemantics({ dietary_restrictions: ['vegetarian'] }, [meat]).errors.includes('ingredient_0_vegetarian_conflict'));
  assert.ok(validateRecipeDietarySemantics({ dietary_restrictions: ['vegan'] }, [egg]).errors.includes('ingredient_0_vegan_conflict'));
  assert.ok(validateRecipeDietarySemantics({ dietary_restrictions: ['vegan'] }, [{ ...linkedIngredient, food: null }]).warnings.includes('ingredient_0_metadata_unavailable'));
});

test('manual and ingredient allergens are aggregated without losing either source', () => {
  assert.deepEqual(deriveRecipeAllergens([linkedIngredient], ['peanut']), ['peanut', 'milk']);
});

test('nutrition and cost aggregation calculate only when serving conversion and source data are complete', () => {
  const doubled = { ...linkedIngredient, amount: 200 };
  assert.deepEqual(aggregateRecipeNutrition([doubled]), {
    nutrition: { calories: 200, protein: 40, carbs: 20, fat: 10 }, incomplete: false,
  });
  assert.deepEqual(aggregateRecipeCost([doubled]), {
    cost: { estimated_cost_min_vnd: 20000, estimated_cost_max_vnd: 30000 }, incomplete: false,
  });
  assert.deepEqual(aggregateRecipeNutrition([{ ...linkedIngredient, unit: 'cup' }]), { nutrition: null, incomplete: true });
  assert.deepEqual(aggregateRecipeNutrition([]), { nutrition: null, incomplete: true });
});

test('recipe migration preserves food-based weekly rows and declares FK behavior', () => {
  const migration = readFileSync(path.resolve(process.cwd(), '../supabase/migrations/20260722120000_add_recipe_catalog_architecture.sql'), 'utf8');
  assert.match(migration, /recipe_id text not null references public\.recipes\(id\) on delete cascade/i);
  assert.match(migration, /food_id uuid references public\.foods\(id\) on delete set null/i);
  assert.match(migration, /add column if not exists recipe_id text references public\.recipes\(id\) on delete set null/i);
  assert.match(migration, /is_rest_day = true or food_id is not null or recipe_id is not null/i);
});

test('recipe migration declares catalog constraints and indexes', () => {
  const migration = readFileSync(path.resolve(process.cwd(), '../supabase/migrations/20260722120000_add_recipe_catalog_architecture.sql'), 'utf8');
  for (const constraint of ['recipes_price_level_check', 'recipes_cooking_difficulty_check', 'recipes_meal_type_check', 'recipes_calories_check', 'recipes_cost_range_check', 'recipes_instructions_shape_check']) {
    assert.match(migration, new RegExp(constraint));
  }
  for (const index of ['recipes_meal_type_gin_idx', 'recipes_allergens_gin_idx', 'recipe_ingredients_recipe_id_idx', 'weekly_food_items_recipe_id_idx']) {
    assert.match(migration, new RegExp(index));
  }
});

test('recipe goal constraint reuses the established exercise goal taxonomy', () => {
  const migration = readFileSync(path.resolve(process.cwd(), '../supabase/migrations/20260723120000_enforce_recipe_goal_taxonomy.sql'), 'utf8');
  for (const goal of ['general_fitness', 'weight_loss', 'muscle_gain', 'strength', 'endurance', 'mobility', 'recovery']) {
    assert.match(migration, new RegExp(`'${goal}'`));
  }
});
