begin;
create function public.apply_meal_adjustment_atomically(
  p_user_id uuid, p_adjustment_id uuid, p_key text, p_plan_id uuid, p_item_id uuid,
  p_recipe_id text, p_day integer, p_meal_type text, p_quantity numeric,
  p_profile_updated_at timestamptz, p_health_updated_at timestamptz, p_lifestyle_updated_at timestamptz, p_recipe_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare adjustment public.ai_plan_adjustments%rowtype; recipe public.recipes%rowtype;
  profile_time timestamptz; health_time timestamptz; lifestyle_time timestamptz;
begin
  select updated_at into profile_time from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'Profile required'; end if;
  select * into adjustment from public.ai_plan_adjustments where id = p_adjustment_id and user_id = p_user_id for update;
  if not found or adjustment.plan_type <> 'meal' then raise exception using errcode = '42501', message = 'Adjustment not found'; end if;
  if adjustment.status = 'applied' and adjustment.apply_idempotency_key = p_key then return '{"already_applied":true}'::jsonb; end if;
  if adjustment.status <> 'proposed' then raise exception using errcode = '40001', message = 'Adjustment not proposed'; end if;
  perform 1 from public.weekly_food_plans where id = p_plan_id and user_id = p_user_id and plan_status = 'active' for update;
  if not found then raise exception using errcode = '42501', message = 'Plan not found'; end if;
  select updated_at into health_time from public.health_conditions where user_id = p_user_id for share;
  select updated_at into lifestyle_time from public.lifestyle_settings where user_id = p_user_id for share;
  if profile_time is distinct from p_profile_updated_at or health_time is distinct from p_health_updated_at or lifestyle_time is distinct from p_lifestyle_updated_at then
    raise exception using errcode = '40001', message = 'Safety profile changed';
  end if;
  select * into recipe from public.recipes where id = p_recipe_id and is_active for share;
  if not found or recipe.updated_at is distinct from p_recipe_updated_at or not(p_meal_type = any(recipe.meal_type))
    or p_quantity < 0.25 or p_quantity > 10 or p_day not between 0 and 6 then raise exception using errcode = '40001', message = 'Recipe changed or invalid'; end if;
  update public.weekly_food_items set day_of_week = p_day, meal_type = p_meal_type, recipe_id = recipe.id, quantity = p_quantity,
    calories = coalesce(recipe.calories,0), protein = coalesce(recipe.protein,0), carbs = coalesce(recipe.carbs,0), fat = coalesce(recipe.fat,0), is_rest_day = false
    where id = p_item_id and food_plan_id = p_plan_id;
  if not found then raise exception using errcode = '42501', message = 'Item not found'; end if;
  update public.weekly_food_plans set updated_at = now() where id = p_plan_id;
  update public.ai_plan_adjustments set status = 'applied', applied_at = now(), apply_idempotency_key = p_key where id = adjustment.id;
  return '{"already_applied":false}'::jsonb;
end;
$$;
revoke all on function public.apply_meal_adjustment_atomically(uuid,uuid,text,uuid,uuid,text,integer,text,numeric,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_meal_adjustment_atomically(uuid,uuid,text,uuid,uuid,text,integer,text,numeric,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
commit;
