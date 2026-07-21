import {
  filterSafeFoodsForUser,
  getFoodPreferenceScore,
  type PersonalizationContext,
} from './ai/personalizationGuardService';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealComponent = 'protein' | 'carb' | 'vegetable' | 'fruit' | 'dairy' | 'fat' | 'snack' | 'other';

export type MealPlanningFood = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  serving_unit?: string | null;
  meal_type?: string[] | string | null;
  goal_type?: string[] | string | null;
  price_level?: string | null;
  allergens?: unknown;
  dietary_tags?: unknown;
  ingredient_metadata?: unknown;
  animal_source?: unknown;
  is_active?: boolean | null;
  is_easy_to_prepare?: boolean | null;
  [key: string]: unknown;
};

export type GeneratedMealItem = {
  meal_type: MealType;
  food_id: string;
  quantity: number;
  order_index: number;
};

export type MealPlanningContext = PersonalizationContext & {
  mealsPerDay?: number | null;
  targetCalories?: number | null;
  recentMealFoodIds?: Iterable<string>;
};

export type NutritionMacroTarget = {
  grams: number;
  calories: number;
  percentage: number;
};

export type NutritionMacroTargets = {
  calorieTarget: number;
  summary: string;
  protein: NutritionMacroTarget;
  carbs: NutritionMacroTarget;
  fat: NutritionMacroTarget;
};

export type MealNutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const COMPONENT_QUOTAS: Array<{ component: MealComponent; max: number }> = [
  { component: 'protein', max: 42 },
  { component: 'carb', max: 32 },
  { component: 'vegetable', max: 32 },
  { component: 'fruit', max: 20 },
  { component: 'dairy', max: 14 },
  { component: 'snack', max: 20 },
  { component: 'fat', max: 8 },
  { component: 'other', max: 12 },
];

const normalizeText = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0111/g, 'd')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const hasAny = (text: string, keywords: string[]) => keywords.some((keyword) => {
  const token = normalizeText(keyword);
  return token && (` ${text} `).includes(` ${token} `);
});

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const asMealType = (value: unknown): MealType | null => {
  const normalized = String(value || '').trim().toLowerCase();
  return MEAL_TYPES.includes(normalized as MealType) ? normalized as MealType : null;
};

export const resolveMealsPerDay = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(2, Math.min(5, Math.round(parsed))) : 3;
};

export const getMealSlotsForCount = (value: unknown): MealType[] => {
  const mealsPerDay = resolveMealsPerDay(value);
  if (mealsPerDay <= 2) return ['breakfast', 'dinner'];
  if (mealsPerDay === 3) return ['breakfast', 'lunch', 'dinner'];
  if (mealsPerDay === 4) return ['breakfast', 'lunch', 'dinner', 'snack'];
  return ['breakfast', 'snack', 'lunch', 'snack', 'dinner'];
};

/**
 * The single nutrition-target rule shared by meal generation surfaces.
 * Values are targets, not a sum of the foods that happened to be selected.
 */
