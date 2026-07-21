import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecipeEligibilityContext,
  filterEligibleRecipes,
  getRecipeEligibilityDecision,
  validateRecipeMealProposal,
  type RecipeCandidate,
} from './recipeEligibilityService';

const recipe = (id: string, overrides: Record<string, unknown> = {}): RecipeCandidate => ({
  id, name: id, is_active: true, meal_type: ['lunch'], dietary_restrictions: [], diet_styles: [], goal_type: [],
  price_level: 'medium', calories: 500, protein: 30, carbs: 50, fat: 15, cooking_time_minutes: 20,
  cooking_difficulty: 'easy', allergens: [], instructions: { preparation: [], steps: ['Cook'], tips: [] },
  recipe_ingredients: [{ recipe_id: id, ingredient_name: 'Ingredient', is_optional: false, order_index: 0, food: { dietary_tags: ['vegetarian', 'vegan'] } }],
  ...overrides,
});

test('recipe eligibility supports vegetarian + clean and vegan + high protein together', () => {
  const vegetarian = recipe('vegetarian', { dietary_restrictions: ['vegetarian'], diet_styles: ['clean'] });
  const vegan = recipe('vegan', { dietary_restrictions: ['vegan'], diet_styles: ['high_protein'] });
  assert.equal(filterEligibleRecipes([vegetarian], buildRecipeEligibilityContext({ lifestyle: { dietary_restrictions: ['vegetarian'], diet_styles: ['clean'] } })).length, 1);
  assert.equal(filterEligibleRecipes([vegan], buildRecipeEligibilityContext({ lifestyle: { dietary_restrictions: ['vegan'], diet_styles: ['high_protein'] } })).length, 1);
});

test('allergy, vegetarian, and vegan are permanent hard rejects, not budget fallbacks', () => {
  const peanut = recipe('peanut', { allergens: ['peanut'] });
  const animal = recipe('animal', { dietary_restrictions: ['vegetarian'], recipe_ingredients: [{ recipe_id: 'animal', ingredient_name: 'x', is_optional: false, order_index: 0, food: { animal_source: ['meat'] } }] });
  assert.equal(getRecipeEligibilityDecision(peanut, buildRecipeEligibilityContext({ health: { allergies: ['peanut'] }, lifestyle: { budget_level: 'low' } })).eligible, false);
  assert.equal(getRecipeEligibilityDecision(animal, buildRecipeEligibilityContext({ lifestyle: { dietary_restrictions: ['vegan'], budget_level: 'low' } })).eligible, false);
});

test('AI recipe proposal rejects fake and inactive IDs as one proposal', () => {
  const active = recipe('active');
  const inactive = recipe('inactive', { is_active: false });
  const result = validateRecipeMealProposal([{ meal_type: 'lunch', recipe_id: 'fake', servings: 1 }], [active, inactive], buildRecipeEligibilityContext(), ['lunch']);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('fake')));
  assert.equal(getRecipeEligibilityDecision(inactive, buildRecipeEligibilityContext()).eligible, false);
});

test('recent recipes rank below equally safe alternatives without becoming invalid', () => {
  const repeated = recipe('repeated');
  const fresh = recipe('fresh');
  const ranked = filterEligibleRecipes([repeated, fresh], buildRecipeEligibilityContext({}, { recentRecipeIds: new Set(['repeated']) }));
  assert.deepEqual(ranked.map((item) => item.normalized.id), ['fresh', 'repeated']);
  assert.equal(ranked.length, 2);
});
