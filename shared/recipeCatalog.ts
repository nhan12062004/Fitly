/** One shared recipe contract for the database, Admin, backend, and future AI flows. */
import {
  type Allergen,
  type BudgetLevel,
  type CookingDifficulty,
  type DietaryRestriction,
  type DietStyle,
  type MealType,
  isAllergen,
  isBudgetLevel,
  isCookingDifficulty,
  isDietStyle,
  isDietaryRestriction,
  isMealType,
  normalizeAllergies,
  normalizeBudgetLevel,
  normalizeCanonicalAllergens,
  normalizeCookingDifficulty,
  normalizeDietaryRestrictions,
  normalizeDietStyles,
  normalizeMealTypes,
  normalizeTaxonomyValues,
} from './dietaryPreferences';
import { type GoalType, normalizeGoalType } from './exerciseCatalog';

export {
  ALLERGENS,
  ALLERGEN_LABELS_VI,
  BUDGET_LEVELS,
  BUDGET_LEVEL_LABELS_VI,
  COOKING_DIFFICULTIES,
  COOKING_DIFFICULTY_LABELS_VI,
  DIETARY_RESTRICTIONS,
  DIETARY_RESTRICTION_LABELS_VI,
  DIET_STYLES,
  DIET_STYLE_LABELS_VI,
  MEAL_TYPES,
  MEAL_TYPE_LABELS_VI,
} from './dietaryPreferences';
export type { Allergen, BudgetLevel, CookingDifficulty, DietaryRestriction, DietStyle, MealType } from './dietaryPreferences';
export { GOAL_TYPES } from './exerciseCatalog';
export type { GoalType } from './exerciseCatalog';

export type RecipeInstructions = {
  preparation: string[];
  steps: string[];
  tips: string[];
};

export type Recipe = {
  id: string;
  name: string;
  name_en?: string | null;
  description?: string | null;
  meal_type: MealType[];
  dietary_restrictions: DietaryRestriction[];
  diet_styles: DietStyle[];
  goal_type: GoalType[];
  price_level: BudgetLevel;
  estimated_cost_min_vnd?: number | null;
  estimated_cost_max_vnd?: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size?: number | null;
  serving_unit?: string | null;
  cooking_time_minutes: number;
  cooking_difficulty: CookingDifficulty;
  allergens: Allergen[];
  instructions: RecipeInstructions;
  image_url?: string | null;
  region?: string | null;
  is_active: boolean;
};

export type RecipeDraft = Omit<Partial<Recipe>, 'id' | 'calories' | 'protein' | 'carbs' | 'fat' | 'cooking_time_minutes'> & {
  id: string;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  cooking_time_minutes?: number | null;
};
/** @deprecated Use the shared taxonomy types directly. */
export type RecipeMealType = MealType;
/** @deprecated Use BudgetLevel. */
export type RecipePriceLevel = BudgetLevel;
/** @deprecated Use CookingDifficulty. */
export type RecipeCookingDifficulty = CookingDifficulty;

export type RecipeIngredient = {
  id?: number;
  recipe_id: string;
  food_id?: string | null;
  ingredient_name: string;
  amount?: number | null;
  unit?: string | null;
  preparation_note?: string | null;
  is_optional: boolean;
  order_index: number;
};

/** Metadata available from public.foods. Do not infer animal source from an ingredient's display name. */
export type RecipeFoodMetadata = {
  id?: string | null;
  category?: string | null;
  allergens?: unknown;
  dietary_tags?: unknown;
  ingredient_metadata?: unknown;
  animal_source?: unknown;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  serving_unit?: string | null;
  estimated_cost_min_vnd?: number | null;
  estimated_cost_max_vnd?: number | null;
};

export type RecipeIngredientWithFood = RecipeIngredient & { food?: RecipeFoodMetadata | null };
export type RecipeNutrition = { calories: number; protein: number; carbs: number; fat: number };
export type RecipeCostRange = { estimated_cost_min_vnd: number; estimated_cost_max_vnd: number };
export type RecipeValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  recipe: RecipeDraft;
};

