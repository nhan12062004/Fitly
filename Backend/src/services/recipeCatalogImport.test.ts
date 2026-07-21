import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecipeUpsertPlan, validateRecipeCatalog, type RecipeCatalogItem } from '../../../shared/recipeCatalogImport';

const validRecipe = (overrides: Partial<RecipeCatalogItem> = {}): RecipeCatalogItem => ({
  id: 'tofu-rice-bowl', name: 'Tofu rice bowl', meal_type: ['lunch'], dietary_restrictions: ['vegan'], diet_styles: ['clean'], goal_type: ['general_fitness'], price_level: 'medium', calories: 450, protein: 24, carbs: 55, fat: 12, cooking_time_minutes: 20, cooking_difficulty: 'easy', allergens: ['soy'], instructions: { preparation: ['Wash vegetables'], steps: ['Cook rice', 'Assemble bowl'], tips: [] }, ingredients: [{ food_id: 'tofu', ingredient_name: 'Tofu', amount: 150, unit: 'g' }, { ingredient_name: 'Rice', amount: 80, unit: 'g' }], is_active: true, ...overrides,
});

test('recipe catalog validator accepts a canonical valid fixture and empty template mode', () => {
  assert.equal(validateRecipeCatalog([validRecipe()], { foodMetadataById: new Map([['tofu', { dietary_tags: ['vegan'], allergens: ['soy'] }]]) }).valid, true);
  assert.equal(validateRecipeCatalog([]).valid, true);
});

test('catalog validator rejects duplicate IDs, invalid taxonomy, nutrition, costs, ingredients and instructions', () => {
  const invalid = validRecipe({ meal_type: ['unknown'], calories: -1, estimated_cost_min_vnd: 20, estimated_cost_max_vnd: 10, ingredients: [], instructions: { preparation: [], steps: ['Only one'], tips: [] } });
  const result = validateRecipeCatalog([invalid, { ...validRecipe(), id: invalid.id }]);
  assert.equal(result.valid, false);
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('duplicate id')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('invalid_meal_type')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('invalid_calories')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('invalid_cost_range')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('missing_recipe_ingredient')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('at least two instruction steps')));
});

test('catalog validator catches vegetarian and vegan ingredient conflicts from linked metadata', () => {
  const foodMetadata = new Map([
    ['meat', { animal_source: ['meat'] }],
    ['milk', { animal_source: ['milk'] }],
  ]);
  const vegetarian = validRecipe({ dietary_restrictions: ['vegetarian'], ingredients: [{ food_id: 'meat', ingredient_name: 'Linked ingredient' }], allergens: [] });
  const vegan = validRecipe({ id: 'vegan-milk-bowl', dietary_restrictions: ['vegan'], ingredients: [{ food_id: 'milk', ingredient_name: 'Linked ingredient' }], allergens: [] });
  const result = validateRecipeCatalog([vegetarian, vegan], { foodMetadataById: foodMetadata });
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('vegetarian_conflict')));
  assert.ok(result.summary.errors.some((issue) => issue.message.includes('vegan_conflict')));
});

test('upsert plan is idempotent and limits ingredient changes to selected IDs', () => {
  const item = validRecipe();
  const first = buildRecipeUpsertPlan([item], []);
  const repeated = buildRecipeUpsertPlan([item], [{ id: item.id, recipe_ingredients: item.ingredients }]);
  assert.equal(first[0].operation, 'insert');
  assert.equal(repeated[0].operation, 'update');
  assert.equal(repeated[0].ingredientChanges, 0);
  assert.equal(buildRecipeUpsertPlan([], [{ id: 'legacy-weekly-food-plan' }]).length, 0);
});
