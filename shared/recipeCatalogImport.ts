import {
  deriveRecipeAllergens,
  normalizeRecipe,
  normalizeRecipeIngredient,
  validateRecipe,
  type RecipeFoodMetadata,
  type RecipeIngredientWithFood,
} from './recipeCatalog';
import { normalizeAllergies } from './dietaryPreferences';
import { ALLERGENS, BUDGET_LEVELS, COOKING_DIFFICULTIES, DIETARY_RESTRICTIONS, DIET_STYLES, MEAL_TYPES } from './dietaryPreferences';
import { GOAL_TYPES } from './exerciseCatalog';

export type RecipeCatalogItem = {
  id: string; name: string; name_en?: string; description?: string;
  meal_type: string[]; dietary_restrictions: string[]; diet_styles: string[]; goal_type: string[];
  price_level: 'low' | 'medium' | 'high'; estimated_cost_min_vnd?: number; estimated_cost_max_vnd?: number;
  calories: number; protein: number; carbs: number; fat: number; serving_size?: number; serving_unit?: string;
  cooking_time_minutes: number; cooking_difficulty: 'easy' | 'medium' | 'hard'; allergens: string[];
  instructions: { preparation: string[]; steps: string[]; tips: string[] };
  ingredients: Array<{ food_id?: string; ingredient_name: string; amount?: number; unit?: string; preparation_note?: string; is_optional?: boolean }>;
  image_url?: string; region?: string; is_active?: boolean;
};

export type RecipeCatalogIssue = { path: string; message: string; severity: 'error' | 'warning' };
export type RecipeCatalogSummary = { total: number; mealTypes: Record<string, number>; dietaryRestrictions: Record<string, number>; dietStyles: Record<string, number>; budgets: Record<string, number>; cookingDifficulties: Record<string, number>; averageIngredientCount: number; withoutLinkedFoodIds: number; warnings: RecipeCatalogIssue[]; errors: RecipeCatalogIssue[] };
export type RecipeCatalogValidation = { valid: boolean; items: RecipeCatalogItem[]; summary: RecipeCatalogSummary };

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (target: Record<string, number>, values: string[] | undefined) => (values || []).forEach((value) => { target[value] = (target[value] || 0) + 1; });
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const textKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const isUrl = (value: unknown) => { try { const url = new URL(String(value)); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; } };