const unique = <T extends string>(values: T[]) => Array.from(new Set(values));
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const nullableText = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text || null;
};
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const booleanOrDefault = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback;
const instructionList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\r\n]+/).map((item) => item.trim()).filter(Boolean);
  return [];
};

/** Converts legacy string/array/partial-object instructions into the persisted object shape. */
export const normalizeRecipeInstructions = (value: unknown): RecipeInstructions => {
  if (typeof value === 'string' || Array.isArray(value)) return { preparation: [], steps: instructionList(value), tips: [] };
  const source = asRecord(value);
  return {
    preparation: instructionList(source.preparation),
    steps: instructionList(source.steps),
    tips: instructionList(source.tips),
  };
};

export const normalizeGoalTypes = (...values: unknown[]): GoalType[] => unique(
  values.flatMap(normalizeTaxonomyValues).map(normalizeGoalType).filter((value): value is GoalType => value !== null),
);

export const normalizeRecipe = (value: unknown): RecipeDraft => {
  const source = asRecord(value);
  const id = String(source.id ?? '').trim();
  const goalTypeSource = source.goal_type ?? source.goal_types;
  const price = normalizeBudgetLevel(source.price_level);
  const difficulty = normalizeCookingDifficulty(source.cooking_difficulty);
  return {
    id,
    name: String(source.name ?? '').trim(),
    name_en: nullableText(source.name_en),
    description: nullableText(source.description),
    meal_type: normalizeMealTypes(source.meal_type),
    dietary_restrictions: normalizeDietaryRestrictions(source.dietary_restrictions, source.diet_preference, source.current_diet),
    diet_styles: normalizeDietStyles(source.diet_styles, source.diet_preference, source.current_diet),
    goal_type: normalizeGoalTypes(goalTypeSource),
    price_level: price || undefined,
    estimated_cost_min_vnd: numberOrNull(source.estimated_cost_min_vnd),
    estimated_cost_max_vnd: numberOrNull(source.estimated_cost_max_vnd),
    calories: numberOrNull(source.calories),
    protein: numberOrNull(source.protein),
    carbs: numberOrNull(source.carbs),
    fat: numberOrNull(source.fat),
    serving_size: numberOrNull(source.serving_size),
    serving_unit: nullableText(source.serving_unit),
    cooking_time_minutes: numberOrNull(source.cooking_time_minutes),
    cooking_difficulty: difficulty || undefined,
    allergens: normalizeCanonicalAllergens(source.allergens),
    instructions: normalizeRecipeInstructions(source.instructions),
    image_url: nullableText(source.image_url),
    region: nullableText(source.region),
    is_active: booleanOrDefault(source.is_active),
  };
};

export const normalizeRecipeIngredient = (value: unknown): Partial<RecipeIngredient> => {
  const source = asRecord(value);
  return {
    id: numberOrNull(source.id) ?? undefined,
    recipe_id: String(source.recipe_id ?? '').trim(),
    food_id: nullableText(source.food_id),
    ingredient_name: String(source.ingredient_name ?? '').trim(),
    amount: numberOrNull(source.amount),
    unit: nullableText(source.unit),
    preparation_note: nullableText(source.preparation_note),
    is_optional: booleanOrDefault(source.is_optional),
    order_index: Math.max(0, Math.floor(numberOrNull(source.order_index) ?? 0)),
  };
};

export const validateRecipeIngredient = (value: unknown): string[] => {
  const ingredient = normalizeRecipeIngredient(value);
  const errors: string[] = [];
  if (!ingredient.recipe_id) errors.push('missing_recipe_id');
  if (!ingredient.ingredient_name) errors.push('missing_ingredient_name');
  if (ingredient.amount !== null && ingredient.amount !== undefined && ingredient.amount < 0) errors.push('invalid_ingredient_amount');
  return errors;
};

const metadataTokens = (food?: RecipeFoodMetadata | null): string[] => normalizeTaxonomyValues([
  food?.category,
  food?.dietary_tags,
  food?.ingredient_metadata,
  food?.animal_source,
]);
const hasToken = (tokens: string[], values: string[]) => values.some((value) => tokens.includes(value));

