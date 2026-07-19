import {
  filterSafeFoodsForUser,
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

const getGoalText = (context: MealPlanningContext) => normalizeText([
  context.lifestyle?.fitness_goal,
  context.lifestyle?.diet_preference,
  context.lifestyle?.current_diet,
].filter(Boolean).join(' '));

const scoreFood = (food: MealPlanningFood, context: MealPlanningContext, recentIds: Set<string> = new Set()) => {
  const component = classifyMealFoodComponent(food);
  const goalText = getGoalText(context);
  const calories = asNumber(food.calories);
  const protein = asNumber(food.protein);
  const carbs = asNumber(food.carbs);
  let score = food.is_easy_to_prepare ? 8 : 0;
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
