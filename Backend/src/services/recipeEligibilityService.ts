import {
  deriveRecipeAllergens,
  normalizeRecipe,
  validateRecipe,
  validateRecipeDietarySemantics,
  type Recipe,
  type RecipeIngredientWithFood,
} from '../../../shared/recipeCatalog';
import {
  normalizeAllergies,
  normalizeBudgetLevel,
  normalizeDietaryRestrictions,
  normalizeDietStyles,
  normalizeMealTypes,
  type Allergen,
  type BudgetLevel,
  type DietStyle,
  type MealType,
} from '../../../shared/dietaryPreferences';
import { normalizeGoalType, type GoalType } from '../../../shared/exerciseCatalog';
import type { PersonalizationContext } from './ai/personalizationGuardService';

export type RecipeCandidate = Partial<Recipe> & Record<string, unknown> & {
  id?: string | null;
  recipe_ingredients?: RecipeIngredientWithFood[] | null;
};

/** Context deliberately separates non-negotiable safety from ranking preferences. */
export type RecipeEligibilityContext = {
  dietaryRestrictions: Set<string>;
  dietStyles: Set<string>;
  allergies: Set<string>;
  budgetLevel?: BudgetLevel;
  cookingAbility?: string;
  targetCalories?: number;
  mealsPerDay?: number;
  fitnessGoal?: GoalType;
  excludedRecipeIds?: Set<string>;
  recentRecipeIds?: Set<string>;
  /** Canonical allergens inferred from a medically explicit condition only. */
  medicalSafetyAllergens?: Set<string>;
};

export type RecipeEligibilityDecision = { eligible: boolean; reasons: string[] };
export type EligibleRecipe = {
  recipe: RecipeCandidate;
  normalized: ReturnType<typeof normalizeRecipe>;
  ingredients: RecipeIngredientWithFood[];
  allergens: Allergen[];
  score: number;
};

