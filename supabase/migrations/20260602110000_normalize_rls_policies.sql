-- Normalize RLS policies after initial hardening.
-- Goals:
-- 1. Remove duplicate/legacy policies on tracked public tables.
-- 2. Keep exactly one owner_policy per user-owned table.
-- 3. Keep catalog tables read-only with public SELECT only.

do $$
declare
  target_table text;
  policy_record record;
begin
  foreach target_table in array array[
    'profiles',
    'body_metrics',
    'goals',
    'health_conditions',
    'lifestyle_settings',
    'daily_exercise_sessions',
    'daily_meal_logs',
    'daily_progress_logs',
    'daily_workout_sessions',
    'daily_workout_session_exercises',
    'weekly_plans',
    'weekly_plan_exercises',
    'weekly_food_plans',
    'weekly_food_items',
    'meal_feedback',
    'workout_session_feedback',
    'ai_chat_messages',
    'ai_plan_adjustments',
    'exercises',
    'foods',
    'featured_courses'
  ]
  loop
    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, target_table);
    end loop;
  end loop;
end
$$;

alter table if exists public.profiles enable row level security;
alter table if exists public.body_metrics enable row level security;
alter table if exists public.goals enable row level security;
alter table if exists public.health_conditions enable row level security;
alter table if exists public.lifestyle_settings enable row level security;
alter table if exists public.daily_exercise_sessions enable row level security;
alter table if exists public.daily_meal_logs enable row level security;
alter table if exists public.daily_progress_logs enable row level security;
alter table if exists public.daily_workout_sessions enable row level security;
alter table if exists public.daily_workout_session_exercises enable row level security;
alter table if exists public.weekly_plans enable row level security;
alter table if exists public.weekly_plan_exercises enable row level security;
alter table if exists public.weekly_food_plans enable row level security;
alter table if exists public.weekly_food_items enable row level security;
alter table if exists public.meal_feedback enable row level security;
alter table if exists public.workout_session_feedback enable row level security;
alter table if exists public.ai_chat_messages enable row level security;
alter table if exists public.ai_plan_adjustments enable row level security;

alter table if exists public.exercises enable row level security;
alter table if exists public.foods enable row level security;
alter table if exists public.featured_courses enable row level security;

create policy owner_policy on public.profiles
  for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy owner_policy on public.body_metrics
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.goals
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.health_conditions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.lifestyle_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.daily_exercise_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.daily_meal_logs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.daily_progress_logs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.daily_workout_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.daily_workout_session_exercises
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.daily_workout_sessions ws
      where ws.id = daily_workout_session_exercises.session_id
        and ws.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.daily_workout_sessions ws
      where ws.id = daily_workout_session_exercises.session_id
        and ws.user_id = auth.uid()
    )
  );

create policy owner_policy on public.weekly_plans
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.weekly_plan_exercises
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.weekly_plans wp
      where wp.id = weekly_plan_exercises.weekly_plan_id
        and wp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.weekly_plans wp
      where wp.id = weekly_plan_exercises.weekly_plan_id
        and wp.user_id = auth.uid()
    )
  );

create policy owner_policy on public.weekly_food_plans
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.weekly_food_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.weekly_food_plans wfp
      where wfp.id = weekly_food_items.food_plan_id
        and wfp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.weekly_food_plans wfp
      where wfp.id = weekly_food_items.food_plan_id
        and wfp.user_id = auth.uid()
    )
  );

create policy owner_policy on public.meal_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.workout_session_feedback
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.ai_chat_messages
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy owner_policy on public.ai_plan_adjustments
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy public_select_policy on public.exercises
  for select
  to public
  using (true);

create policy public_select_policy on public.foods
  for select
  to public
  using (true);

create policy public_select_policy on public.featured_courses
  for select
  to public
  using (true);

revoke insert, update, delete, truncate on table public.exercises from anon, authenticated;
revoke insert, update, delete, truncate on table public.foods from anon, authenticated;
revoke insert, update, delete, truncate on table public.featured_courses from anon, authenticated;

grant select on table public.exercises to anon, authenticated;
grant select on table public.foods to anon, authenticated;
grant select on table public.featured_courses to anon, authenticated;
