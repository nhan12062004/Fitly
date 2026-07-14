begin;

alter table public.exercises
  add column if not exists training_locations text[];

alter table public.exercises
  add column if not exists min_experience_months smallint;

alter table public.exercises
  add column if not exists progression_level smallint;

-- Existing catalog rows predate location metadata, so retain their broad
-- availability instead of guessing a narrower training location.
update public.exercises
set training_locations = array['home', 'gym']::text[]
where training_locations is null
  or cardinality(training_locations) = 0
  or not (training_locations <@ array['home', 'gym']::text[])
  or array_position(training_locations, null) is not null
  or coalesce(cardinality(array_positions(training_locations, 'home')), 0) > 1
  or coalesce(cardinality(array_positions(training_locations, 'gym')), 0) > 1;

-- Preserve any valid value from an interrupted or previously applied migration.
-- Unknown legacy difficulty values deliberately map to 12 months rather than
-- treating a potentially difficult movement as beginner-safe.
update public.exercises
set min_experience_months = case
  when lower(btrim(coalesce(difficulty, ''))) in (
    'absolute_beginner',
    'absolute beginner',
    'easy',
    'beginner',
    'de',
    'dễ'
  ) then 0
  when lower(btrim(coalesce(difficulty, ''))) in (
    'beginner_plus',
    'beginner plus',
    'novice'
  ) then 3
  when lower(btrim(coalesce(difficulty, ''))) in (
    'intermediate',
    'medium',
    'trung_binh',
    'trung bình'
  ) then 6
  when lower(btrim(coalesce(difficulty, ''))) in (
    'advanced',
    'hard',
    'kho',
    'khó'
  ) then 12
  else 12
end
where min_experience_months is null
  or min_experience_months < 0
  or min_experience_months > 120;

update public.exercises
set progression_level = 1
where progression_level is null
  or progression_level < 1
  or progression_level > 5;

alter table public.exercises
  alter column training_locations set default array['home', 'gym']::text[],
  alter column min_experience_months set default 0,
  alter column progression_level set default 1;

alter table public.exercises
  alter column training_locations set not null,
  alter column min_experience_months set not null,
  alter column progression_level set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exercises'::regclass
      and conname = 'exercises_training_locations_check'
  ) then
    alter table public.exercises
      add constraint exercises_training_locations_check
      check (
        cardinality(training_locations) > 0
        and training_locations <@ array['home', 'gym']::text[]
        and array_position(training_locations, null) is null
        and coalesce(cardinality(array_positions(training_locations, 'home')), 0) <= 1
        and coalesce(cardinality(array_positions(training_locations, 'gym')), 0) <= 1
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exercises'::regclass
      and conname = 'exercises_min_experience_months_check'
  ) then
    alter table public.exercises
      add constraint exercises_min_experience_months_check
      check (
        min_experience_months >= 0
        and min_experience_months <= 120
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.exercises'::regclass
      and conname = 'exercises_progression_level_check'
  ) then
    alter table public.exercises
      add constraint exercises_progression_level_check
      check (
        progression_level >= 1
        and progression_level <= 5
      );
  end if;
end
$$;

create index if not exists exercises_body_part_idx
  on public.exercises (body_part);

create index if not exists exercises_target_muscle_idx
  on public.exercises (target_muscle);

create index if not exists exercises_equipment_idx
  on public.exercises (equipment);

create index if not exists exercises_difficulty_idx
  on public.exercises (difficulty);

create index if not exists exercises_movement_pattern_idx
  on public.exercises (movement_pattern);

create index if not exists exercises_training_locations_gin_idx
  on public.exercises using gin (training_locations);

create index if not exists exercises_goal_type_gin_idx
  on public.exercises using gin (goal_type);

create index if not exists exercises_contraindications_gin_idx
  on public.exercises using gin (contraindications);