export const calculateNutritionMacroTargets = ({
  targetCalories,
  fitnessGoal,
  dietPreference,
  weightKg,
}: {
  targetCalories: unknown;
  fitnessGoal?: unknown;
  dietPreference?: unknown;
  weightKg?: unknown;
}): NutritionMacroTargets => {
  const calorieTarget = Math.max(0, Math.round(asNumber(targetCalories)));
  const goalText = normalizeText(fitnessGoal);
  const dietText = normalizeText(dietPreference);
  let profile = { protein: 0.25, carbs: 0.5, fat: 0.25 };
  let summary = 'Duy trì cân bằng';
  let proteinPerKg = 0;

  if (hasAny(goalText, ['giam mo', 'giam can', 'fat loss', 'weight loss'])) {
    profile = { protein: 0.35, carbs: 0.4, fat: 0.25 };
    summary = 'Giảm mỡ (-350 kcal/ngày)';
    proteinPerKg = 2;
  } else if (hasAny(goalText, ['tang co', 'muscle gain', 'muscle'])) {
    // At 3,082 kcal this yields the reference target: 158g P, 420g C, 86g F.
    profile = { protein: 0.205, carbs: 0.545, fat: 0.25 };
    summary = 'Tăng cơ (+250 kcal/ngày)';
    proteinPerKg = 1.8;
  } else if (hasAny(goalText, ['suc manh', 'strength'])) {
    profile = { protein: 0.25, carbs: 0.5, fat: 0.25 };
    summary = 'Sức mạnh (+150 kcal/ngày)';
    proteinPerKg = 1.8;
  } else if (hasAny(goalText, ['suc ben', 'endurance'])) {
    profile = { protein: 0.2, carbs: 0.55, fat: 0.25 };
    summary = 'Sức bền';
    proteinPerKg = 1.6;
  } else if (hasAny(goalText, ['phuc hoi', 'recovery'])) {
    profile = { protein: 0.25, carbs: 0.45, fat: 0.3 };
    summary = 'Phục hồi & tái tạo';
    proteinPerKg = 1.6;
  }

  if (hasAny(dietText, ['keto', 'low carb'])) {
    profile = { protein: 0.25, carbs: 0.1, fat: 0.65 };
    summary = `${summary} · Low Carb`;
  } else if (hasAny(dietText, ['high protein', 'nhieu dam'])) {
    profile = { protein: 0.35, carbs: 0.4, fat: 0.25 };
    summary = `${summary} · Nhiều đạm`;
    proteinPerKg = Math.max(proteinPerKg, 2);
  }

  const safeWeightKg = Math.max(0, asNumber(weightKg));
  const proteinCaloriesFromWeight = safeWeightKg > 0 && proteinPerKg > 0
    ? safeWeightKg * proteinPerKg * 4
    : 0;
  // Prevent a very high stored bodyweight from consuming the whole calorie budget.
  const proteinCalories = proteinCaloriesFromWeight > 0
    ? Math.min(calorieTarget * 0.4, proteinCaloriesFromWeight)
    : calorieTarget * profile.protein;
  const fatCalories = calorieTarget * profile.fat;
  const carbCalories = Math.max(0, calorieTarget - proteinCalories - fatCalories);
  const macroCalories = {
    protein: proteinCalories,
    carbs: carbCalories,
    fat: fatCalories,
  };

  const buildMacro = (calories: number, caloriesPerGram: number): NutritionMacroTarget => {
    return {
      calories: Math.round(calories),
      grams: Math.round(calories / caloriesPerGram),
      percentage: calorieTarget ? (calories / calorieTarget) * 100 : 0,
    };
  };

  return {
    calorieTarget,
    summary,
    protein: buildMacro(macroCalories.protein, 4),
    carbs: buildMacro(macroCalories.carbs, 4),
    fat: buildMacro(macroCalories.fat, 9),
  };
};