export const validateRecipeCatalog = (
  source: unknown,
  options: { expectedCount?: number; foodMetadataById?: Map<string, RecipeFoodMetadata>; requirePreparation?: boolean } = {},
): RecipeCatalogValidation => {
  const issues: RecipeCatalogIssue[] = [];
  const rawItems = Array.isArray(source) ? source : null;
  if (!rawItems) issues.push({ path: '$', message: 'Catalog must be a JSON array.', severity: 'error' });
  const items: RecipeCatalogItem[] = [];
  const ids = new Set<string>(); const names = new Set<string>();
  const mealTypes: Record<string, number> = {}; const dietaryRestrictions: Record<string, number> = {}; const dietStyles: Record<string, number> = {}; const budgets: Record<string, number> = {}; const cookingDifficulties: Record<string, number> = {};
  let ingredientsTotal = 0; let withoutLinkedFoodIds = 0;
  (rawItems || []).forEach((raw, index) => {
    const entry = asRecord(raw);
    const normalized = normalizeRecipe({ ...entry, is_active: entry.is_active !== false });
    const rawIngredients = Array.isArray(entry.ingredients) ? entry.ingredients : [];
    const ingredients = rawIngredients.map((ingredient, order_index) => {
      const value = normalizeRecipeIngredient({ ...asRecord(ingredient), recipe_id: normalized.id, order_index });
      const foodId = value.food_id || null;
      return { ...value, recipe_id: normalized.id, food: foodId ? options.foodMetadataById?.get(foodId) || null : null } as RecipeIngredientWithFood;
    });
    const prefix = `recipes[${index}]`;
    const taxonomyChecks: Array<[string, unknown, readonly string[]]> = [
      ['meal_type', entry.meal_type, MEAL_TYPES], ['dietary_restrictions', entry.dietary_restrictions, DIETARY_RESTRICTIONS], ['diet_styles', entry.diet_styles, DIET_STYLES], ['goal_type', entry.goal_type, GOAL_TYPES], ['allergens', entry.allergens, ALLERGENS],
    ];
    taxonomyChecks.forEach(([field, value, allowed]) => {
      const rawValues = Array.isArray(value) ? value.map(String) : [];
      rawValues.filter((item) => !allowed.includes(item)).forEach((item) => issues.push({ path: `${prefix}.${field}`, message: `invalid_${field}: ${item}`, severity: 'error' }));
    });
    if (!BUDGET_LEVELS.includes(String(entry.price_level) as any)) issues.push({ path: `${prefix}.price_level`, message: `invalid_price_level: ${String(entry.price_level)}`, severity: 'error' });
    if (!COOKING_DIFFICULTIES.includes(String(entry.cooking_difficulty) as any)) issues.push({ path: `${prefix}.cooking_difficulty`, message: `invalid_cooking_difficulty: ${String(entry.cooking_difficulty)}`, severity: 'error' });
    if (!kebab.test(normalized.id)) issues.push({ path: `${prefix}.id`, message: 'id must be lowercase kebab-case.', severity: 'error' });
    if (ids.has(normalized.id)) issues.push({ path: `${prefix}.id`, message: `duplicate id: ${normalized.id}`, severity: 'error' });
    ids.add(normalized.id);
    const name = textKey(normalized.name);
    if (name && names.has(name)) issues.push({ path: `${prefix}.name`, message: `duplicate name: ${normalized.name}`, severity: 'error' });
    if (name) names.add(name);
    const validation = validateRecipe({ ...entry, is_active: entry.is_active !== false }, ingredients);
    validation.errors.forEach((message) => issues.push({ path: prefix, message, severity: 'error' }));
    validation.warnings.forEach((message) => issues.push({ path: prefix, message, severity: 'warning' }));
    if (!normalized.meal_type?.length) issues.push({ path: `${prefix}.meal_type`, message: 'at least one meal type is required.', severity: 'error' });
    if ((normalized.instructions?.steps || []).length < 2) issues.push({ path: `${prefix}.instructions.steps`, message: 'at least two instruction steps are required for catalog imports.', severity: 'error' });
    if (options.requirePreparation && !(normalized.instructions?.preparation || []).length) issues.push({ path: `${prefix}.instructions.preparation`, message: 'at least one preparation item is required by this policy.', severity: 'error' });
    if (entry.image_url && !isUrl(entry.image_url)) issues.push({ path: `${prefix}.image_url`, message: 'image_url must be an http(s) URL.', severity: 'error' });
    const ingredientKeys = new Set<string>();
    ingredients.forEach((ingredient, ingredientIndex) => {
      const ingredientKey = `${ingredient.food_id || textKey(ingredient.ingredient_name)}|${ingredient.amount ?? ''}|${textKey(ingredient.unit)}`;
      if (ingredientKeys.has(ingredientKey)) issues.push({ path: `${prefix}.ingredients[${ingredientIndex}]`, message: 'duplicate ingredient row.', severity: 'error' });
      ingredientKeys.add(ingredientKey);
      if (!ingredient.food_id) withoutLinkedFoodIds += 1;
      if (ingredient.food_id && options.foodMetadataById && !ingredient.food) issues.push({ path: `${prefix}.ingredients[${ingredientIndex}].food_id`, message: `unknown food_id: ${ingredient.food_id}`, severity: 'error' });
    });
    const derivedAllergens = deriveRecipeAllergens(ingredients, normalized.allergens);
    const manualAllergens = normalizeAllergies(normalized.allergens);
    const undeclared = derivedAllergens.filter((allergen) => !manualAllergens.includes(allergen));
    if (undeclared.length) issues.push({ path: `${prefix}.allergens`, message: `ingredient allergens not declared manually: ${undeclared.join(', ')}`, severity: 'warning' });
    ingredientsTotal += ingredients.length;
    count(mealTypes, normalized.meal_type); count(dietaryRestrictions, normalized.dietary_restrictions); count(dietStyles, normalized.diet_styles); count(budgets, normalized.price_level ? [normalized.price_level] : []); count(cookingDifficulties, normalized.cooking_difficulty ? [normalized.cooking_difficulty] : []);
    items.push({ ...entry, ...normalized, is_active: entry.is_active !== false, meal_type: normalized.meal_type || [], dietary_restrictions: normalized.dietary_restrictions || [], diet_styles: normalized.diet_styles || [], goal_type: normalized.goal_type || [], price_level: normalized.price_level || 'medium', calories: Number(normalized.calories || 0), protein: Number(normalized.protein || 0), carbs: Number(normalized.carbs || 0), fat: Number(normalized.fat || 0), cooking_time_minutes: Number(normalized.cooking_time_minutes || 0), cooking_difficulty: normalized.cooking_difficulty || 'easy', allergens: normalized.allergens || [], instructions: normalized.instructions!, ingredients: ingredients.map(({ food, recipe_id, order_index, ...ingredient }) => ingredient) } as RecipeCatalogItem);
  });
  if (options.expectedCount !== undefined && (rawItems || []).length !== options.expectedCount) issues.push({ path: '$', message: `expected ${options.expectedCount} recipe(s), received ${(rawItems || []).length}.`, severity: 'error' });
  const warnings = issues.filter((issue) => issue.severity === 'warning'); const errors = issues.filter((issue) => issue.severity === 'error');
  return { valid: errors.length === 0, items, summary: { total: items.length, mealTypes, dietaryRestrictions, dietStyles, budgets, cookingDifficulties, averageIngredientCount: items.length ? ingredientsTotal / items.length : 0, withoutLinkedFoodIds, warnings, errors } };
};

export const buildRecipeUpsertPlan = (incoming: RecipeCatalogItem[], existing: Array<{ id: string; recipe_ingredients?: Array<{ food_id?: string | null; ingredient_name?: string; amount?: number | null; unit?: string | null }> }>) => {
  const existingById = new Map(existing.map((recipe) => [recipe.id, recipe]));
  const key = (ingredient: any) => `${ingredient.food_id || textKey(ingredient.ingredient_name)}|${ingredient.amount ?? ''}|${textKey(ingredient.unit)}`;
  return incoming.map((recipe) => {
    const previous = existingById.get(recipe.id);
    const previousIngredients = new Set((previous?.recipe_ingredients || []).map(key));
    const nextIngredients = new Set(recipe.ingredients.map(key));
    return { id: recipe.id, operation: previous ? 'update' as const : 'insert' as const, ingredientChanges: [...nextIngredients].filter((item) => !previousIngredients.has(item)).length + [...previousIngredients].filter((item) => !nextIngredients.has(item)).length };
  });
};