-- The API performs eligibility validation before calling this function. The
-- database function makes the final workout replacement and proposal status
-- update one transaction, so a retry cannot leave a half-applied plan.
create or replace function public.apply_workout_adjustment_atomically(
  p_adjustment_id uuid,
  p_user_id uuid,
  p_idempotency_key text,
  p_weekly_plan_id uuid,
  p_day_of_week integer,
  p_log_date date,
  p_rows jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_adjustment public.ai_plan_adjustments%rowtype;
  v_daily_workout_session_id uuid;
  v_weekly_plan_exercise_ids uuid[] := array[]::uuid[];
  v_weekly_plan_exercise_id uuid;
  v_row_index integer := 1;
  v_adjustment_plan_id_text text;
  v_adjustment_day_text text;
  v_week_start_date date;
  v_expected_log_date date;
  v_row jsonb;
  v_duration_minutes integer := 10;
begin
  if p_adjustment_id is null
    or p_user_id is null
    or p_weekly_plan_id is null
    or p_day_of_week is null
    or p_log_date is null
    or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'adjustment, user, plan, day, date, and idempotency key are required';
  end if;
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'day_of_week must be between 0 and 6';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'workout adjustment rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'workout adjustment requires at least one exercise';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as proposed(value)
    left join public.exercises as exercise
      on exercise.id = nullif(btrim(proposed.value ->> 'exercise_id'), '')
    where jsonb_typeof(proposed.value) <> 'object'
      or nullif(btrim(proposed.value ->> 'exercise_id'), '') is null
      or exercise.id is null
  ) then
    raise exception 'workout adjustment contains an invalid exercise';
  end if;

  select *
  into v_adjustment
  from public.ai_plan_adjustments
  where id = p_adjustment_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'adjustment not found';
  end if;
  if v_adjustment.apply_idempotency_key is not null
    and v_adjustment.apply_idempotency_key <> p_idempotency_key then
    raise exception 'adjustment already processed with another idempotency key';
  end if;
  if v_adjustment.status = 'applied' then
    return jsonb_build_object('already_applied', true);
  end if;
  if v_adjustment.status is distinct from 'proposed' then
    raise exception 'adjustment is not proposed';
  end if;
  if v_adjustment.plan_type is distinct from 'workout' then
    raise exception 'adjustment is not a workout proposal';
  end if;
  v_adjustment_plan_id_text := nullif(btrim(v_adjustment.old_data ->> 'weekly_plan_id'), '');
  if v_adjustment_plan_id_text is not null
    and v_adjustment_plan_id_text is distinct from p_weekly_plan_id::text then
    raise exception 'adjustment does not belong to the supplied workout plan';
  end if;
  v_adjustment_day_text := nullif(btrim(v_adjustment.old_data ->> 'day_of_week'), '');
  if v_adjustment_day_text is not null then
    if v_adjustment_day_text !~ '^[0-6]$'
      or v_adjustment_day_text::integer is distinct from p_day_of_week then
      raise exception 'adjustment does not belong to the supplied workout day';
    end if;
  end if;

  -- Serialize replacement for this user's calendar day before reading or
  -- deleting sessions. This covers the no-session case as well as existing rows.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_log_date::text));

  select week_start_date
  into v_week_start_date
  from public.weekly_plans
  where id = p_weekly_plan_id
    and user_id = p_user_id
    and plan_status = 'active'
  for update;
  if not found then
    raise exception 'workout plan not found for user';
  end if;
  v_expected_log_date := v_week_start_date + p_day_of_week;
  if p_log_date is distinct from v_expected_log_date then
    raise exception 'log date does not match the workout plan day';
  end if;

  perform 1
  from public.daily_workout_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  for update;

  if exists (
    select 1
    from public.daily_workout_sessions
    where user_id = p_user_id
      and log_date = p_log_date
      and status is distinct from 'planned'
  ) then
    raise exception 'workout session for this day is already started or completed';
  end if;

  perform 1
  from public.daily_exercise_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  for update;

  if exists (
    select 1
    from public.daily_exercise_sessions
    where user_id = p_user_id
      and log_date = p_log_date
      and (is_completed = true or coalesce(completed_sets, 0) > 0)
  ) then
    raise exception 'workout for this day has already started';
  end if;

  select id
  into v_daily_workout_session_id
  from public.daily_workout_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  order by started_at desc nulls last, created_at desc
  limit 1
  for update;

  -- A previous bug could create duplicate day sessions. Remove stale snapshots
  -- from every matching session before replacing the canonical session below.
  delete from public.daily_workout_session_exercises
  where session_id in (
    select id
    from public.daily_workout_sessions
    where user_id = p_user_id
      and log_date = p_log_date
  );

  delete from public.daily_exercise_sessions
  where user_id = p_user_id
    and log_date = p_log_date;

  -- Do not delete a plan row that has been materialized on another calendar
  -- day. That would either violate an FK or erase the trace back to history.
  if exists (
    select 1
    from public.daily_exercise_sessions as daily
    join public.weekly_plan_exercises as weekly
      on weekly.id = daily.weekly_plan_exercise_id
    where weekly.weekly_plan_id = p_weekly_plan_id
      and weekly.day_of_week = p_day_of_week
      and daily.log_date is distinct from p_log_date
  ) or exists (
    select 1
    from public.daily_workout_session_exercises as snapshot
    join public.weekly_plan_exercises as weekly
      on weekly.id = snapshot.weekly_plan_exercise_id
    join public.daily_workout_sessions as workout_session
      on workout_session.id = snapshot.session_id
    where weekly.weekly_plan_id = p_weekly_plan_id
      and weekly.day_of_week = p_day_of_week
      and workout_session.log_date is distinct from p_log_date
  ) then
    raise exception 'workout plan day is materialized on another calendar day';
  end if;

  delete from public.weekly_plan_exercises
  where weekly_plan_id = p_weekly_plan_id
    and day_of_week = p_day_of_week;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.weekly_plan_exercises (
      weekly_plan_id, day_of_week, exercise_id, sets, reps, weight_kg,
      rest_seconds, order_index, is_rest_day, planned_sets, planned_reps,
      planned_weight_kg, planned_rest_seconds, target_rpe, estimated_kcal,
      ai_note, load_instruction
    ) values (
      p_weekly_plan_id,
      p_day_of_week,
      nullif(btrim(v_row ->> 'exercise_id'), ''),
      coalesce((v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'weight_kg')::numeric, 0),
      coalesce((v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'order_index')::integer, 0),
      false,
      coalesce((v_row ->> 'planned_sets')::integer, (v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'planned_reps', ''), nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'planned_weight_kg')::numeric, (v_row ->> 'weight_kg')::numeric, 0),
      coalesce((v_row ->> 'planned_rest_seconds')::integer, (v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'target_rpe')::numeric, 7),
      coalesce((v_row ->> 'estimated_kcal')::integer, 0),
      null,
      nullif(v_row ->> 'load_adjustment_note', '')
    ) returning id into v_weekly_plan_exercise_id;
    v_weekly_plan_exercise_ids := array_append(
      v_weekly_plan_exercise_ids,
      v_weekly_plan_exercise_id
    );
  end loop;

  update public.weekly_plans
  set updated_at = timezone('utc'::text, now())
  where id = p_weekly_plan_id
    and user_id = p_user_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_weekly_plan_exercise_id := v_weekly_plan_exercise_ids[v_row_index];
    if v_weekly_plan_exercise_id is null then
      raise exception 'failed to map adjusted exercise to weekly plan row';
    end if;
    insert into public.daily_exercise_sessions (
      user_id, log_date, weekly_plan_exercise_id, exercise_id, sets, reps,
      weight_kg, rest_seconds, order_index, is_completed, planned_sets,
      planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets,
      actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe,
      estimated_kcal, actual_kcal_estimated, completed_sets,
      load_adjustment_note
    ) values (
      p_user_id,
      p_log_date,
      v_weekly_plan_exercise_id,
      nullif(btrim(v_row ->> 'exercise_id'), ''),
      coalesce((v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'weight_kg')::numeric, 0),
      coalesce((v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'order_index')::integer, 0),
      false,
      coalesce((v_row ->> 'planned_sets')::integer, (v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'planned_reps', ''), nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'planned_weight_kg')::numeric, (v_row ->> 'weight_kg')::numeric, 0),
      coalesce((v_row ->> 'planned_rest_seconds')::integer, (v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'actual_sets')::integer, (v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'actual_reps', ''), nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'actual_weight_kg')::numeric, (v_row ->> 'weight_kg')::numeric, 0),
      coalesce((v_row ->> 'actual_rest_seconds')::integer, (v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'target_rpe')::numeric, 7),
      coalesce((v_row ->> 'estimated_kcal')::integer, 0),
      coalesce((v_row ->> 'actual_kcal_estimated')::integer, 0),
      coalesce((v_row ->> 'completed_sets')::integer, 0),
      nullif(v_row ->> 'load_adjustment_note', '')
    );
    v_row_index := v_row_index + 1;
  end loop;

  select greatest(10, coalesce(sum(coalesce((value ->> 'sets')::integer, 1)), 1) * 2)
  into v_duration_minutes
  from jsonb_array_elements(p_rows);

  if v_daily_workout_session_id is null then
    insert into public.daily_workout_sessions (
      user_id, weekly_plan_id, log_date, title, duration_minutes,
      calories_burned, status
    ) values (
      p_user_id, p_weekly_plan_id, p_log_date, 'Buổi tập ' || p_log_date,
      v_duration_minutes, 0, 'planned'
    ) returning id into v_daily_workout_session_id;
  else
    update public.daily_workout_sessions
    set weekly_plan_id = p_weekly_plan_id,
        title = 'Buổi tập ' || p_log_date,
        duration_minutes = v_duration_minutes,
        status = 'planned'
    where id = v_daily_workout_session_id;
  end if;

  insert into public.daily_workout_session_exercises (
    session_id, daily_exercise_session_id, weekly_plan_exercise_id,
    exercise_id, sets, reps, weight_kg, rest_seconds, order_index,
    is_completed, planned_sets, planned_reps, planned_weight_kg,
    planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg,
    actual_rest_seconds, target_rpe, estimated_kcal,
    actual_kcal_estimated, completed_sets
  )
  select
    v_daily_workout_session_id,
    session.id,
    session.weekly_plan_exercise_id,
    session.exercise_id,
    session.sets,
    session.reps,
    session.weight_kg,
    session.rest_seconds,
    session.order_index,
    session.is_completed,
    session.planned_sets,
    session.planned_reps,
    session.planned_weight_kg,
    session.planned_rest_seconds,
    session.actual_sets,
    session.actual_reps,
    session.actual_weight_kg,
    session.actual_rest_seconds,
    session.target_rpe,
    session.estimated_kcal,
    session.actual_kcal_estimated,
    session.completed_sets
  from public.daily_exercise_sessions as session
  where session.user_id = p_user_id
    and session.log_date = p_log_date
  order by session.order_index;

  update public.ai_plan_adjustments
  set status = 'applied',
      applied_at = timezone('utc'::text, now()),
      apply_idempotency_key = p_idempotency_key
  where id = p_adjustment_id
    and user_id = p_user_id;

  return jsonb_build_object(
    'already_applied', false,
    'daily_workout_session_id', v_daily_workout_session_id
  );
