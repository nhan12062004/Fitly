begin;
-- Only the API can replace plan contents, after applying shared dietary guards.
revoke insert, update, delete, truncate, references, trigger, maintain on public.weekly_food_plans, public.weekly_food_items from authenticated;
alter table public.weekly_food_plans add column version bigint not null default 0;

create function public.touch_server_version() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  if tg_table_name = 'weekly_food_plans' then new.version := old.version + 1; end if;
  return new;
end;
$$;
revoke all on function public.touch_server_version() from public, anon, authenticated;
create trigger meal_plan_server_version before update on public.weekly_food_plans for each row execute function public.touch_server_version();
create trigger profile_server_timestamp before update on public.profiles for each row execute function public.touch_server_version();
create trigger health_server_timestamp before update on public.health_conditions for each row execute function public.touch_server_version();
create trigger lifestyle_server_timestamp before update on public.lifestyle_settings for each row execute function public.touch_server_version();

create table public.meal_plan_save_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id, key_hash)
);
alter table public.meal_plan_save_requests enable row level security;
revoke all on public.meal_plan_save_requests from public, anon, authenticated;
grant all on public.meal_plan_save_requests to service_role;

create function public.replace_meal_plan_atomically(
  p_user_id uuid, p_plan_id uuid, p_expected_version bigint, p_name text, p_week_start date, p_items jsonb,
  p_profile_updated_at timestamptz, p_health_updated_at timestamptz, p_lifestyle_updated_at timestamptz,
  p_key_hash text, p_request_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan public.weekly_food_plans%rowtype; prior public.meal_plan_save_requests%rowtype;
  row jsonb; recipe public.recipes%rowtype; item_id uuid; keep_ids uuid[] := '{}'; result jsonb;
  profile_time timestamptz; health_time timestamptz; lifestyle_time timestamptz;
begin
  select updated_at into profile_time from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'Profile required'; end if;
  select * into prior from public.meal_plan_save_requests where user_id = p_user_id and key_hash = p_key_hash;
  if found then
    if prior.request_hash <> p_request_hash then raise exception using errcode = '40001', message = 'Request key conflict'; end if;
    return prior.result;
  end if;
  select updated_at into health_time from public.health_conditions where user_id = p_user_id for share;
  select updated_at into lifestyle_time from public.lifestyle_settings where user_id = p_user_id for share;
  if profile_time is distinct from p_profile_updated_at or health_time is distinct from p_health_updated_at
    or lifestyle_time is distinct from p_lifestyle_updated_at then
    raise exception using errcode = '40001', message = 'Safety profile changed; reload and retry';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 140 then raise exception 'Invalid plan items'; end if;
  if p_plan_id is null then
    -- Serialize create with a second tab, rather than silently replacing its work.
    if exists(select 1 from public.weekly_food_plans where user_id = p_user_id and week_start_date = p_week_start and plan_status = 'active') then
      raise exception using errcode = '40001', message = 'Plan already exists; reload';
    end if;
    insert into public.weekly_food_plans(user_id,name,week_start_date,generated_by)
      values(p_user_id,p_name,p_week_start,'user') returning * into plan;
  else
    select * into plan from public.weekly_food_plans where id = p_plan_id and user_id = p_user_id and plan_status = 'active' for update;
    if not found then raise exception using errcode = '42501', message = 'Plan not found'; end if;
    if p_expected_version is null or plan.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'Plan changed; reload';
    end if;
  end if;
  for row in select value from jsonb_array_elements(p_items) loop
    recipe := null;
    if not coalesce((row->>'is_rest_day')::boolean,false) then
      select * into recipe from public.recipes where id = row->>'recipe_id' and is_active = true for share;
      if not found or recipe.updated_at is distinct from (row->>'recipe_updated_at')::timestamptz or not (row->>'meal_type' = any(recipe.meal_type)) then raise exception 'Invalid recipe or meal slot'; end if;
    end if;
    item_id := nullif(row->>'id','')::uuid;
    if item_id is not null then
      if item_id = any(keep_ids) then raise exception 'Duplicate item'; end if;
      perform 1 from public.weekly_food_items where id = item_id and food_plan_id = plan.id for update;
      if not found then raise exception using errcode = '42501', message = 'Item not owned by plan'; end if;
      update public.weekly_food_items set day_of_week = (row->>'day_of_week')::integer, meal_type = row->>'meal_type',
        recipe_id = recipe.id, quantity = (row->>'quantity')::numeric,
        calories = coalesce(recipe.calories,0), protein = coalesce(recipe.protein,0), carbs = coalesce(recipe.carbs,0), fat = coalesce(recipe.fat,0),
        order_index = (row->>'order_index')::integer, is_rest_day = (row->>'is_rest_day')::boolean where id = item_id;
    else
      insert into public.weekly_food_items(food_plan_id,day_of_week,meal_type,recipe_id,quantity,calories,protein,carbs,fat,order_index,is_rest_day)
      values(plan.id,(row->>'day_of_week')::integer,row->>'meal_type',recipe.id,(row->>'quantity')::numeric,
        coalesce(recipe.calories,0),coalesce(recipe.protein,0),coalesce(recipe.carbs,0),coalesce(recipe.fat,0),
        (row->>'order_index')::integer,(row->>'is_rest_day')::boolean) returning id into item_id;
    end if;
    keep_ids := array_append(keep_ids,item_id);
  end loop;
  delete from public.weekly_food_items where food_plan_id = plan.id and not(id = any(keep_ids));
  update public.weekly_food_plans set name = p_name where id = plan.id returning * into plan;
  select jsonb_build_object('planId',plan.id,'version',plan.version,'weekStartDate',plan.week_start_date,
    'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'day_of_week',day_of_week,'order_index',order_index)),'[]'::jsonb))
    into result from public.weekly_food_items where food_plan_id = plan.id;
  insert into public.meal_plan_save_requests(user_id,key_hash,request_hash,result) values(p_user_id,p_key_hash,p_request_hash,result);
  return result;
end;
$$;
revoke all on function public.replace_meal_plan_atomically(uuid,uuid,bigint,text,date,jsonb,timestamptz,timestamptz,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.replace_meal_plan_atomically(uuid,uuid,bigint,text,date,jsonb,timestamptz,timestamptz,timestamptz,text,text) to service_role;
commit;