export const deriveRecipeAllergens = (
  ingredients: Array<RecipeIngredientWithFood | null | undefined>,
  manualAllergens: unknown = [],
): Allergen[] => unique([
  ...normalizeCanonicalAllergens(manualAllergens),
  ...ingredients.flatMap((ingredient) => normalizeCanonicalAllergens(ingredient?.food?.allergens)),
]);

/**
 * Metadata-first policy: a clear animal-source violation rejects the recipe.
 * Missing food metadata only warns, because names alone are not reliable evidence.
 */
export const validateRecipeDietarySemantics = (
  recipe: Pick<RecipeDraft, 'dietary_restrictions'>,
  ingredients: Array<RecipeIngredientWithFood | null | undefined>,
): Pick<RecipeValidationResult, 'errors' | 'warnings'> => {
  const restrictions = recipe.dietary_restrictions || [];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (restrictions.length === 0) return { errors, warnings };
  const strictVegan = restrictions.includes('vegan');
  const vegetarian = strictVegan || restrictions.includes('vegetarian');
  ingredients.forEach((ingredient, index) => {
    if (!ingredient || ingredient.is_optional) return;
    if (!ingredient.food) {
      warnings.push(`ingredient_${index}_metadata_unavailable`);
      return;
    }
    const tokens = metadataTokens(ingredient.food);
    const animal = hasToken(tokens, ['meat', 'poultry', 'fish', 'shellfish', 'animal']);
    const veganConflict = animal || hasToken(tokens, ['egg', 'milk', 'dairy', 'honey', 'non vegan']);
    if (strictVegan && veganConflict) errors.push(`ingredient_${index}_vegan_conflict`);
    else if (vegetarian && animal) errors.push(`ingredient_${index}_vegetarian_conflict`);
  });
  return { errors, warnings };
};

const unitKey = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const ingredientMultiplier = (ingredient: RecipeIngredientWithFood): number | null => {
  const amount = numberOrNull(ingredient.amount);
  const foodUnit = unitKey(ingredient.food?.serving_unit);
  const ingredientUnit = unitKey(ingredient.unit);
  if (amount === null || !ingredient.food) return null;
  if ((ingredientUnit === 'g' || ingredientUnit === 'gram' || ingredientUnit === 'grams') && (foodUnit === '100g' || foodUnit === '100 g')) return amount / 100;
  if (ingredientUnit && ingredientUnit === foodUnit) return amount;
  return null;
};

export const aggregateRecipeNutrition = (ingredients: RecipeIngredientWithFood[]): { nutrition: RecipeNutrition | null; incomplete: boolean } => {
  if (ingredients.filter((ingredient) => !ingredient.is_optional).length === 0) return { nutrition: null, incomplete: true };
  let incomplete = false;
  const nutrition: RecipeNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ingredient of ingredients) {
    if (ingredient.is_optional) continue;
    const multiplier = ingredientMultiplier(ingredient);
    const food = ingredient.food;
    if (multiplier === null || !food || [food.calories, food.protein, food.carbs, food.fat].some((value) => numberOrNull(value) === null)) {
      incomplete = true;
      continue;
    }
    nutrition.calories += Number(food.calories) * multiplier;
    nutrition.protein += Number(food.protein) * multiplier;
    nutrition.carbs += Number(food.carbs) * multiplier;
    nutrition.fat += Number(food.fat) * multiplier;
  }
  return { nutrition: incomplete ? null : nutrition, incomplete };
};

export const aggregateRecipeCost = (ingredients: RecipeIngredientWithFood[]): { cost: RecipeCostRange | null; incomplete: boolean } => {
  if (ingredients.filter((ingredient) => !ingredient.is_optional).length === 0) return { cost: null, incomplete: true };
  let incomplete = false;
  const cost: RecipeCostRange = { estimated_cost_min_vnd: 0, estimated_cost_max_vnd: 0 };
  for (const ingredient of ingredients) {
    if (ingredient.is_optional) continue;
    const multiplier = ingredientMultiplier(ingredient);
    const food = ingredient.food;
    const min = numberOrNull(food?.estimated_cost_min_vnd);
    const max = numberOrNull(food?.estimated_cost_max_vnd);
    if (multiplier === null || min === null || max === null) { incomplete = true; continue; }
    cost.estimated_cost_min_vnd += min * multiplier;
    cost.estimated_cost_max_vnd += max * multiplier;
  }
  return { cost: incomplete ? null : cost, incomplete };
};