end;
$$;

-- Materializing an active weekly-plan day needs the same per-user/day lock as
-- AI replacement. Otherwise two API requests can both observe an empty day
-- and create competing daily rows or stale workout-session snapshots.
create or replace function public.materialize_daily_workout_from_plan_atomically(
  p_user_id uuid,
  p_weekly_plan_id uuid,
  p_log_date date,
  p_rows jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_daily_workout_session_id uuid;
  v_weekly_plan_exercise_id uuid;
  v_row jsonb;
  v_week_start_date date;
  v_expected_day_of_week integer;
  v_duration_minutes integer := 10;
  v_existing_daily_rows integer := 0;
begin
  if p_user_id is null or p_weekly_plan_id is null or p_log_date is null then
    raise exception 'user, workout plan, and date are required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'daily workout rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) = 0 then
    raise exception 'daily workout requires at least one exercise';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_log_date::text));

  select week_start_date
  into v_week_start_date
  from public.weekly_plans
  where id = p_weekly_plan_id
    and user_id = p_user_id
    and plan_status = 'active'
  for update;
  if not found then
    raise exception 'active workout plan not found for user';
  end if;
  v_expected_day_of_week := p_log_date - v_week_start_date;
  if v_expected_day_of_week < 0 or v_expected_day_of_week > 6 then
    raise exception 'log date is outside the workout plan week';
  end if;

  -- Validate row-to-plan linkage only after taking the shared day lock. An AI
  -- replacement can otherwise delete the selected weekly rows between a
  -- caller's read and this materialization transaction.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as proposed(value)
    left join public.exercises as exercise
      on exercise.id = nullif(btrim(proposed.value ->> 'exercise_id'), '')
    left join public.weekly_plan_exercises as weekly_exercise
      on weekly_exercise.id::text = nullif(btrim(proposed.value ->> 'weekly_plan_exercise_id'), '')
      and weekly_exercise.weekly_plan_id = p_weekly_plan_id
      and weekly_exercise.day_of_week = v_expected_day_of_week
      and weekly_exercise.exercise_id = nullif(btrim(proposed.value ->> 'exercise_id'), '')
    where jsonb_typeof(proposed.value) <> 'object'
      or nullif(btrim(proposed.value ->> 'exercise_id'), '') is null
      or nullif(btrim(proposed.value ->> 'weekly_plan_exercise_id'), '') is null
      or exercise.id is null
      or weekly_exercise.id is null
  ) then
    raise exception 'daily workout contains an invalid plan exercise';
  end if;

  perform 1
  from public.daily_workout_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  for update;
  perform 1
  from public.daily_exercise_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  for update;

  select id
  into v_daily_workout_session_id
  from public.daily_workout_sessions
  where user_id = p_user_id
    and log_date = p_log_date
  order by started_at desc nulls last, created_at desc
  limit 1
  for update;

  select count(*)
  into v_existing_daily_rows
  from public.daily_exercise_sessions
  where user_id = p_user_id
    and log_date = p_log_date;
  if v_existing_daily_rows > 0 then
    return jsonb_build_object(
      'already_materialized', true,
      'daily_workout_session_id', v_daily_workout_session_id
    );
  end if;

  if exists (
    select 1
    from public.daily_workout_sessions
    where user_id = p_user_id
      and log_date = p_log_date
      and status is distinct from 'planned'
  ) then
    raise exception 'workout session for this day is already started or completed';
  end if;

  -- Clear obsolete snapshots from all legacy duplicate parents before using
  -- the newest planned parent as the canonical session for this calendar day.
  delete from public.daily_workout_session_exercises
  where session_id in (
    select id
    from public.daily_workout_sessions
    where user_id = p_user_id
      and log_date = p_log_date
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select id
    into v_weekly_plan_exercise_id
    from public.weekly_plan_exercises
    where id::text = btrim(v_row ->> 'weekly_plan_exercise_id')
      and weekly_plan_id = p_weekly_plan_id
      and day_of_week = v_expected_day_of_week
      and exercise_id = nullif(btrim(v_row ->> 'exercise_id'), '')
    for update;
    if not found then
      raise exception 'daily workout plan exercise no longer exists';
    end if;

    insert into public.daily_exercise_sessions (
      user_id, log_date, weekly_plan_exercise_id, exercise_id, sets, reps,
      weight_kg, rest_seconds, order_index, is_completed, planned_sets,
      planned_reps, planned_weight_kg, planned_rest_seconds, actual_sets,
      actual_reps, actual_weight_kg, actual_rest_seconds, target_rpe,
      estimated_kcal, actual_kcal_estimated, completed_sets,
      load_adjustment_note
    ) values (
      p_user_id,
      p_log_date,
      v_weekly_plan_exercise_id,
      nullif(btrim(v_row ->> 'exercise_id'), ''),
      coalesce((v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'reps', ''), '10-12'),
      (v_row ->> 'weight_kg')::numeric,
      coalesce((v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'order_index')::integer, 0),
      false,
      coalesce((v_row ->> 'planned_sets')::integer, (v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'planned_reps', ''), nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'planned_weight_kg')::numeric, (v_row ->> 'weight_kg')::numeric),
      coalesce((v_row ->> 'planned_rest_seconds')::integer, (v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'actual_sets')::integer, (v_row ->> 'sets')::integer, 3),
      coalesce(nullif(v_row ->> 'actual_reps', ''), nullif(v_row ->> 'reps', ''), '10-12'),
      coalesce((v_row ->> 'actual_weight_kg')::numeric, (v_row ->> 'weight_kg')::numeric),
      coalesce((v_row ->> 'actual_rest_seconds')::integer, (v_row ->> 'rest_seconds')::integer, 60),
      coalesce((v_row ->> 'target_rpe')::numeric, 7),
      coalesce((v_row ->> 'estimated_kcal')::integer, 0),
      coalesce((v_row ->> 'actual_kcal_estimated')::integer, 0),
      coalesce((v_row ->> 'completed_sets')::integer, 0),
      nullif(v_row ->> 'load_adjustment_note', '')
    );
  end loop;

  select greatest(10, coalesce(sum(coalesce((value ->> 'sets')::integer, 1)), 1) * 2)
  into v_duration_minutes
  from jsonb_array_elements(p_rows);

  if v_daily_workout_session_id is null then
    insert into public.daily_workout_sessions (
      user_id, weekly_plan_id, log_date, title, duration_minutes,
      calories_burned, status
    ) values (
      p_user_id, p_weekly_plan_id, p_log_date, 'Buổi tập ' || p_log_date,
      v_duration_minutes, 0, 'planned'
    ) returning id into v_daily_workout_session_id;
  else
    update public.daily_workout_sessions
    set weekly_plan_id = p_weekly_plan_id,
        title = 'Buổi tập ' || p_log_date,
        duration_minutes = v_duration_minutes,
        status = 'planned'
    where id = v_daily_workout_session_id;
  end if;

  insert into public.daily_workout_session_exercises (
    session_id, daily_exercise_session_id, weekly_plan_exercise_id,
    exercise_id, sets, reps, weight_kg, rest_seconds, order_index,
    is_completed, planned_sets, planned_reps, planned_weight_kg,
    planned_rest_seconds, actual_sets, actual_reps, actual_weight_kg,
    actual_rest_seconds, target_rpe, estimated_kcal,
    actual_kcal_estimated, completed_sets
  )
  select
    v_daily_workout_session_id,
    session.id,
    session.weekly_plan_exercise_id,
    session.exercise_id,
    session.sets,
    session.reps,
    session.weight_kg,
    session.rest_seconds,
    session.order_index,
    session.is_completed,
    session.planned_sets,
    session.planned_reps,
    session.planned_weight_kg,
    session.planned_rest_seconds,
    session.actual_sets,
    session.actual_reps,
    session.actual_weight_kg,
    session.actual_rest_seconds,
    session.target_rpe,
    session.estimated_kcal,
    session.actual_kcal_estimated,
    session.completed_sets
  from public.daily_exercise_sessions as session
  where session.user_id = p_user_id
    and session.log_date = p_log_date
  order by session.order_index;

  return jsonb_build_object(
    'already_materialized', false,
    'daily_workout_session_id', v_daily_workout_session_id
  );
end;
$$;

-- This procedure assumes the API has already run authorization, catalog-ID,
-- eligibility, and safety validation. Keep it service-only so a browser role
-- cannot invoke it with arbitrary rows and bypass those checks.
revoke all on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb) from public;
revoke all on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb) from anon;
revoke all on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb) from authenticated;
grant execute on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb) to service_role;
revoke all on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb) from public;
revoke all on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb) from anon;
revoke all on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb) from authenticated;
grant execute on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb) to service_role;

commit;
