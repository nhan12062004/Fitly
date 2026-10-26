import { adminSupabase } from '../../config/Supabase';
import type { RequestHandler } from 'express';

export const createNutritionHandlers = (dependencies: any) => {
  const {
    supabase,
    getAuthUserId,
    buildRecipeEligibilityContext,
    filterEligibleRecipes,
    ExternalProviderError,
    RECIPE_WITH_INGREDIENTS_SELECT,
  } = dependencies;
const validateMealPlanFoods: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const foodIds: string[] = Array.from(new Set<string>(
      (Array.isArray(req.body?.food_ids) ? req.body.food_ids : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean),
    ));
    const recipeIds: string[] = Array.from(new Set<string>(
      (Array.isArray(req.body?.recipe_ids) ? req.body.recipe_ids : [])
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean),
    ));
    if (foodIds.length === 0 && recipeIds.length === 0) return res.json({ success: true });

    const [profileRes, lifestyleRes, healthRes, recipesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('recipes').select('id, name, meal_type, dietary_restrictions, diet_styles, goal_type, price_level, calories, protein, carbs, fat, cooking_time_minutes, cooking_difficulty, allergens, instructions, is_active, recipe_ingredients(id, recipe_id, ingredient_name, amount, unit, preparation_note, is_optional, order_index)').in('id', recipeIds.length > 0 ? recipeIds : foodIds),
    ]);
    const firstError = [profileRes.error, lifestyleRes.error, healthRes.error, recipesRes.error].find(Boolean);
    if (firstError) throw firstError;
    const context = { profile: profileRes.data || {}, lifestyle: lifestyleRes.data || {}, health: healthRes.data || {} };
    const rejected: any[] = [];
    const recipeContext = buildRecipeEligibilityContext(context);
    const recipeById = new Map((recipesRes.data || []).map((recipe: any) => [String(recipe.id), recipe]));
    const targetCheckIds = recipeIds.length > 0 ? recipeIds : foodIds;
    targetCheckIds.forEach((recipeId) => {
      const decision = filterEligibleRecipes([recipeById.get(recipeId)].filter(Boolean), recipeContext);
      if (decision.length !== 1) rejected.push({ food_id: recipeId, reasons: ['ineligible_recipe'] });
    });
    if (rejected.length > 0) {
      return res.status(422).json({ error: 'One or more foods violate hard dietary or safety constraints.', rejected });
    }
    return res.json({ success: true });
  } catch {
    return next(new ExternalProviderError());
  }
};

const getRecipeDetails: RequestHandler = async (req, res, next) => {
  const supabase = req.supabase!;
  try {
    const userId = await getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = String(req.params.id || '').trim();
    let { data, error } = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).eq('id', id).maybeSingle();
    if (!data && id.includes('-')) {
      const namePattern = id.replace(/-/g, ' ');
      const nameRes = await supabase.from('recipes').select(RECIPE_WITH_INGREDIENTS_SELECT).ilike('name', `%${namePattern}%`).limit(1).maybeSingle();
      if (nameRes.data) {
        data = nameRes.data;
        error = null;
      }
    }
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Không tìm thấy chi tiết món ăn.' });
    return res.json({ success: true, data });
  } catch {
    return next(new ExternalProviderError());
  }
};

  return { validateFoods: validateMealPlanFoods, getRecipe: getRecipeDetails };
};