export const validateRecipe = (
  source: unknown,
  ingredients: Array<RecipeIngredientWithFood | null | undefined> = [],
): RecipeValidationResult => {
  const recipe = normalizeRecipe(source);
  const errors: string[] = [];
  const warnings: string[] = [];
  const isActive = recipe.is_active === true;
  if (!recipe.id) errors.push('missing_recipe_id');
  if (!recipe.name) errors.push('missing_recipe_name');
  if (recipe.price_level !== undefined && !isBudgetLevel(recipe.price_level)) errors.push('invalid_price_level');
  if (recipe.cooking_difficulty !== undefined && !isCookingDifficulty(recipe.cooking_difficulty)) errors.push('invalid_cooking_difficulty');
  if ((recipe.meal_type || []).some((value) => !isMealType(value))) errors.push('invalid_meal_type');
  if ((recipe.dietary_restrictions || []).some((value) => !isDietaryRestriction(value))) errors.push('invalid_dietary_restriction');
  if ((recipe.diet_styles || []).some((value) => !isDietStyle(value))) errors.push('invalid_diet_style');
  if ((recipe.allergens || []).some((value) => !isAllergen(value))) errors.push('invalid_allergen');
  if (recipe.estimated_cost_min_vnd !== null && recipe.estimated_cost_min_vnd !== undefined && recipe.estimated_cost_min_vnd < 0) errors.push('invalid_cost_min');
  if (recipe.estimated_cost_max_vnd !== null && recipe.estimated_cost_max_vnd !== undefined && recipe.estimated_cost_max_vnd < 0) errors.push('invalid_cost_max');
  if (recipe.estimated_cost_min_vnd !== null && recipe.estimated_cost_min_vnd !== undefined && recipe.estimated_cost_max_vnd !== null && recipe.estimated_cost_max_vnd !== undefined && recipe.estimated_cost_max_vnd < recipe.estimated_cost_min_vnd) errors.push('invalid_cost_range');
  ingredients.forEach((ingredient, index) => validateRecipeIngredient(ingredient).forEach((error) => errors.push(`ingredient_${index}_${error}`)));
  const semantic = validateRecipeDietarySemantics(recipe, ingredients);
  errors.push(...semantic.errors);
  warnings.push(...semantic.warnings);
  const unknownAllergens = normalizeAllergies(asRecord(source).allergens).filter((value) => !isAllergen(value));
  unknownAllergens.forEach((value) => warnings.push(`unknown_allergen_${value}`));

  if (isActive) {
    if (!recipe.meal_type?.length) errors.push('missing_meal_type');
    if (!recipe.price_level) errors.push('missing_price_level');
    if (!recipe.cooking_difficulty) errors.push('missing_cooking_difficulty');
    if (recipe.cooking_time_minutes === null || recipe.cooking_time_minutes === undefined || recipe.cooking_time_minutes < 0) errors.push('invalid_cooking_time');
    for (const field of ['calories', 'protein', 'carbs', 'fat'] as const) {
      const value = recipe[field];
      if (value === null || value === undefined || value < 0) errors.push(`invalid_${field}`);
    }
    if (!recipe.instructions || recipe.instructions.steps.length === 0) errors.push('missing_recipe_steps');
    if (ingredients.length === 0) errors.push('missing_recipe_ingredient');
  }
  return { valid: errors.length === 0, errors: unique(errors), warnings: unique(warnings), recipe };
};

/** Phase 2 compatibility wrapper for callers that only need activation errors. */
export const validateRecipeForActivation = (recipe: Partial<Recipe>, ingredients: RecipeIngredientWithFood[] = []): string[] =>
  validateRecipe({ ...recipe, is_active: true }, ingredients).errors;
