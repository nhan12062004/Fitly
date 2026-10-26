begin;
-- Preserve duplicate historical plans, retaining only the newest active plan.
with ranked as (
  select id,row_number() over(partition by user_id,week_start_date order by updated_at desc nulls last,created_at desc,id) n
  from public.weekly_food_plans where plan_status = 'active'
)
update public.weekly_food_plans set plan_status = 'adjusted' where id in(select id from ranked where n > 1);
create unique index weekly_food_plans_one_active_week on public.weekly_food_plans(user_id,week_start_date) where plan_status = 'active';

create function public.publish_coach_plan_atomically(
  p_user_id uuid, p_week_start date, p_workout_id uuid, p_workout_meta jsonb, p_workout_rows jsonb,
  p_meal_id uuid, p_meal_meta jsonb, p_meal_rows jsonb, p_source text, p_safety jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare old_workout uuid; old_meal uuid; profile_time timestamptz; health_time timestamptz; lifestyle_time timestamptz;
begin
  select updated_at into profile_time from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'Profile required'; end if;
  select updated_at into health_time from public.health_conditions where user_id = p_user_id for share;
  select updated_at into lifestyle_time from public.lifestyle_settings where user_id = p_user_id for share;
  if profile_time is distinct from (p_safety->>'profile')::timestamptz or health_time is distinct from (p_safety->>'health')::timestamptz
    or lifestyle_time is distinct from (p_safety->>'lifestyle')::timestamptz then
    raise exception using errcode = '40001', message = 'Safety profile changed; regenerate plan';
  end if;
  if p_source not in ('ai_coach_generate','premium_auto_generate','onboarding_meal_generate') then raise exception 'Invalid source'; end if;
  if p_workout_id is not null then
    if p_workout_rows is null or jsonb_typeof(p_workout_rows) <> 'array' or jsonb_array_length(p_workout_rows) not between 1 and 140 then raise exception 'Invalid workouts'; end if;
    select id into old_workout from public.weekly_plans where user_id = p_user_id and week_start_date = p_week_start and plan_status = 'active' limit 1 for update;
    insert into public.weekly_plans(id,user_id,name,description,week_start_date,plan_status,generated_by,ai_explanation)
      values(p_workout_id,p_user_id,left(p_workout_meta->>'name',120),p_workout_meta->>'explanation',p_week_start,'draft','ai',p_workout_meta->>'explanation');
    insert into public.weekly_plan_exercises
      select r.* from jsonb_array_elements(p_workout_rows) as elements(item) cross join lateral jsonb_populate_record(null::public.weekly_plan_exercises,
        jsonb_build_object('id',gen_random_uuid(),'created_at',now(),'sets',3,'reps','10-12','rest_seconds',60,'is_rest_day',false)
          || item || jsonb_build_object('weekly_plan_id',p_workout_id)) r;
    update public.weekly_plans set plan_status = 'adjusted',updated_at = now() where id = old_workout;
    update public.weekly_plans set plan_status = 'active',updated_at = now() where id = p_workout_id;
  end if;
  if p_meal_id is not null then
    if p_meal_rows is null or jsonb_typeof(p_meal_rows) <> 'array' or jsonb_array_length(p_meal_rows) not between 1 and 140 then raise exception 'Invalid meals'; end if;
    select id into old_meal from public.weekly_food_plans where user_id = p_user_id and week_start_date = p_week_start and plan_status = 'active' limit 1 for update;
    insert into public.weekly_food_plans(id,user_id,name,week_start_date,plan_status,generated_by,ai_explanation)
      values(p_meal_id,p_user_id,left(p_meal_meta->>'name',120),p_week_start,'draft','ai',p_meal_meta->>'explanation');
    insert into public.weekly_food_items
      select r.* from jsonb_array_elements(p_meal_rows) as elements(item) cross join lateral jsonb_populate_record(null::public.weekly_food_items,
        jsonb_build_object('id',gen_random_uuid(),'created_at',now(),'quantity',1,'calories',0,'protein',0,'carbs',0,'fat',0,'is_rest_day',false)
          || item || jsonb_build_object('food_plan_id',p_meal_id)) r;
    update public.weekly_food_plans set plan_status = 'adjusted' where id = old_meal;
    update public.weekly_food_plans set plan_status = 'active' where id = p_meal_id;
  end if;
  insert into public.ai_plan_adjustments(user_id,plan_type,source_type,old_plan_id,new_plan_id,old_data,new_data,reason,created_by,status,applied_at)
    values(p_user_id,case when p_workout_id is not null and p_meal_id is not null then 'both' when p_workout_id is not null then 'workout' else 'meal' end,
      p_source,coalesce(old_workout,old_meal),coalesce(p_workout_id,p_meal_id),
      jsonb_build_object('workout_plan_id',old_workout,'food_plan_id',old_meal),
      jsonb_build_object('workout_plan_id',p_workout_id,'food_plan_id',p_meal_id),
      left(coalesce(p_workout_meta->>'explanation',p_meal_meta->>'explanation','AI generated plan'),300),'ai','applied',now());
end;
$$;
revoke all on function public.publish_coach_plan_atomically(uuid,date,uuid,jsonb,jsonb,uuid,jsonb,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.publish_coach_plan_atomically(uuid,date,uuid,jsonb,jsonb,uuid,jsonb,jsonb,text,jsonb) to service_role;
commit;
