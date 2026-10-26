import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/middleware';
import { adminSupabase } from '../../config/Supabase';
import { AppError, ConflictError, ExternalProviderError, ValidationError } from '../../http/errors';
import { validateBody } from '../../http/validation';
import { buildRecipeEligibilityContext, getRecipeEligibilityDecision } from '../../services/recipeEligibilityService';

const itemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  day_of_week: z.number().int().min(0).max(6),
  meal_type: z.enum(['breakfast','lunch','dinner','snack']),
  recipe_id: z.string().trim().min(1).max(120).nullable(),
  quantity: z.number().finite().min(0.25).max(10),
  order_index: z.number().int().min(0).max(139),
  is_rest_day: z.boolean(),
}).strict();
export const planSchema = z.object({
  planId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().nonnegative().nullable(),
  name: z.string().trim().min(1).max(120),
  weekStartDate: z.iso.date(),
  items: z.array(itemSchema).max(140),
}).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const saveMealPlan: RequestHandler = async (req, res, next) => {
  try {
    const input = req.body as z.infer<typeof planSchema>;
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 200 || !/^[\w:.-]+$/.test(key)) throw new ValidationError('Thiếu mã yêu cầu lưu thực đơn.');
    const userId = req.auth!.user.id;
    const client = req.supabase!;
    const ids = [...new Set(input.items.filter((item) => !item.is_rest_day).map((item) => item.recipe_id).filter((id): id is string => !!id))];
    const [profile, lifestyle, health, recipes] = await Promise.all([
      client.from('profiles').select('id, updated_at, gender, birthday').eq('id',userId).single(),
      client.from('lifestyle_settings').select('*').eq('user_id',userId).maybeSingle(),
      client.from('health_conditions').select('*').eq('user_id',userId).maybeSingle(),
      client.from('recipes').select('*, recipe_ingredients(*)').in('id',ids),
    ]);
    if ([profile,lifestyle,health,recipes].some((result) => result.error)) throw new ExternalProviderError();
    const context = buildRecipeEligibilityContext({ profile: profile.data, lifestyle: lifestyle.data, health: health.data });
    const recipeById = new Map((recipes.data || []).map((recipe) => [recipe.id,recipe]));
    const positions = new Set<string>();
    for (const item of input.items) {
      const position = `${item.day_of_week}:${item.order_index}`;
      if (positions.has(position)) throw new ValidationError('Các món có vị trí trùng nhau.');
      positions.add(position);
      if (!item.is_rest_day && !getRecipeEligibilityDecision(recipeById.get(item.recipe_id || ''),context,item.meal_type).eligible) {
        throw new AppError(422,'INELIGIBLE_RECIPE','Một số món không phù hợp với hồ sơ ăn uống hiện tại.');
      }
    }
    const { data, error } = await adminSupabase.rpc('replace_meal_plan_atomically', {
      p_user_id:userId, p_plan_id:input.planId, p_expected_version:input.expectedVersion, p_name:input.name,
      p_week_start:input.weekStartDate, p_items:input.items.map((item) => ({ ...item, recipe_updated_at: item.recipe_id ? recipeById.get(item.recipe_id)?.updated_at : null })),
      p_profile_updated_at:profile.data!.updated_at, p_health_updated_at:health.data?.updated_at ?? null,
      p_lifestyle_updated_at:lifestyle.data?.updated_at ?? null,
      p_key_hash:hash(key), p_request_hash:hash(JSON.stringify(input)),
    });
    if (error?.code === '40001') throw new ConflictError('Thực đơn hoặc hồ sơ đã thay đổi. Hãy tải lại trước khi lưu.');
    if (error?.code === '42501') throw new AppError(403,'FORBIDDEN','Không thể chỉnh sửa thực đơn này.');
    if (error) throw new ExternalProviderError();
    return res.json({ data });
  } catch (error) { return next(error); }
};

export const mealPlanRouter = Router();
mealPlanRouter.post('/meal-plans/save', requireAuth, validateBody(planSchema), saveMealPlan);
