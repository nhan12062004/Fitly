import { createHash } from 'node:crypto';
import { adminSupabase } from '../../config/Supabase';
import { AppError, ExternalProviderError } from '../../http/errors';
import { buildRecipeEligibilityContext, getRecipeEligibilityDecision } from '../recipeEligibilityService';

export type MealPlanRow = {
  id?: string | null;
  day_of_week: number;
  meal_type: string;
  recipe_id?: string | null;
  quantity: number;
  order_index: number;
  is_rest_day: boolean;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const mergeGeneratedMealRows = (
  scope: 'day' | 'week',
  targetDayIndex: number,
  preserved: MealPlanRow[],
  generated: MealPlanRow[],
): MealPlanRow[] => {
  const replacement = generated.filter((row) => scope === 'week' || row.day_of_week === targetDayIndex);
  if (!replacement.length || (scope === 'week' && new Set(replacement.map((row) => row.day_of_week)).size !== 7)) {
    throw new AppError(422, 'INVALID_MEAL_PLAN', 'AI chưa tạo đủ món cho các ngày cần lưu.');
  }
  const otherDays = scope === 'day' ? preserved.filter((row) => row.day_of_week !== targetDayIndex) : [];
  return [...otherDays, ...replacement.map((row) => ({ ...row, id: null }))];
};

export async function persistGeneratedMealPlan(params: {
  userId: string;
  weekStartKey: string;
  scope: 'day' | 'week';
  targetDayIndex: number;
  generatedRows: MealPlanRow[];
  safetyVersion: { profile: string; health: string | null; lifestyle: string | null };
  operationId: string;
}) {
  const { userId, weekStartKey, scope, targetDayIndex, generatedRows, safetyVersion, operationId } = params;
  const [planRes, profileRes, lifestyleRes, healthRes] = await Promise.all([
    adminSupabase.from('weekly_food_plans').select('id, version, name')
      .eq('user_id', userId).eq('week_start_date', weekStartKey).eq('plan_status', 'active')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    adminSupabase.from('profiles').select('id, gender, birthday').eq('id', userId).single(),
    adminSupabase.from('lifestyle_settings').select('*').eq('user_id', userId).maybeSingle(),
    adminSupabase.from('health_conditions').select('*').eq('user_id', userId).maybeSingle(),
  ]);
  if ([planRes, profileRes, lifestyleRes, healthRes].some((result) => result.error)) throw new ExternalProviderError();

  const plan = planRes.data;
  let preserved: MealPlanRow[] = [];
  if (scope === 'day' && plan?.id) {
    const existing = await adminSupabase.from('weekly_food_items')
      .select('id, day_of_week, meal_type, recipe_id, quantity, order_index, is_rest_day')
      .eq('food_plan_id', plan.id).neq('day_of_week', targetDayIndex);
    if (existing.error) throw new ExternalProviderError();
    preserved = (existing.data || []) as MealPlanRow[];
  }
  const rows = mergeGeneratedMealRows(scope, targetDayIndex, preserved, generatedRows);
  if (rows.length > 140) throw new AppError(422, 'INVALID_MEAL_PLAN', 'Thực đơn có quá nhiều món.');

  const recipeIds = [...new Set(rows.filter((row) => !row.is_rest_day).map((row) => row.recipe_id).filter((id): id is string => !!id))];
  const recipesRes = await adminSupabase.from('recipes').select('*, recipe_ingredients(*)').in('id', recipeIds);
  if (recipesRes.error) throw new ExternalProviderError();
  const recipes = new Map((recipesRes.data || []).map((recipe) => [String(recipe.id), recipe]));
  const context = buildRecipeEligibilityContext({ profile: profileRes.data, lifestyle: lifestyleRes.data, health: healthRes.data });
  const positions = new Set<string>();
  const items = rows.map((row) => {
    const position = `${row.day_of_week}:${row.order_index}`;
    if (positions.has(position)) throw new AppError(422, 'INVALID_MEAL_PLAN', 'Thực đơn có vị trí món trùng nhau.');
    positions.add(position);
    const recipe = row.is_rest_day ? null : recipes.get(String(row.recipe_id || ''));
    if (!row.is_rest_day && !getRecipeEligibilityDecision(recipe, context, row.meal_type).eligible) {
      throw new AppError(422, 'INELIGIBLE_RECIPE', 'Một số món không còn phù hợp với hồ sơ ăn uống.');
    }
    return {
      id: row.id || null, day_of_week: row.day_of_week, meal_type: row.meal_type,
      recipe_id: row.is_rest_day ? null : row.recipe_id, quantity: row.quantity,
      order_index: row.order_index, is_rest_day: row.is_rest_day,
      recipe_updated_at: recipe?.updated_at ?? null,
    };
  });
  const request = { userId, weekStartKey, scope, targetDayIndex, planId: plan?.id || null, version: plan?.version ?? null, items };
  const saved = await adminSupabase.rpc('replace_meal_plan_atomically', {
    p_user_id: userId, p_plan_id: plan?.id ?? null, p_expected_version: plan?.version ?? null,
    p_name: plan?.name || (scope === 'week' ? 'Thực đơn AI 7 ngày' : 'Thực đơn AI hôm nay'),
    p_week_start: weekStartKey, p_items: items,
    p_profile_updated_at: safetyVersion.profile, p_health_updated_at: safetyVersion.health,
    p_lifestyle_updated_at: safetyVersion.lifestyle,
    p_key_hash: hash(`ai-meal:${operationId}`), p_request_hash: hash(JSON.stringify(request)),
  });
  if (saved.error?.code === '40001') throw new AppError(409, 'MEAL_PLAN_CONFLICT', 'Thực đơn hoặc hồ sơ đã thay đổi. Hãy tải lại và thử lại.');
  if (saved.error?.code === '42501') throw new AppError(403, 'FORBIDDEN', 'Không thể lưu thực đơn này.');
  if (saved.error || !saved.data?.planId) throw new ExternalProviderError();

  return { ...saved.data, oldPlanId: plan?.id ?? null };
}
