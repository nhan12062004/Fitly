import { AIChatResponse } from './types';

type MealAdjusterInput = {
  dayOfWeek: number;
  currentMeal: {
    id: string;
    meal_type: string;
    food_id: string;
    quantity?: number | null;
    foods?: {
      name?: string | null;
    } | null;
  } | null;
  candidateFoods: Array<{
    id: string;
    name: string;
    calories?: number | null;
    protein?: number | null;
    carbs?: number | null;
    fat?: number | null;
  }>;
};

export const mealAdjusterService = async (input: MealAdjusterInput): Promise<AIChatResponse> => {
  if (!input.currentMeal || input.candidateFoods.length === 0) {
    return {
      reply: 'Minh chua du du lieu de doi mon hom nay. Hay tao hoac dong bo lai thuc don truoc.',
      intent: 'adjust_meal',
      responseMode: 'plan_edit',
      confidence: 0.7,
      actionRequired: false,
      actionType: null,
      actionPayload: null
    };
  }

  const replacement = input.candidateFoods.find((item) => item.id !== input.currentMeal?.food_id) || input.candidateFoods[0];
  const currentFoodName = String(input.currentMeal.foods?.name || 'Mon hien tai');

  return {
    reply: `Minh de xuat doi ${currentFoodName} sang ${replacement.name} de gon hon nhung van uu tien protein.`,
    intent: 'adjust_meal',
    responseMode: 'plan_edit',
    confidence: 0.84,
    actionRequired: true,
    actionType: 'replace_today_meal',
    actionPayload: {
      day_of_week: input.dayOfWeek,
      old_weekly_food_item_id: input.currentMeal.id,
      old_food_id: input.currentMeal.food_id,
      old_food_name: currentFoodName,
      new_food_id: replacement.id,
      new_food_name: replacement.name,
      meal_type: input.currentMeal.meal_type,
      quantity: Math.max(0.25, Number(input.currentMeal.quantity || 1)),
      calories: Number(replacement.calories || 0),
      protein: Number(replacement.protein || 0),
      carbs: Number(replacement.carbs || 0),
      fat: Number(replacement.fat || 0),
      notes: 'Doi sang lua chon de chuan bi hon'
    }
  };
};