export type RecipeMealProposal = {
  meal_type: string;
  recipe_id: string;
  servings: number;
  notes?: string;
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const unique = <T>(values: T[]) => Array.from(new Set(values));
const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();

const recipeIngredients = (recipe: RecipeCandidate): RecipeIngredientWithFood[] => {
  const raw = recipe.recipe_ingredients ?? recipe.ingredients;
  return Array.isArray(raw) ? raw as RecipeIngredientWithFood[] : [];
};

const medicalAllergens = (context: PersonalizationContext): string[] => {
  const health = context.health || {};
  const condition = normalizeText(health.health_condition);
  return [
    ...(condition.includes('celiac') ? ['wheat'] : []),
    ...(condition.includes('lactose intoler') ? ['milk'] : []),
  ];
};

export const buildRecipeEligibilityContext = (
  context: PersonalizationContext = {},
  options: Partial<RecipeEligibilityContext> = {},
): RecipeEligibilityContext => {
  const lifestyle = context.lifestyle || {};
  const health = context.health || {};
  const explicitMedicalAllergens = medicalAllergens(context);
  return {
    dietaryRestrictions: new Set(normalizeDietaryRestrictions(
      lifestyle.dietary_restrictions, lifestyle.diet_preference, lifestyle.current_diet,
    )),
    dietStyles: new Set(normalizeDietStyles(
      lifestyle.diet_styles, lifestyle.diet_preference, lifestyle.current_diet,
    )),
    allergies: new Set(normalizeAllergies(health.allergies, health.medical_history, explicitMedicalAllergens)),
    budgetLevel: normalizeBudgetLevel(lifestyle.budget_level) || undefined,
    cookingAbility: String(lifestyle.cooking_ability || '').trim() || undefined,
    targetCalories: numeric(lifestyle.target_calories) || undefined,
    mealsPerDay: numeric(lifestyle.meals_per_day) || undefined,
    fitnessGoal: normalizeGoalType(lifestyle.fitness_goal) || undefined,
    excludedRecipeIds: new Set((options.excludedRecipeIds || new Set()).values()),
    recentRecipeIds: new Set((options.recentRecipeIds || new Set()).values()),
    medicalSafetyAllergens: new Set(explicitMedicalAllergens),
    ...options,
  };
};

/**
 * Hard gate. It never looks at budget, cooking time, style, or repetition.
 * Animal-source checks are metadata-first; a missing metadata field produces a
 * warning at catalogue validation, not a guessed name-based rejection.
 */
export const getRecipeEligibilityDecision = (
  candidate: RecipeCandidate | null | undefined,
  context: RecipeEligibilityContext,
  mealType?: unknown,
): RecipeEligibilityDecision => {
  if (!candidate) return { eligible: false, reasons: ['missing_recipe'] };
  const normalized = normalizeRecipe(candidate);
  const ingredients = recipeIngredients(candidate);
  const reasons: string[] = [];
  if (!normalized.id) reasons.push('invalid_recipe_id');
  if (normalized.is_active !== true) reasons.push('inactive_recipe');
  if (context.excludedRecipeIds?.has(normalized.id)) reasons.push('explicit_user_exclusion');
  const validation = validateRecipe(candidate, ingredients);
  if (!validation.valid) reasons.push(...validation.errors.map((error) => `invalid_recipe_${error}`));
  const requestedMealTypes = normalizeMealTypes(mealType);
  if (requestedMealTypes.length && !normalized.meal_type?.some((type) => requestedMealTypes.includes(type))) {
    reasons.push('meal_type_conflict');
  }
  const recipeAllergens = deriveRecipeAllergens(ingredients, normalized.allergens);
  if (recipeAllergens.some((allergen) => context.allergies.has(allergen) || context.medicalSafetyAllergens?.has(allergen))) {
    reasons.push('allergen_conflict');
  }
  const requestedRestrictions = Array.from(context.dietaryRestrictions);
  if (requestedRestrictions.length) {
    const semantic = validateRecipeDietarySemantics({ dietary_restrictions: requestedRestrictions as any }, ingredients);
    reasons.push(...semantic.errors);
    // A recipe's declared dietary tags are not evidence against ingredient metadata,
    // but they are required when a caller asks for that restriction.
    if (context.dietaryRestrictions.has('vegan') && !normalized.dietary_restrictions?.includes('vegan')) reasons.push('vegan_tag_missing');
    else if (context.dietaryRestrictions.has('vegetarian') && !normalized.dietary_restrictions?.some((value) => value === 'vegetarian' || value === 'vegan')) reasons.push('vegetarian_tag_missing');
  }
  return { eligible: reasons.length === 0, reasons: unique(reasons) };
};

const cookingAbilityScore = (difficulty: string | undefined, ability: string | undefined) => {
  const current = normalizeText(ability);
  if (!current || !difficulty) return 0;
  if (difficulty === 'easy') return 4;
  if (difficulty === 'medium') return /advanced|nang cao|expert/.test(current) ? 4 : 1;
  return /advanced|nang cao|expert/.test(current) ? 4 : -8;
};

const budgetScore = (price: BudgetLevel | undefined, budget: BudgetLevel | undefined) => {
  if (!price || !budget) return 0;
  if (budget === 'high') return 3;
  if (budget === 'medium') return price === 'high' ? -6 : 8;
  return price === 'low' ? 18 : price === 'medium' ? -4 : -18;
};

export const scoreEligibleRecipe = (
  recipe: RecipeCandidate,
  context: RecipeEligibilityContext,
  mealType?: MealType,
): number => {
  const normalized = normalizeRecipe(recipe);
  let score = 0;
  const styles = new Set(normalized.diet_styles || []);
  context.dietStyles.forEach((style) => { score += styles.has(style as DietStyle) ? 14 : 0; });
  if (context.fitnessGoal && normalized.goal_type?.includes(context.fitnessGoal)) score += 12;
  if (mealType && normalized.meal_type?.includes(mealType)) score += 10;
  score += budgetScore(normalized.price_level, context.budgetLevel);
  score += cookingAbilityScore(normalized.cooking_difficulty, context.cookingAbility);
  const target = numeric(context.targetCalories);
  if (target && numeric(normalized.calories)) {
    const meals = Math.max(2, Math.min(5, numeric(context.mealsPerDay) || 3));
    score += Math.max(-18, 16 - Math.abs(numeric(normalized.calories) - target / meals) / 18);
  }
  if (context.dietStyles.has('high_protein')) score += Math.min(14, numeric(normalized.protein) / 3);
  if (context.dietStyles.has('low_carb')) score += Math.max(-14, 12 - numeric(normalized.carbs) / 4);
  if (context.recentRecipeIds?.has(normalized.id)) score -= 35;
  return score;
};

export const filterEligibleRecipes = (
  source: RecipeCandidate[] | null | undefined,
  context: RecipeEligibilityContext,
  mealType?: MealType,
): EligibleRecipe[] => (source || []).flatMap((recipe) => {
  const decision = getRecipeEligibilityDecision(recipe, context, mealType);
  if (!decision.eligible) return [];
  const normalized = normalizeRecipe(recipe);
  return [{
    recipe,
    normalized,
    ingredients: recipeIngredients(recipe),
    allergens: deriveRecipeAllergens(recipeIngredients(recipe), normalized.allergens),
    score: scoreEligibleRecipe(recipe, context, mealType),
  }];
}).sort((left, right) => right.score - left.score);

export const buildCompactRecipeCatalog = (recipes: EligibleRecipe[], maxItems = 72) => recipes.slice(0, maxItems).map(({ normalized }) => ({
  id: normalized.id,
  name: normalized.name,
  meal_type: normalized.meal_type || [],
  dietary_restrictions: normalized.dietary_restrictions || [],
  diet_styles: normalized.diet_styles || [],
  calories: numeric(normalized.calories),
  protein: numeric(normalized.protein),
  carbs: numeric(normalized.carbs),
  fat: numeric(normalized.fat),
  price_level: normalized.price_level || 'medium',
  cooking_time_minutes: numeric(normalized.cooking_time_minutes),
}));

export const normalizeRecipeMealProposal = (value: unknown): RecipeMealProposal | null => {
  const raw = asRecord(value);
  const recipeId = String(raw.recipe_id || '').trim();
  const mealType = String(raw.meal_type || '').trim().toLowerCase();
  if (!recipeId || !normalizeMealTypes(mealType).length) return null;
  return {
    recipe_id: recipeId,
    meal_type: mealType,
    servings: Math.max(0.25, Math.min(6, numeric(raw.servings) || 1)),
    notes: String(raw.notes || '').trim().slice(0, 300) || undefined,
  };
};

/** Revalidates all model-selected IDs against the already hard-filtered set. */
export const validateRecipeMealProposal = (
  meals: unknown,
  catalog: RecipeCandidate[],
  context: RecipeEligibilityContext,
  expectedMealTypes: MealType[],
  targetCalories?: number,
): { valid: boolean; errors: string[]; meals: RecipeMealProposal[] } => {
  const rows = Array.isArray(meals) ? meals : [];
  const recipeById = new Map(catalog.map((recipe) => [String(recipe.id || ''), recipe]));
  const normalized = rows.map(normalizeRecipeMealProposal).filter((item): item is RecipeMealProposal => Boolean(item));
  const errors: string[] = [];
  if (normalized.length !== rows.length) errors.push('invalid_recipe_meal_shape');
  if (normalized.length !== expectedMealTypes.length) errors.push('invalid_meal_count');
  const proposedTypes = normalized.map((item) => item.meal_type as MealType);
  if (expectedMealTypes.some((type) => !proposedTypes.includes(type)) || new Set(proposedTypes).size !== proposedTypes.length) errors.push('invalid_daily_structure');
  let calories = 0;
  normalized.forEach((item) => {
    const recipe = recipeById.get(item.recipe_id);
    const decision = getRecipeEligibilityDecision(recipe, context, item.meal_type);
    if (!recipe || !decision.eligible) errors.push(`ineligible_recipe_${item.recipe_id}`);
    else calories += numeric(recipe.calories) * item.servings;
  });
  if (targetCalories && calories && (calories < targetCalories * 0.4 || calories > targetCalories * 1.7)) errors.push('daily_calorie_target_out_of_range');
  return { valid: errors.length === 0, errors: unique(errors), meals: normalized };
};