export const calculateMealNutritionTotals = (
  items: GeneratedMealItem[] | null | undefined,
  foods: MealPlanningFood[] | null | undefined,
): MealNutritionTotals => {
  const foodById = new Map((foods || []).map((food) => [String(food.id || ''), food]));
  return (items || []).reduce<MealNutritionTotals>((totals, item) => {
    const food = foodById.get(String(item.food_id || ''));
    const quantity = Math.max(0, asNumber(item.quantity));
    return {
      calories: totals.calories + asNumber(food?.calories) * quantity,
      protein: totals.protein + asNumber(food?.protein) * quantity,
      carbs: totals.carbs + asNumber(food?.carbs) * quantity,
      fat: totals.fat + asNumber(food?.fat) * quantity,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
};

export const classifyMealFoodComponent = (food: MealPlanningFood | null | undefined): MealComponent => {
  const text = normalizeText(`${food?.category || ''} ${food?.name || ''}`);
  const protein = asNumber(food?.protein);
  const carbs = asNumber(food?.carbs);
  const fat = asNumber(food?.fat);
  const calories = asNumber(food?.calories);

  if (hasAny(text, ['rau', 'cu', 'salad', 'vegetable', 'greens', 'broccoli', 'spinach', 'cai', 'dua leo', 'ca chua'])) return 'vegetable';
  if (hasAny(text, ['trai cay', 'fruit', 'chuoi', 'tao', 'cam', 'dau tay', 'berries'])) return 'fruit';
  if (hasAny(text, ['carb', 'com', 'gao', 'rice', 'khoai', 'bun', 'pho', 'mi', 'pasta', 'banh mi', 'yen mach', 'oat'])) return 'carb';
  if (hasAny(text, ['dam', 'protein', 'thit', 'ga', 'bo', 'ca', 'tom', 'trung', 'dau hu', 'tofu', 'tempeh', 'whey'])) return 'protein';
  if (hasAny(text, ['sua', 'yogurt', 'dairy', 'pho mai', 'cheese'])) return protein >= carbs ? 'protein' : 'dairy';
  if (hasAny(text, ['hat', 'dau olive', 'bo dau phong', 'avocado']) || fat >= 10) return 'fat';
  if (hasAny(text, ['snack', 'bua phu'])) return 'snack';
  if (protein >= 8 && protein >= carbs * 0.55) return 'protein';
  if (carbs >= 18 && carbs >= protein) return 'carb';
  if (calories <= 90 && carbs <= 14 && protein < 6) return 'vegetable';
  return 'other';
};

const getFoodMealTypes = (food: MealPlanningFood): MealType[] => {
  const values = Array.isArray(food.meal_type)
    ? food.meal_type
    : String(food.meal_type || '').split(',');
  return values.map(asMealType).filter((value): value is MealType => Boolean(value));
};

const matchesMealType = (food: MealPlanningFood, mealType: MealType) => {
  const supported = getFoodMealTypes(food);
  return supported.length === 0 || supported.includes(mealType);
};

/** Guards a one-item replacement before it is written to an existing meal plan. */
export const isMealFoodEligible = (
  food: MealPlanningFood | null | undefined,
  mealType: unknown,
  context: PersonalizationContext = {},
): boolean => {
  const slot = asMealType(mealType);
  if (!food?.id || !slot || !matchesMealType(food, slot)) return false;
  return filterSafeFoodsForUser([food], context).length === 1;
};

const getFamilyKey = (food: MealPlanningFood | null | undefined) => {
  const name = normalizeText(food?.name);
  return name.startsWith('banh ') ? 'banh' : '';
};

const getRequiredComponents = (mealType: MealType): MealComponent[] => {
  if (mealType === 'breakfast') return ['carb', 'protein'];
  if (mealType === 'lunch' || mealType === 'dinner') return ['carb', 'protein', 'vegetable'];
  return [];
};

export const getDefaultMealQuantity = (food: MealPlanningFood, mealType: MealType): number => {
  const component = classifyMealFoodComponent(food);
  const unit = normalizeText(food.serving_unit);
  if (!unit.includes('100g') && !unit.includes('100 g') && unit !== 'g' && !unit.includes('gram')) return 1;
  if (component === 'vegetable') return 2.5;
  if (component === 'protein') return mealType === 'breakfast' ? 1.2 : 1.5;
  if (component === 'carb') return mealType === 'breakfast' ? 0.8 : 1.5;
  if (component === 'fruit') return 1.5;
  if (component === 'fat') return 0.3;
  return 1;
};

const getQuantityBounds = (food: MealPlanningFood | null | undefined): { min: number; max: number } => {
  switch (classifyMealFoodComponent(food)) {
    case 'vegetable': return { min: 1, max: 3 };
    case 'protein': return { min: 0.5, max: 2.5 };
    case 'carb': return { min: 0.5, max: 2.5 };
    case 'fruit': return { min: 0.5, max: 2 };
    case 'dairy': return { min: 0.5, max: 2 };
    case 'fat': return { min: 0.25, max: 1 };
    default: return { min: 0.5, max: 2 };
  }
};

const getMealCalorieShares = (mealsPerDay: unknown): Partial<Record<MealType, number>> => {
  const meals = resolveMealsPerDay(mealsPerDay);
  if (meals <= 2) return { breakfast: 0.4, dinner: 0.6 };
  if (meals === 3) return { breakfast: 0.25, lunch: 0.4, dinner: 0.35 };
  if (meals === 4) return { breakfast: 0.25, lunch: 0.35, dinner: 0.25, snack: 0.15 };
  return { breakfast: 0.2, lunch: 0.35, dinner: 0.25, snack: 0.2 };
};

const getNutritionTargetError = (
  items: GeneratedMealItem[],
  foods: MealPlanningFood[],
  targets: NutritionMacroTargets,
  mealsPerDay: unknown,
) => {
  const totals = calculateMealNutritionTotals(items, foods);
  if (!targets.calorieTarget) return 0;
  const normalizedSquare = (actual: number, target: number) => {
    if (!target) return 0;
    return ((actual - target) / target) ** 2;
  };
  let error =
    normalizedSquare(totals.calories, targets.calorieTarget) * 2.2 +
    normalizedSquare(totals.protein, targets.protein.grams) * 2.1 +
    normalizedSquare(totals.carbs, targets.carbs.grams) * 1.2 +
    normalizedSquare(totals.fat, targets.fat.grams) * 1.2;

  const foodById = new Map(foods.map((food) => [String(food.id || ''), food]));
  const mealShares = getMealCalorieShares(mealsPerDay);
  Object.entries(mealShares).forEach(([mealType, share]) => {
    const mealCalories = items
      .filter((item) => item.meal_type === mealType)
      .reduce((sum, item) => {
        const food = foodById.get(String(item.food_id || ''));
        return sum + asNumber(food?.calories) * Math.max(0, asNumber(item.quantity));
      }, 0);
    error += normalizedSquare(mealCalories, targets.calorieTarget * Number(share)) * 0.35;
  });
  return error;
};

/**
 * Balances the portions selected by AI against the user's calorie and macro targets.
 * It never adds an unsafe food: it only adjusts amounts of already validated items.
 */
export const optimizeMealPlanQuantities = (
  source: GeneratedMealItem[] | null | undefined,
  foods: MealPlanningFood[] | null | undefined,
  targets: NutritionMacroTargets,
  mealsPerDay: unknown,
): GeneratedMealItem[] => {
  const catalog = foods || [];
  const foodById = new Map(catalog.map((food) => [String(food.id || ''), food]));
  const items = (source || []).map((item) => ({
    ...item,
    quantity: Math.max(0.25, Math.min(6, asNumber(item.quantity) || 1)),
  }));
  const hasNutrition = items.some((item) => {
    const food = foodById.get(String(item.food_id || ''));
    return asNumber(food?.calories) > 0 || asNumber(food?.protein) > 0 || asNumber(food?.carbs) > 0 || asNumber(food?.fat) > 0;
  });
  if (!targets.calorieTarget || !hasNutrition) return items;

  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (let index = 0; index < items.length; index += 1) {
      const food = foodById.get(String(items[index].food_id || ''));
      const { min, max } = getQuantityBounds(food);
      let bestQuantity = items[index].quantity;
      let bestError = getNutritionTargetError(items, catalog, targets, mealsPerDay);

      for (let quantity = min; quantity <= max + 0.001; quantity += 0.25) {
        const candidateQuantity = Math.round(quantity * 100) / 100;
        if (candidateQuantity === items[index].quantity) continue;
        const candidate = items.map((item, candidateIndex) => (
          candidateIndex === index ? { ...item, quantity: candidateQuantity } : item
        ));
        const candidateError = getNutritionTargetError(candidate, catalog, targets, mealsPerDay);
        if (candidateError + 0.000001 < bestError) {
          bestError = candidateError;
          bestQuantity = candidateQuantity;
        }
      }

      if (bestQuantity !== items[index].quantity) {
        items[index] = { ...items[index], quantity: bestQuantity };
        changed = true;
      }
    }
    if (!changed) break;
  }

  return items.map((item, order_index) => ({ ...item, order_index }));
};

const getGoalText = (context: MealPlanningContext) => normalizeText([
  context.lifestyle?.fitness_goal,
  context.lifestyle?.diet_preference,
  context.lifestyle?.current_diet,
  ...(Array.isArray(context.lifestyle?.diet_styles) ? context.lifestyle.diet_styles : []),
].filter(Boolean).join(' '));

const scoreFood = (food: MealPlanningFood, context: MealPlanningContext, recentIds: Set<string> = new Set()) => {
  const component = classifyMealFoodComponent(food);
  const goalText = getGoalText(context);
  const calories = asNumber(food.calories);
  const protein = asNumber(food.protein);
  const carbs = asNumber(food.carbs);
  let score = (food.is_easy_to_prepare ? 8 : 0) + getFoodPreferenceScore(food, context);
  if (recentIds.has(String(food.id || ''))) score -= 24;
  if (hasAny(goalText, ['giam can', 'giam mo', 'fat loss', 'weight loss'])) {
    if (component === 'vegetable' || component === 'fruit') score += 14;
    if (calories > 450) score -= 24;
  }
  if (hasAny(goalText, ['tang co', 'muscle', 'high protein', 'nhieu dam'])) {
    if (component === 'protein') score += 22;
    if (protein >= 18) score += 18;
  }
  if (hasAny(goalText, ['low carb', 'keto'])) score += carbs <= 12 ? 20 : -26;
  const targetCalories = asNumber(context.targetCalories || context.lifestyle?.target_calories);
  if (targetCalories > 0) {
    const perMeal = targetCalories / resolveMealsPerDay(context.mealsPerDay || context.lifestyle?.meals_per_day);
    const ideal = component === 'vegetable' ? 45 : component === 'protein' ? Math.min(220, perMeal * 0.35) : Math.min(220, perMeal * 0.32);
    score += Math.max(-18, 12 - Math.abs(calories - ideal) / 10);
  }
  return score;
};

/**
 * The one food catalog used for AI generation. It enforces safety first,
 * keeps every nutrition component represented, and ranks for the profile.
 */
export const buildMealPlanningCatalog = (
  source: MealPlanningFood[] | null | undefined,
  context: MealPlanningContext = {},
  maxItems = 72,
): MealPlanningFood[] => {
  const mealSlots = Array.from(new Set(getMealSlotsForCount(context.mealsPerDay || context.lifestyle?.meals_per_day)));
  const recentIds = new Set(Array.from(context.recentMealFoodIds || []).map(String));
  const safeFoods = filterSafeFoodsForUser(source || [], context)
    .filter((food) => food.id && mealSlots.some((slot) => matchesMealType(food, slot)))
    .sort((left, right) => scoreFood(right, context, recentIds) - scoreFood(left, context, recentIds));
  const selected: MealPlanningFood[] = [];
  const selectedIds = new Set<string>();
  const quotaScale = Math.min(1, Math.max(0.2, maxItems / COMPONENT_QUOTAS.reduce((sum, item) => sum + item.max, 0)));

  const add = (foods: MealPlanningFood[], count: number) => {
    for (const food of foods) {
      if (selected.length >= maxItems || count <= 0) return;
      const id = String(food.id || '');
      if (!id || selectedIds.has(id)) continue;
      selected.push(food);
      selectedIds.add(id);
      count -= 1;
    }
  };

  COMPONENT_QUOTAS.forEach(({ component, max }) => add(
    safeFoods.filter((food) => classifyMealFoodComponent(food) === component),
    Math.max(3, Math.round(max * quotaScale)),
  ));
  add(safeFoods, maxItems - selected.length);
  return selected.slice(0, maxItems);
};

const pickFoodForComponent = (
  foods: MealPlanningFood[],
  mealType: MealType,
  component: MealComponent,
  usedIds: Set<string>,
  usedFamilies: Set<string>,
) => foods
  .filter((food) => String(food.id || '') && !usedIds.has(String(food.id)) && classifyMealFoodComponent(food) === component)
  .sort((left, right) => {
    const leftScore = (matchesMealType(left, mealType) ? 40 : 0) + (getFamilyKey(left) && usedFamilies.has(getFamilyKey(left)) ? -20 : 0) + scoreFood(left, {});
    const rightScore = (matchesMealType(right, mealType) ? 40 : 0) + (getFamilyKey(right) && usedFamilies.has(getFamilyKey(right)) ? -20 : 0) + scoreFood(right, {});
    return rightScore - leftScore;
  })[0] || null;

/** Normalises model output and fills missing components with safe catalog foods. */
export const completeAiMealDay = (
  aiMeals: any[],
  foods: MealPlanningFood[],
  mealsPerDay: unknown,
): GeneratedMealItem[] => {
  const slots = Array.from(new Set(getMealSlotsForCount(mealsPerDay)));
  const foodById = new Map(foods.map((food) => [String(food.id), food]));
  const items: GeneratedMealItem[] = [];
  const usedIds = new Set<string>();
  const usedFamilies = new Set<string>();

  (Array.isArray(aiMeals) ? aiMeals : []).forEach((meal: any) => {
    const mealType = asMealType(meal?.meal_type);
    if (!mealType || !slots.includes(mealType)) return;
    const ids = Array.isArray(meal.food_ids) ? meal.food_ids : [meal.food_id];
    ids.forEach((id: unknown, index: number) => {
      const foodId = String(id || '');
      const food = foodById.get(foodId);
      if (!food || usedIds.has(foodId)) return;
      const quantitySource = Array.isArray(meal.quantities) ? meal.quantities[index] : meal.quantity;
      const quantity = asNumber(quantitySource);
      items.push({
        meal_type: mealType,
        food_id: foodId,
        quantity: quantity > 0 ? Math.max(0.25, Math.min(6, quantity)) : getDefaultMealQuantity(food, mealType),
        order_index: items.length,
      });
      usedIds.add(foodId);
      const family = getFamilyKey(food);
      if (family) usedFamilies.add(family);
    });
  });

  const addComponent = (mealType: MealType, component: MealComponent) => {
    const food = pickFoodForComponent(foods, mealType, component, usedIds, usedFamilies);
    if (!food?.id) return;
    const foodId = String(food.id);
    items.push({ meal_type: mealType, food_id: foodId, quantity: getDefaultMealQuantity(food, mealType), order_index: items.length });
    usedIds.add(foodId);
    const family = getFamilyKey(food);
    if (family) usedFamilies.add(family);
  };

  slots.forEach((mealType) => {
    const current = () => items.filter((item) => item.meal_type === mealType);
    getRequiredComponents(mealType).forEach((component) => {
      if (!current().some((item) => classifyMealFoodComponent(foodById.get(item.food_id)) === component)) {
        addComponent(mealType, component);
      }
    });
    if (mealType === 'snack' && current().length === 0) addComponent(mealType, 'fruit');
  });

  return slots.flatMap((mealType) => items.filter((item) => item.meal_type === mealType))
    .map((item, order_index) => ({ ...item, order_index }));
};
