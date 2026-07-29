


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_exp"("p_user_id" "uuid", "p_amount" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE profiles
  SET
    exp   = GREATEST(0, exp + p_amount),
    level = compute_level(GREATEST(0, exp + p_amount)),
    updated_at = now()
  WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."add_exp"("p_user_id" "uuid", "p_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_workout_adjustment_atomically"("p_adjustment_id" "uuid", "p_user_id" "uuid", "p_idempotency_key" "text", "p_weekly_plan_id" "uuid", "p_day_of_week" integer, "p_log_date" "date", "p_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."apply_workout_adjustment_atomically"("p_adjustment_id" "uuid", "p_user_id" "uuid", "p_idempotency_key" "text", "p_weekly_plan_id" "uuid", "p_day_of_week" integer, "p_log_date" "date", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_level"("p_exp" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT GREATEST(1, floor(p_exp / 100)::integer + 1);
$$;


ALTER FUNCTION "public"."compute_level"("p_exp" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_crew_challenge"("p_title" "text" DEFAULT '7-Day Crew Check-in'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
  new_invite_code text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo challenge.';
  end if;

  loop
    new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.challenges where invite_code = new_invite_code
    );
  end loop;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    invite_code,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), '7-Day Crew Check-in'), 80),
    'Keep the habit going together for 7 days.',
    'crew',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7}'::jsonb,
    new_invite_code,
    5
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;


ALTER FUNCTION "public"."create_crew_challenge"("p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_custom_challenge"("p_title" "text", "p_description" "text" DEFAULT NULL::"text", "p_mode" "text" DEFAULT 'solo'::"text", "p_duration_days" integer DEFAULT 7) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
  new_invite_code text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo thử thách.';
  end if;
  if p_mode not in ('solo', 'crew') then
    raise exception 'Loại thử thách không hợp lệ.';
  end if;
  if p_duration_days is not null and (p_duration_days < 1 or p_duration_days > 365) then
    raise exception 'Thời lượng thử thách phải từ 1 đến 365 ngày.';
  end if;

  if p_mode = 'crew' then
    loop
      new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from public.challenges where invite_code = new_invite_code);
    end loop;
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    invite_code,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Thử thách của tôi'), 80),
    left(coalesce(nullif(trim(p_description), ''), 'Hoàn thành một hành động lành mạnh mỗi ngày.'), 500),
    p_mode,
    'daily_checkin',
    today_vn,
    case when p_duration_days is null then null else today_vn + p_duration_days - 1 end,
    jsonb_build_object(
      'healthy_actions_per_day', 1,
      'duration_days', p_duration_days
    ),
    new_invite_code,
    case when p_mode = 'crew' then 5 else 1 end
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;


ALTER FUNCTION "public"."create_custom_challenge"("p_title" "text", "p_description" "text", "p_mode" "text", "p_duration_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_solo_after_onboarding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform public.ensure_default_solo_challenge_for_user(new.user_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."create_default_solo_after_onboarding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_solo_challenge"("p_title" "text" DEFAULT '7-Day Check-in Challenge'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo challenge.';
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), '7-Day Check-in Challenge'), 80),
    'Complete at least 1 healthy action per day.',
    'solo',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7}'::jsonb,
    1
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;


ALTER FUNCTION "public"."create_solo_challenge"("p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_active_solo_challenge"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để sử dụng challenge.';
  end if;

  return public.ensure_default_solo_challenge_for_user(auth.uid());
end;
$$;


ALTER FUNCTION "public"."ensure_active_solo_challenge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_default_solo_challenge_for_user"("p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  existing_challenge_id uuid;
  new_challenge_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and coalesce(role, 'user') <> 'admin'
      and exists (
        select 1
        from public.lifestyle_settings
        where user_id = p_user_id
      )
  ) then
    return null;
  end if;

  update public.challenges
  set status = 'completed',
      updated_at = now()
  where created_by = p_user_id
    and mode = 'solo'
    and status = 'active'
    and end_date < today_vn;

  select challenge.id
  into existing_challenge_id
  from public.challenges challenge
  where challenge.created_by = p_user_id
    and challenge.mode = 'solo'
    and challenge.status = 'active'
    and today_vn between challenge.start_date and challenge.end_date
  order by challenge.created_at desc
  limit 1;

  if existing_challenge_id is not null then
    return existing_challenge_id;
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    max_members
  )
  values (
    p_user_id,
    '7-Day Check-in Challenge',
    'Complete at least 1 healthy action per day.',
    'solo',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7, "is_default": true}'::jsonb,
    1
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, p_user_id, 'owner');

  return new_challenge_id;
end;
$$;


ALTER FUNCTION "public"."ensure_default_solo_challenge_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_ref_code"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  SELECT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;


ALTER FUNCTION "public"."generate_ref_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_challenge_participant_progress"("p_challenge_id" "uuid") RETURNS TABLE("user_id" "uuid", "display_name" "text", "role" "text", "joined_at" timestamp with time zone, "checkin_dates" "date"[])
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_challenge_participant(p_challenge_id) then
    raise exception 'Bạn không có quyền xem challenge này.';
  end if;

  return query
    select
      participant.user_id,
      coalesce(nullif(trim(profile.full_name), ''), 'Thành viên Fitly') as display_name,
      participant.role,
      participant.joined_at,
      coalesce(
        array_agg(checkin.checkin_date order by checkin.checkin_date)
          filter (where checkin.id is not null),
        array[]::date[]
      ) as checkin_dates
    from public.challenge_participants participant
    left join public.profiles profile on profile.id = participant.user_id
    left join public.challenge_checkins checkin
      on checkin.challenge_id = participant.challenge_id
     and checkin.user_id = participant.user_id
    where participant.challenge_id = p_challenge_id
    group by participant.user_id, profile.full_name, participant.role, participant.joined_at
    order by
      case participant.role when 'owner' then 0 else 1 end,
      participant.joined_at asc;
end;
$$;


ALTER FUNCTION "public"."get_challenge_participant_progress"("p_challenge_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_challenge_summaries"() RETURNS TABLE("id" "uuid", "created_by" "uuid", "title" "text", "description" "text", "mode" "text", "challenge_type" "text", "start_date" "date", "end_date" "date", "status" "text", "target" "jsonb", "invite_code" "text", "max_members" integer, "created_at" timestamp with time zone, "participant_count" bigint, "today_checkin_count" bigint, "user_checkin_count" bigint, "user_checked_in" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    challenge.id,
    challenge.created_by,
    challenge.title,
    challenge.description,
    challenge.mode,
    challenge.challenge_type,
    challenge.start_date,
    challenge.end_date,
    case
      when challenge.status = 'active'
        and challenge.end_date is not null
        and challenge.end_date < (timezone('Asia/Ho_Chi_Minh', now()))::date
      then 'completed'
      else challenge.status
    end,
    challenge.target,
    challenge.invite_code,
    challenge.max_members,
    challenge.created_at,
    count(distinct all_participants.user_id),
    count(distinct today_checkins.user_id),
    count(distinct my_checkins.checkin_date),
    bool_or(today_checkins.user_id = auth.uid())
  from public.challenge_participants mine
  join public.challenges challenge on challenge.id = mine.challenge_id
  join public.challenge_participants all_participants on all_participants.challenge_id = challenge.id
  left join public.challenge_checkins today_checkins
    on today_checkins.challenge_id = challenge.id
   and today_checkins.checkin_date = (timezone('Asia/Ho_Chi_Minh', now()))::date
  left join public.challenge_checkins my_checkins
    on my_checkins.challenge_id = challenge.id
   and my_checkins.user_id = auth.uid()
  where mine.user_id = auth.uid()
  group by challenge.id
  order by
    case
      when challenge.status = 'active'
        and (challenge.end_date is null or challenge.end_date >= (timezone('Asia/Ho_Chi_Minh', now()))::date)
      then 0 else 1
    end,
    challenge.created_at desc;
$$;


ALTER FUNCTION "public"."get_user_challenge_summaries"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_profile_system_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'auth'
    AS $$
begin
  if current_user in ('anon', 'authenticated') and (
    new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.membership_tier is distinct from old.membership_tier
    or new.membership_expires_at is distinct from old.membership_expires_at
    or new.has_purchased_plus is distinct from old.has_purchased_plus
    or new.has_purchased_pro is distinct from old.has_purchased_pro
    or new.ai_coach_free_used_at is distinct from old.ai_coach_free_used_at
    or new.exp is distinct from old.exp
    or new.level is distinct from old.level
    or new.ref_code is distinct from old.ref_code
    or new.referral_count is distinct from old.referral_count
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'Protected profile fields can only be changed by the trusted backend.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_profile_system_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'auth'
    AS $$
declare
  assigned_role text := case
    when lower(coalesce(new.raw_app_meta_data ->> 'role', '')) = 'admin' then 'admin'
    else 'user'
  end;
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    lower(new.email),
    assigned_role
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = excluded.email,
    role = case
      when excluded.role = 'admin' then 'admin'
      else public.profiles.role
    end,
    updated_at = timezone('utc', now());

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_challenge_participant"("target_challenge_id" "uuid", "target_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.challenge_participants
    where challenge_id = target_challenge_id
      and user_id = target_user_id
  );
$$;


ALTER FUNCTION "public"."is_challenge_participant"("target_challenge_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_challenge_by_invite_code"("p_invite_code" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  selected_challenge public.challenges%rowtype;
  participant_count integer;
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
  if current_user_id is null then raise exception 'Bạn cần đăng nhập để tham gia thử thách.'; end if;
  select * into selected_challenge
  from public.challenges
  where invite_code = upper(trim(coalesce(p_invite_code, '')))
  for update;
  if selected_challenge.id is null then raise exception 'Mã mời không tồn tại.'; end if;
  if selected_challenge.mode <> 'crew' then raise exception 'Mã mời này không thuộc thử thách nhóm.'; end if;
  if selected_challenge.status <> 'active'
    or (selected_challenge.end_date is not null and selected_challenge.end_date < today_vn)
  then raise exception 'Thử thách đã kết thúc hoặc bị hủy.'; end if;
  if exists (
    select 1 from public.challenge_participants
    where challenge_id = selected_challenge.id and user_id = current_user_id
  ) then return selected_challenge.id; end if;
  select count(*) into participant_count
  from public.challenge_participants where challenge_id = selected_challenge.id;
  if participant_count >= selected_challenge.max_members then
    raise exception 'Thử thách nhóm đã đủ thành viên.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id, role)
  values (selected_challenge.id, current_user_id, 'member');
  return selected_challenge.id;
end;
$$;


ALTER FUNCTION "public"."join_challenge_by_invite_code"("p_invite_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_challenge"("p_challenge_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  participant_role text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để rời thử thách.';
  end if;

  select role into participant_role
  from public.challenge_participants
  where challenge_id = p_challenge_id and user_id = current_user_id;

  if participant_role is null then
    return false;
  end if;
  if participant_role = 'owner' then
    raise exception 'Chủ nhóm không thể rời thử thách. Hãy hủy thử thách nếu không muốn tiếp tục.';
  end if;

  delete from public.challenge_checkins
  where challenge_id = p_challenge_id and user_id = current_user_id;
  delete from public.challenge_participants
  where challenge_id = p_challenge_id and user_id = current_user_id;
  return true;
end;
$$;


ALTER FUNCTION "public"."leave_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."localize_default_challenge_copy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.title = '7-Day Check-in Challenge' then
    new.title := 'Thử thách điểm danh 7 ngày';
  elsif new.title = '7-Day Crew Check-in' then
    new.title := 'Thử thách nhóm 7 ngày';
  end if;

  if new.description = 'Complete at least 1 healthy action per day.' then
    new.description := 'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.';
  elsif new.description = 'Keep the habit going together for 7 days.' then
    new.description := 'Cùng nhau duy trì thói quen lành mạnh trong 7 ngày.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."localize_default_challenge_copy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manual_challenge_checkin"("p_challenge_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  inserted_count integer := 0;
begin
  if current_user_id is null then raise exception 'Bạn cần đăng nhập để điểm danh.'; end if;
  insert into public.challenge_checkins (challenge_id, user_id, checkin_date, source_type)
  select challenge.id, current_user_id, today_vn, 'manual'
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id and participant.user_id = current_user_id
  where challenge.id = p_challenge_id
    and challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn >= challenge.start_date
    and (challenge.end_date is null or today_vn <= challenge.end_date)
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;


ALTER FUNCTION "public"."manual_challenge_checkin"("p_challenge_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."materialize_daily_workout_from_plan_atomically"("p_user_id" "uuid", "p_weekly_plan_id" "uuid", "p_log_date" "date", "p_rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."materialize_daily_workout_from_plan_atomically"("p_user_id" "uuid", "p_weekly_plan_id" "uuid", "p_log_date" "date", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_challenge_template"("p_template_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  selected_template public.challenge_templates%rowtype;
  new_challenge_id uuid;
  new_invite_code text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tham gia thử thách.';
  end if;

  select * into selected_template
  from public.challenge_templates
  where id = p_template_id and is_active = true;

  if selected_template.id is null then
    raise exception 'Mẫu thử thách không tồn tại hoặc đã ngừng hoạt động.';
  end if;

  if selected_template.mode = 'crew' then
    loop
      new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from public.challenges where invite_code = new_invite_code);
    end loop;
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    invite_code,
    max_members
  )
  values (
    current_user_id,
    selected_template.title,
    selected_template.description,
    selected_template.mode,
    'daily_checkin',
    today_vn,
    case
      when selected_template.duration_days is null then null
      else today_vn + selected_template.duration_days - 1
    end,
    jsonb_build_object(
      'healthy_actions_per_day', 1,
      'duration_days', selected_template.duration_days,
      'difficulty', selected_template.difficulty,
      'goal', selected_template.goal,
      'reward_badge', selected_template.reward_badge,
      'template_id', selected_template.id
    ),
    new_invite_code,
    case when selected_template.mode = 'crew' then 5 else 1 end
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;


ALTER FUNCTION "public"."start_challenge_template"("p_template_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_challenge_checkin"("p_source_type" "text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để check in.';
  end if;

  return public.sync_challenge_checkin_for_user(
    auth.uid(),
    p_source_type,
    p_source_id,
    p_metadata
  );
end;
$$;


ALTER FUNCTION "public"."sync_challenge_checkin"("p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_challenge_checkin_for_user"("p_user_id" "uuid", "p_source_type" "text", "p_source_id" "uuid" DEFAULT NULL::"uuid", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  inserted_count integer := 0;
begin
  if p_source_type not in ('water', 'meal', 'workout', 'sleep', 'manual') then
    raise exception 'Nguồn check-in không hợp lệ.';
  end if;
  insert into public.challenge_checkins (
    challenge_id, user_id, checkin_date, source_type, source_id, metadata
  )
  select challenge.id, p_user_id, today_vn, p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb)
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id and participant.user_id = p_user_id
  where challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn >= challenge.start_date
    and (challenge.end_date is null or today_vn <= challenge.end_date)
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;


ALTER FUNCTION "public"."sync_challenge_checkin_for_user"("p_user_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_challenge_checkin_from_activity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
  -- Back-filling an older log must not count as showing up today.
  if new.log_date is distinct from today_vn then
    return new;
  end if;

  if tg_table_name = 'daily_progress_logs' then
    if tg_op = 'INSERT' then
      if coalesce(new.water_intake_ml, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'water', new.id);
      end if;
      if coalesce(new.sleep_hours, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'sleep', new.id);
      end if;
    else
      if coalesce(new.water_intake_ml, 0) > coalesce(old.water_intake_ml, 0) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'water', new.id);
      end if;
      if coalesce(new.sleep_hours, 0) > 0
        and coalesce(new.sleep_hours, 0) <> coalesce(old.sleep_hours, 0) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'sleep', new.id);
      end if;
    end if;
  elsif tg_table_name = 'daily_meal_logs' then
    if tg_op = 'INSERT' then
      if new.is_completed = true then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'meal', new.id);
      end if;
    elsif new.is_completed = true and coalesce(old.is_completed, false) = false then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'meal', new.id);
    end if;
  elsif tg_table_name = 'daily_exercise_sessions' then
    if tg_op = 'INSERT' then
      if new.is_completed = true or coalesce(new.completed_sets, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
      end if;
    elsif (
      (new.is_completed = true and coalesce(old.is_completed, false) = false)
      or coalesce(new.completed_sets, 0) > coalesce(old.completed_sets, 0)
    ) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
    end if;
  elsif tg_table_name = 'daily_workout_sessions' then
    if tg_op = 'INSERT' then
      if (
        new.started_at is not null
        or new.completed_at is not null
        or new.status in ('started', 'in_progress', 'completed')
      ) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
      end if;
    elsif (
      (new.started_at is not null and old.started_at is null)
      or (new.completed_at is not null and old.completed_at is null)
      or (
        new.status in ('started', 'in_progress', 'completed')
        and coalesce(old.status, '') not in ('started', 'in_progress', 'completed')
      )
    ) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_challenge_checkin_from_activity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_exp_on_meal"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.is_completed = true AND (OLD.is_completed IS DISTINCT FROM true)) OR
     (TG_OP = 'INSERT' AND NEW.is_completed = true) THEN
    PERFORM add_exp(NEW.user_id, 10);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_exp_on_meal"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_exp_on_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  -- Chỉ cộng 1 lần mỗi ngày (INSERT mới)
  IF TG_OP = 'INSERT' THEN
    PERFORM add_exp(NEW.user_id, 5);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_exp_on_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_exp_on_workout"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
BEGIN
  -- Chỉ cộng khi is_completed chuyển sang true
  IF (TG_OP = 'UPDATE' AND NEW.is_completed = true AND (OLD.is_completed IS DISTINCT FROM true)) OR
     (TG_OP = 'INSERT' AND NEW.is_completed = true) THEN
    PERFORM add_exp(NEW.user_id, 20);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_exp_on_workout"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_on_referral"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
DECLARE
  referrer_id   uuid;
  new_count     integer;
  new_tier      text;
BEGIN
  -- Chỉ xử lý khi referred_by được set lần đầu
  IF NEW.referred_by IS NULL OR OLD.referred_by IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Tìm user sở hữu ref_code đó
  SELECT id INTO referrer_id
  FROM profiles
  WHERE ref_code = NEW.referred_by
  LIMIT 1;

  IF referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Không tự mời chính mình
  IF referrer_id = NEW.id THEN
    RETURN NEW;
  END IF;

  -- Tăng referral_count
  UPDATE profiles
  SET referral_count = referral_count + 1,
      updated_at     = now()
  WHERE id = referrer_id
  RETURNING referral_count INTO new_count;

  -- Nâng tier dựa trên mốc (chỉ nâng, không hạ)
  IF new_count >= 20 THEN
    new_tier := 'pro';
  ELSIF new_count >= 5 THEN
    new_tier := 'plus';
  ELSE
    new_tier := NULL;
  END IF;

  IF new_tier IS NOT NULL THEN
    UPDATE profiles
    SET membership_tier = new_tier,
        updated_at      = now()
    WHERE id = referrer_id
      AND (membership_tier IS NULL OR membership_tier = 'free'
           OR (membership_tier = 'plus' AND new_tier = 'pro'));
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_on_referral"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_set_ref_code"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  candidate text;
begin
  if coalesce(new.ref_code, '') <> '' then
    return new;
  end if;

  for attempt in 1..20 loop
    candidate := public.generate_ref_code();
    if not exists (select 1 from public.profiles where ref_code = candidate) then
      new.ref_code := candidate;
      return new;
    end if;
  end loop;

  raise exception 'Unable to generate a unique referral code';
end;
$$;


ALTER FUNCTION "public"."trg_set_ref_code"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "intent" "text",
    "action_type" "text",
    "action_payload" "jsonb",
    "confidence" numeric,
    CONSTRAINT "ai_chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."ai_chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_plan_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "old_plan_id" "uuid",
    "new_plan_id" "uuid",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "plan_type" "text",
    "source_type" "text",
    "source_id" "uuid",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_by" "text" DEFAULT 'ai'::"text",
    "status" "text" DEFAULT 'proposed'::"text",
    "applied_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "chat_message_id" "uuid",
    "apply_idempotency_key" "text",
    CONSTRAINT "ai_plan_adjustments_plan_type_check" CHECK (("plan_type" = ANY (ARRAY['workout'::"text", 'meal'::"text", 'both'::"text"]))),
    CONSTRAINT "ai_plan_adjustments_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'applied'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."ai_plan_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_quota_usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "quota_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "ai_quota_usage_events_quota_key_check" CHECK (("quota_key" = ANY (ARRAY['planGenerations'::"text", 'workoutAdjustments'::"text", 'mealAdjustments'::"text", 'chatMessages'::"text"])))
);


ALTER TABLE "public"."ai_quota_usage_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_recommendations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_type" "text" NOT NULL,
    "recommendation_content" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."ai_recommendations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."body_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "weight" numeric(5,2),
    "height" numeric(5,2),
    "body_fat_percentage" numeric(4,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "target_weight" double precision,
    "body_fat" double precision,
    "chest" double precision,
    "waist" double precision,
    "hips" double precision,
    "neck" numeric(5,1) DEFAULT NULL::numeric
);


ALTER TABLE "public"."body_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_checkins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "checkin_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid",
    "score" integer DEFAULT 1 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenge_checkins_source_type_check" CHECK (("source_type" = ANY (ARRAY['water'::"text", 'meal'::"text", 'workout'::"text", 'sleep'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."challenge_checkins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenge_participants_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."challenge_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenge_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "goal" "text" NOT NULL,
    "duration_days" integer,
    "difficulty" "text" DEFAULT 'medium'::"text" NOT NULL,
    "reward_badge" "text",
    "mode" "text" DEFAULT 'solo'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenge_templates_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['easy'::"text", 'medium'::"text", 'hard'::"text"]))),
    CONSTRAINT "challenge_templates_duration_check" CHECK ((("duration_days" IS NULL) OR (("duration_days" >= 1) AND ("duration_days" <= 365)))),
    CONSTRAINT "challenge_templates_mode_check" CHECK (("mode" = ANY (ARRAY['solo'::"text", 'crew'::"text"])))
);


ALTER TABLE "public"."challenge_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "mode" "text" DEFAULT 'solo'::"text" NOT NULL,
    "challenge_type" "text" DEFAULT 'daily_checkin'::"text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "target" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "invite_code" "text",
    "max_members" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "challenges_date_check" CHECK ((("end_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "challenges_max_members_check" CHECK ((("max_members" >= 1) AND ("max_members" <= 5))),
    CONSTRAINT "challenges_mode_check" CHECK (("mode" = ANY (ARRAY['solo'::"text", 'crew'::"text"]))),
    CONSTRAINT "challenges_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "challenges_type_check" CHECK (("challenge_type" = 'daily_checkin'::"text"))
);


ALTER TABLE "public"."challenges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_exercise_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE,
    "exercise_id" "text",
    "sets" integer DEFAULT 3,
    "reps" "text" DEFAULT '10-12'::"text",
    "weight_kg" numeric DEFAULT 0,
    "rest_seconds" integer DEFAULT 60,
    "order_index" integer,
    "is_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "weekly_plan_exercise_id" "uuid",
    "planned_sets" integer,
    "planned_reps" "text",
    "planned_weight_kg" numeric,
    "planned_rest_seconds" integer,
    "actual_sets" integer,
    "actual_reps" "text",
    "actual_weight_kg" numeric,
    "actual_rest_seconds" integer,
    "target_rpe" numeric(3,1),
    "estimated_kcal" integer DEFAULT 0,
    "actual_kcal_estimated" integer DEFAULT 0,
    "completed_sets" integer DEFAULT 0,
    "load_adjustment_note" "text"
);


ALTER TABLE "public"."daily_exercise_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_exercise_set_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "daily_exercise_session_id" "uuid" NOT NULL,
    "workout_session_exercise_id" "uuid",
    "set_number" integer NOT NULL,
    "planned_reps" "text",
    "target_weight_kg" numeric,
    "actual_reps" integer,
    "actual_weight_kg" numeric,
    "rest_seconds" integer,
    "rpe" numeric(3,1),
    "estimated_kcal" integer DEFAULT 0,
    "notes" "text",
    "is_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."daily_exercise_set_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_meal_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "weekly_food_item_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE,
    "meal_type" "text",
    "quantity" numeric DEFAULT 1,
    "calories" numeric DEFAULT 0,
    "protein" numeric DEFAULT 0,
    "carbs" numeric DEFAULT 0,
    "fat" numeric DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "eaten_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "custom_food_id" "uuid",
    "custom_food_name" "text",
    "source" "text",
    "confidence" "text",
    "image_url" "text",
    "telegram_file_id" "text",
    "notes" "text",
    "ai_estimate" "jsonb",
    "recipe_id" "text",
    CONSTRAINT "daily_meal_logs_meal_type_check" CHECK (("meal_type" = ANY (ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text"])))
);


ALTER TABLE "public"."daily_meal_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_progress_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE,
    "calories_burned" integer DEFAULT 0,
    "calories_consumed" integer DEFAULT 0,
    "workout_duration" integer DEFAULT 0,
    "water_intake_ml" integer DEFAULT 0,
    "sleep_hours" double precision DEFAULT 0
);


ALTER TABLE "public"."daily_progress_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_workout_session_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid",
    "exercise_id" "text",
    "sets" integer DEFAULT 3,
    "reps" "text" DEFAULT '10-12'::"text",
    "weight_kg" numeric DEFAULT 0,
    "rest_seconds" integer DEFAULT 60,
    "order_index" integer NOT NULL,
    "is_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "daily_exercise_session_id" "uuid",
    "weekly_plan_exercise_id" "uuid",
    "planned_sets" integer,
    "planned_reps" "text",
    "planned_weight_kg" numeric,
    "planned_rest_seconds" integer,
    "actual_sets" integer,
    "actual_reps" "text",
    "actual_weight_kg" numeric,
    "actual_rest_seconds" integer,
    "target_rpe" numeric(3,1),
    "estimated_kcal" integer DEFAULT 0,
    "actual_kcal_estimated" integer DEFAULT 0,
    "completed_sets" integer DEFAULT 0
);


ALTER TABLE "public"."daily_workout_session_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_workout_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "weekly_plan_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE,
    "title" "text",
    "duration_minutes" integer DEFAULT 0,
    "calories_burned" integer DEFAULT 0,
    "status" "text" DEFAULT 'planned'::"text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "daily_workout_sessions_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'in_progress'::"text", 'completed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."daily_workout_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "body_part" "text",
    "equipment" "text",
    "target_muscle" "text",
    "instructions" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "secondary_muscles" "jsonb" DEFAULT '[]'::"jsonb",
    "difficulty" "text",
    "goal_type" "text"[],
    "contraindications" "text"[],
    "estimated_duration_seconds" integer,
    "calories_per_minute" numeric,
    "movement_pattern" "text",
    "training_locations" "text"[] DEFAULT ARRAY['home'::"text", 'gym'::"text"] NOT NULL,
    "min_experience_months" smallint DEFAULT 0 NOT NULL,
    "progression_level" smallint DEFAULT 1 NOT NULL,
    "video_url" "text",
    CONSTRAINT "exercises_difficulty_check" CHECK ((("difficulty" IS NULL) OR ("difficulty" = ANY (ARRAY['easy'::"text", 'medium'::"text", 'hard'::"text"])))),
    CONSTRAINT "exercises_min_experience_months_check" CHECK ((("min_experience_months" >= 0) AND ("min_experience_months" <= 120))),
    CONSTRAINT "exercises_progression_level_check" CHECK ((("progression_level" >= 1) AND ("progression_level" <= 5))),
    CONSTRAINT "exercises_training_locations_check" CHECK ((("cardinality"("training_locations") > 0) AND ("training_locations" <@ ARRAY['home'::"text", 'gym'::"text"]) AND ("array_position"("training_locations", NULL::"text") IS NULL) AND (COALESCE("cardinality"("array_positions"("training_locations", 'home'::"text")), 0) <= 1) AND (COALESCE("cardinality"("array_positions"("training_locations", 'gym'::"text")), 0) <= 1)))
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


COMMENT ON COLUMN "public"."exercises"."difficulty" IS 'beginner, intermediate, advanced';



COMMENT ON COLUMN "public"."exercises"."goal_type" IS 'Fitness goals this exercise supports, e.g. fat_loss, muscle_gain, endurance';



COMMENT ON COLUMN "public"."exercises"."contraindications" IS 'Injuries or conditions where this exercise should be avoided';



COMMENT ON COLUMN "public"."exercises"."estimated_duration_seconds" IS 'Estimated time to perform one working set or timed round';



COMMENT ON COLUMN "public"."exercises"."calories_per_minute" IS 'Estimated kcal burned per minute for an average user';



COMMENT ON COLUMN "public"."exercises"."movement_pattern" IS 'Primary movement pattern, e.g. push, pull, squat, hinge, core, cardio';



COMMENT ON COLUMN "public"."exercises"."video_url" IS 'Public direct URL to a browser-playable exercise video (prefer MP4 H.264/AAC).';



CREATE TABLE IF NOT EXISTS "public"."health_conditions" (
    "user_id" "uuid" NOT NULL,
    "medical_history" "text",
    "sleep_hours" numeric(4,2),
    "health_condition" "text",
    "injuries" "text",
    "medications" "text",
    "smoke_drink" "text",
    "stress_level" "text",
    "sleep_quality" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "allergies" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."health_conditions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lifestyle_settings" (
    "user_id" "uuid" NOT NULL,
    "fitness_goal" character varying(50),
    "activity_level" character varying(50),
    "workout_duration" integer,
    "weekly_workouts" integer,
    "daily_water_goal" numeric(3,1),
    "diet_preference" "text",
    "cooking_ability" "text",
    "budget_level" "text",
    "current_diet" "text",
    "workout_location" "text",
    "workout_time" "text",
    "equipment_available" "text",
    "experience_level" "text",
    "motivation" "text",
    "expectations" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "target_calories" integer DEFAULT 0,
    "calories_burn_goal" numeric DEFAULT 500,
    "meals_per_day" integer DEFAULT 3,
    "dietary_restrictions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "diet_styles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "lifestyle_settings_meals_per_day_check" CHECK ((("meals_per_day" IS NULL) OR (("meals_per_day" >= 1) AND ("meals_per_day" <= 8))))
);


ALTER TABLE "public"."lifestyle_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meal_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "weekly_food_item_id" "uuid",
    "feedback_type" "text",
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "meal_feedback_feedback_type_check" CHECK (("feedback_type" = ANY (ARRAY['liked'::"text", 'disliked'::"text", 'too_much'::"text", 'not_enough'::"text", 'hard_to_cook'::"text", 'too_expensive'::"text"])))
);


ALTER TABLE "public"."meal_feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "gender" "text",
    "birthday" "date",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "role" "text" DEFAULT 'user'::"text",
    "telegram_chat_id" "text",
    "membership_tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "ai_coach_free_used_at" timestamp with time zone,
    "exp" integer DEFAULT 0 NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "ref_code" "text",
    "referred_by" "text",
    "referral_count" integer DEFAULT 0 NOT NULL,
    "avatar_url" "text",
    "membership_expires_at" timestamp with time zone,
    "telegram_notify_water" boolean DEFAULT true NOT NULL,
    "telegram_notify_sleep" boolean DEFAULT true NOT NULL,
    "telegram_notify_workout" boolean DEFAULT true NOT NULL,
    "has_purchased_plus" boolean DEFAULT false NOT NULL,
    "has_purchased_pro" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_membership_tier_check" CHECK (("membership_tier" = ANY (ARRAY['free'::"text", 'plus'::"text", 'pro'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."telegram_chat_id" IS 'ID định danh người dùng trên Telegram để gửi thông báo/liên kết';



CREATE TABLE IF NOT EXISTS "public"."recipe_ingredients" (
    "id" bigint NOT NULL,
    "recipe_id" "text" NOT NULL,
    "ingredient_name" "text" NOT NULL,
    "amount" numeric,
    "unit" "text",
    "preparation_note" "text",
    "is_optional" boolean DEFAULT false NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recipe_ingredients" OWNER TO "postgres";


ALTER TABLE "public"."recipe_ingredients" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."recipe_ingredients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "name_en" "text",
    "description" "text",
    "meal_type" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "dietary_restrictions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "diet_styles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "goal_type" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "price_level" "text" DEFAULT 'medium'::"text" NOT NULL,
    "estimated_cost_min_vnd" integer,
    "estimated_cost_max_vnd" integer,
    "calories" numeric,
    "protein" numeric,
    "carbs" numeric,
    "fat" numeric,
    "serving_size" numeric,
    "serving_unit" "text",
    "cooking_time_minutes" integer,
    "cooking_difficulty" "text",
    "allergens" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "instructions" "jsonb" DEFAULT '{"tips": [], "steps": [], "preparation": []}'::"jsonb" NOT NULL,
    "image_url" "text",
    "region" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recipes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."telegram_reminder_dispatches" (
    "reminder_key" "text" NOT NULL,
    "reminder_type" "text" NOT NULL,
    "reminder_date" "date" NOT NULL,
    "slot_label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."telegram_reminder_dispatches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_custom_foods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "normalized_name" "text" NOT NULL,
    "serving_description" "text",
    "calories" numeric DEFAULT 0,
    "protein" numeric DEFAULT 0,
    "carbs" numeric DEFAULT 0,
    "fat" numeric DEFAULT 0,
    "source" "text" DEFAULT 'telegram_photo_ai'::"text",
    "confidence" "text" DEFAULT 'medium'::"text",
    "image_url" "text",
    "telegram_file_id" "text",
    "usage_count" integer DEFAULT 1 NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."user_custom_foods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tone" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "href" "text" DEFAULT '/overview'::"text" NOT NULL,
    "source_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "source_id" "text",
    "dedupe_key" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "user_notifications_tone_check" CHECK (("tone" = ANY (ARRAY['workout'::"text", 'nutrition'::"text", 'coach'::"text", 'progress'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."user_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_food_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "food_plan_id" "uuid",
    "day_of_week" integer NOT NULL,
    "meal_type" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "calories" numeric DEFAULT 0,
    "protein" numeric DEFAULT 0,
    "carbs" numeric DEFAULT 0,
    "fat" numeric DEFAULT 0,
    "order_index" integer NOT NULL,
    "is_rest_day" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "recipe_id" "text",
    CONSTRAINT "weekly_food_items_day_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."weekly_food_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_food_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" DEFAULT 'Diet Plan'::"text",
    "week_start_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "plan_status" "text" DEFAULT 'active'::"text",
    "generated_by" "text" DEFAULT 'ai'::"text",
    "ai_explanation" "text",
    CONSTRAINT "weekly_food_plans_plan_status_check" CHECK (("plan_status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'adjusted'::"text"])))
);


ALTER TABLE "public"."weekly_food_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_plan_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "weekly_plan_id" "uuid",
    "day_of_week" integer NOT NULL,
    "exercise_id" "text",
    "sets" integer DEFAULT 3,
    "reps" "text" DEFAULT '10-12'::"text",
    "weight_kg" numeric DEFAULT 0,
    "rest_seconds" integer DEFAULT 60,
    "order_index" integer NOT NULL,
    "is_rest_day" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "planned_sets" integer,
    "planned_reps" "text",
    "planned_weight_kg" numeric,
    "planned_rest_seconds" integer,
    "target_rpe" numeric(3,1),
    "estimated_kcal" integer DEFAULT 0,
    "ai_note" "text",
    "load_instruction" "text",
    CONSTRAINT "weekly_plan_exercises_day_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."weekly_plan_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" DEFAULT 'Workout Creator'::"text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "week_start_date" "date" DEFAULT ((("date_trunc"('week'::"text", (CURRENT_DATE + '1 day'::interval)))::"date" - '1 day'::interval))::"date" NOT NULL,
    "plan_status" "text" DEFAULT 'active'::"text",
    "generated_by" "text" DEFAULT 'ai'::"text",
    "ai_explanation" "text",
    CONSTRAINT "weekly_plans_plan_status_check" CHECK (("plan_status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'adjusted'::"text"])))
);


ALTER TABLE "public"."weekly_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workout_session_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "session_id" "uuid",
    "difficulty" "text",
    "completed_all" boolean DEFAULT true,
    "pain_area" "text",
    "energy_level" integer,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "workout_session_id" "uuid",
    CONSTRAINT "workout_session_feedback_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['too_easy'::"text", 'just_right'::"text", 'too_hard'::"text"]))),
    CONSTRAINT "workout_session_feedback_energy_level_check" CHECK ((("energy_level" >= 1) AND ("energy_level" <= 5)))
);


ALTER TABLE "public"."workout_session_feedback" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_chat_messages"
    ADD CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_plan_adjustments"
    ADD CONSTRAINT "ai_plan_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_quota_usage_events"
    ADD CONSTRAINT "ai_quota_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_recommendations"
    ADD CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_checkins"
    ADD CONSTRAINT "challenge_checkins_challenge_id_user_id_checkin_date_key" UNIQUE ("challenge_id", "user_id", "checkin_date");



ALTER TABLE ONLY "public"."challenge_checkins"
    ADD CONSTRAINT "challenge_checkins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_challenge_id_user_id_key" UNIQUE ("challenge_id", "user_id");



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_templates"
    ADD CONSTRAINT "challenge_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."challenge_templates"
    ADD CONSTRAINT "challenge_templates_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_exercise_sessions"
    ADD CONSTRAINT "daily_exercise_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_exercise_set_logs"
    ADD CONSTRAINT "daily_exercise_set_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_meal_logs"
    ADD CONSTRAINT "daily_meal_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_progress_logs"
    ADD CONSTRAINT "daily_progress_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_progress_logs"
    ADD CONSTRAINT "daily_progress_logs_user_id_log_date_key" UNIQUE ("user_id", "log_date");



ALTER TABLE ONLY "public"."daily_workout_session_exercises"
    ADD CONSTRAINT "daily_workout_session_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_workout_sessions"
    ADD CONSTRAINT "daily_workout_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."health_conditions"
    ADD CONSTRAINT "health_conditions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."lifestyle_settings"
    ADD CONSTRAINT "lifestyle_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."meal_feedback"
    ADD CONSTRAINT "meal_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_ref_code_key" UNIQUE ("ref_code");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_telegram_chat_id_key" UNIQUE ("telegram_chat_id");



ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."telegram_reminder_dispatches"
    ADD CONSTRAINT "telegram_reminder_dispatches_pkey" PRIMARY KEY ("reminder_key");



ALTER TABLE ONLY "public"."user_custom_foods"
    ADD CONSTRAINT "user_custom_foods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_dedupe_key_key" UNIQUE ("user_id", "dedupe_key");



ALTER TABLE ONLY "public"."weekly_food_items"
    ADD CONSTRAINT "weekly_food_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_food_plans"
    ADD CONSTRAINT "weekly_food_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_plan_exercises"
    ADD CONSTRAINT "weekly_plan_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workout_session_feedback"
    ADD CONSTRAINT "workout_session_feedback_pkey" PRIMARY KEY ("id");



CREATE INDEX "ai_plan_adjustments_source_idx" ON "public"."ai_plan_adjustments" USING "btree" ("source_type", "source_id");



CREATE INDEX "ai_plan_adjustments_user_idx" ON "public"."ai_plan_adjustments" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ai_quota_usage_events_user_key_created_at_idx" ON "public"."ai_quota_usage_events" USING "btree" ("user_id", "quota_key", "created_at" DESC);



CREATE INDEX "ai_recommendations_user_created_at_idx" ON "public"."ai_recommendations" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "challenge_checkins_unique_daily" ON "public"."challenge_checkins" USING "btree" ("challenge_id", "user_id", "checkin_date");



CREATE UNIQUE INDEX "challenge_checkins_unique_source" ON "public"."challenge_checkins" USING "btree" ("challenge_id", "user_id", "source_type", "source_id") WHERE ("source_id" IS NOT NULL);



CREATE INDEX "daily_exercise_sessions_weekly_plan_exercise_idx" ON "public"."daily_exercise_sessions" USING "btree" ("weekly_plan_exercise_id");



CREATE UNIQUE INDEX "daily_exercise_set_logs_session_set_unique" ON "public"."daily_exercise_set_logs" USING "btree" ("daily_exercise_session_id", "set_number");



CREATE INDEX "daily_exercise_set_logs_workout_session_idx" ON "public"."daily_exercise_set_logs" USING "btree" ("workout_session_exercise_id");



CREATE INDEX "daily_meal_logs_user_custom_food_idx" ON "public"."daily_meal_logs" USING "btree" ("user_id", "custom_food_id");



CREATE INDEX "daily_workout_session_exercises_daily_session_idx" ON "public"."daily_workout_session_exercises" USING "btree" ("daily_exercise_session_id");



CREATE INDEX "exercises_body_part_idx" ON "public"."exercises" USING "btree" ("body_part");



CREATE INDEX "exercises_contraindications_gin_idx" ON "public"."exercises" USING "gin" ("contraindications");



CREATE INDEX "exercises_difficulty_idx" ON "public"."exercises" USING "btree" ("difficulty");



CREATE INDEX "exercises_equipment_idx" ON "public"."exercises" USING "btree" ("equipment");



CREATE INDEX "exercises_goal_type_gin_idx" ON "public"."exercises" USING "gin" ("goal_type");



CREATE INDEX "exercises_movement_pattern_idx" ON "public"."exercises" USING "btree" ("movement_pattern");



CREATE INDEX "exercises_target_muscle_idx" ON "public"."exercises" USING "btree" ("target_muscle");



CREATE INDEX "exercises_training_locations_gin_idx" ON "public"."exercises" USING "gin" ("training_locations");



CREATE INDEX "idx_ai_chat_messages_user" ON "public"."ai_chat_messages" USING "btree" ("user_id", "created_at");



CREATE INDEX "idx_ai_chat_messages_user_created_at" ON "public"."ai_chat_messages" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_ai_plan_adjustments_user_created_at" ON "public"."ai_plan_adjustments" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_challenge_checkins_challenge_id" ON "public"."challenge_checkins" USING "btree" ("challenge_id");



CREATE INDEX "idx_challenge_checkins_user_date" ON "public"."challenge_checkins" USING "btree" ("user_id", "checkin_date");



CREATE INDEX "idx_challenge_participants_challenge_id" ON "public"."challenge_participants" USING "btree" ("challenge_id");



CREATE INDEX "idx_challenge_participants_user_id" ON "public"."challenge_participants" USING "btree" ("user_id");



CREATE INDEX "idx_challenges_created_by" ON "public"."challenges" USING "btree" ("created_by");



CREATE INDEX "idx_challenges_invite_code" ON "public"."challenges" USING "btree" ("invite_code");



CREATE INDEX "idx_daily_exercise_sessions_user_date" ON "public"."daily_exercise_sessions" USING "btree" ("user_id", "log_date");



CREATE INDEX "idx_daily_meal_logs_user_date" ON "public"."daily_meal_logs" USING "btree" ("user_id", "log_date");



CREATE INDEX "idx_daily_workout_session_exercises_session" ON "public"."daily_workout_session_exercises" USING "btree" ("session_id");



CREATE INDEX "idx_daily_workout_sessions_user_date" ON "public"."daily_workout_sessions" USING "btree" ("user_id", "log_date");



CREATE INDEX "idx_weekly_plan_exercises_plan_day" ON "public"."weekly_plan_exercises" USING "btree" ("weekly_plan_id", "day_of_week", "order_index");



CREATE UNIQUE INDEX "idx_weekly_plans_user_week" ON "public"."weekly_plans" USING "btree" ("user_id", "week_start_date") WHERE ("plan_status" = 'active'::"text");



CREATE INDEX "meal_feedback_item_idx" ON "public"."meal_feedback" USING "btree" ("weekly_food_item_id");



CREATE INDEX "meal_feedback_user_idx" ON "public"."meal_feedback" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "profiles_telegram_chat_id_unique_idx" ON "public"."profiles" USING "btree" ("telegram_chat_id") WHERE ("telegram_chat_id" IS NOT NULL);



CREATE INDEX "recipe_ingredients_recipe_idx" ON "public"."recipe_ingredients" USING "btree" ("recipe_id");



CREATE INDEX "recipes_active_idx" ON "public"."recipes" USING "btree" ("is_active");



CREATE INDEX "telegram_reminder_dispatches_lookup_idx" ON "public"."telegram_reminder_dispatches" USING "btree" ("reminder_type", "reminder_date");



CREATE UNIQUE INDEX "uq_ai_plan_adjustments_user_apply_idempotency" ON "public"."ai_plan_adjustments" USING "btree" ("user_id", "apply_idempotency_key") WHERE ("apply_idempotency_key" IS NOT NULL);



CREATE INDEX "user_custom_foods_user_id_idx" ON "public"."user_custom_foods" USING "btree" ("user_id");



CREATE INDEX "user_custom_foods_user_last_used_idx" ON "public"."user_custom_foods" USING "btree" ("user_id", "last_used_at" DESC);



CREATE UNIQUE INDEX "user_custom_foods_user_normalized_name_idx" ON "public"."user_custom_foods" USING "btree" ("user_id", "normalized_name");



CREATE INDEX "user_notifications_user_created_idx" ON "public"."user_notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "user_notifications_user_unread_idx" ON "public"."user_notifications" USING "btree" ("user_id", "read_at") WHERE ("read_at" IS NULL);



CREATE INDEX "workout_session_feedback_session_idx" ON "public"."workout_session_feedback" USING "btree" ("session_id");



CREATE INDEX "workout_session_feedback_user_idx" ON "public"."workout_session_feedback" USING "btree" ("user_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "challenge_checkin_from_exercise" AFTER INSERT OR UPDATE OF "is_completed", "completed_sets" ON "public"."daily_exercise_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_challenge_checkin_from_activity"();



CREATE OR REPLACE TRIGGER "challenge_checkin_from_meal" AFTER INSERT OR UPDATE OF "is_completed" ON "public"."daily_meal_logs" FOR EACH ROW EXECUTE FUNCTION "public"."sync_challenge_checkin_from_activity"();



CREATE OR REPLACE TRIGGER "challenge_checkin_from_progress" AFTER INSERT OR UPDATE OF "water_intake_ml", "sleep_hours" ON "public"."daily_progress_logs" FOR EACH ROW EXECUTE FUNCTION "public"."sync_challenge_checkin_from_activity"();



CREATE OR REPLACE TRIGGER "challenge_checkin_from_workout" AFTER INSERT OR UPDATE OF "started_at", "completed_at", "status" ON "public"."daily_workout_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."sync_challenge_checkin_from_activity"();



CREATE OR REPLACE TRIGGER "create_default_solo_challenge" AFTER INSERT ON "public"."lifestyle_settings" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_solo_after_onboarding"();



CREATE OR REPLACE TRIGGER "exp_on_meal" AFTER INSERT OR UPDATE OF "is_completed" ON "public"."daily_meal_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trg_exp_on_meal"();



CREATE OR REPLACE TRIGGER "exp_on_progress" AFTER INSERT ON "public"."daily_progress_logs" FOR EACH ROW EXECUTE FUNCTION "public"."trg_exp_on_progress"();



CREATE OR REPLACE TRIGGER "exp_on_workout" AFTER INSERT OR UPDATE OF "is_completed" ON "public"."daily_exercise_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."trg_exp_on_workout"();



CREATE OR REPLACE TRIGGER "guard_profile_system_fields" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_system_fields"();



CREATE OR REPLACE TRIGGER "localize_default_challenge_copy" BEFORE INSERT OR UPDATE OF "title", "description" ON "public"."challenges" FOR EACH ROW EXECUTE FUNCTION "public"."localize_default_challenge_copy"();



CREATE OR REPLACE TRIGGER "on_referral" AFTER UPDATE OF "referred_by" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_on_referral"();



CREATE OR REPLACE TRIGGER "set_ref_code" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."trg_set_ref_code"();



ALTER TABLE ONLY "public"."ai_chat_messages"
    ADD CONSTRAINT "ai_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_plan_adjustments"
    ADD CONSTRAINT "ai_plan_adjustments_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "public"."ai_chat_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_plan_adjustments"
    ADD CONSTRAINT "ai_plan_adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_quota_usage_events"
    ADD CONSTRAINT "ai_quota_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_recommendations"
    ADD CONSTRAINT "ai_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."body_metrics"
    ADD CONSTRAINT "body_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_checkins"
    ADD CONSTRAINT "challenge_checkins_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_checkins"
    ADD CONSTRAINT "challenge_checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenge_participants"
    ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."challenges"
    ADD CONSTRAINT "challenges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_exercise_sessions"
    ADD CONSTRAINT "daily_exercise_sessions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."daily_exercise_sessions"
    ADD CONSTRAINT "daily_exercise_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_exercise_set_logs"
    ADD CONSTRAINT "daily_exercise_set_logs_daily_exercise_session_id_fkey" FOREIGN KEY ("daily_exercise_session_id") REFERENCES "public"."daily_exercise_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_exercise_set_logs"
    ADD CONSTRAINT "daily_exercise_set_logs_workout_session_exercise_id_fkey" FOREIGN KEY ("workout_session_exercise_id") REFERENCES "public"."daily_workout_session_exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_meal_logs"
    ADD CONSTRAINT "daily_meal_logs_custom_food_id_fkey" FOREIGN KEY ("custom_food_id") REFERENCES "public"."user_custom_foods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_meal_logs"
    ADD CONSTRAINT "daily_meal_logs_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_meal_logs"
    ADD CONSTRAINT "daily_meal_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_meal_logs"
    ADD CONSTRAINT "daily_meal_logs_weekly_food_item_id_fkey" FOREIGN KEY ("weekly_food_item_id") REFERENCES "public"."weekly_food_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_progress_logs"
    ADD CONSTRAINT "daily_progress_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_workout_session_exercises"
    ADD CONSTRAINT "daily_workout_session_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."daily_workout_session_exercises"
    ADD CONSTRAINT "daily_workout_session_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."daily_workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_workout_sessions"
    ADD CONSTRAINT "daily_workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_workout_sessions"
    ADD CONSTRAINT "daily_workout_sessions_weekly_plan_id_fkey" FOREIGN KEY ("weekly_plan_id") REFERENCES "public"."weekly_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."health_conditions"
    ADD CONSTRAINT "health_conditions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lifestyle_settings"
    ADD CONSTRAINT "lifestyle_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_feedback"
    ADD CONSTRAINT "meal_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_feedback"
    ADD CONSTRAINT "meal_feedback_weekly_food_item_id_fkey" FOREIGN KEY ("weekly_food_item_id") REFERENCES "public"."weekly_food_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_ingredients"
    ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_custom_foods"
    ADD CONSTRAINT "user_custom_foods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_food_items"
    ADD CONSTRAINT "weekly_food_items_food_plan_id_fkey" FOREIGN KEY ("food_plan_id") REFERENCES "public"."weekly_food_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_food_items"
    ADD CONSTRAINT "weekly_food_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."weekly_food_plans"
    ADD CONSTRAINT "weekly_food_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_plan_exercises"
    ADD CONSTRAINT "weekly_plan_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id");



ALTER TABLE ONLY "public"."weekly_plan_exercises"
    ADD CONSTRAINT "weekly_plan_exercises_weekly_plan_id_fkey" FOREIGN KEY ("weekly_plan_id") REFERENCES "public"."weekly_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_session_feedback"
    ADD CONSTRAINT "workout_session_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."daily_exercise_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_session_feedback"
    ADD CONSTRAINT "workout_session_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workout_session_feedback"
    ADD CONSTRAINT "workout_session_feedback_workout_session_id_fkey" FOREIGN KEY ("workout_session_id") REFERENCES "public"."daily_workout_sessions"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_plan_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_quota_usage_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_recommendations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."body_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."challenge_checkins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "challenge_checkins_member_select" ON "public"."challenge_checkins" FOR SELECT TO "authenticated" USING ("public"."is_challenge_participant"("challenge_id"));



CREATE POLICY "challenge_checkins_self_insert" ON "public"."challenge_checkins" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_challenge_participant"("challenge_id")));



ALTER TABLE "public"."challenge_participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "challenge_participants_member_select" ON "public"."challenge_participants" FOR SELECT TO "authenticated" USING ("public"."is_challenge_participant"("challenge_id"));



ALTER TABLE "public"."challenge_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "challenge_templates_authenticated_select" ON "public"."challenge_templates" FOR SELECT TO "authenticated" USING (("is_active" = true));



ALTER TABLE "public"."challenges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "challenges_creator_delete" ON "public"."challenges" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "challenges_creator_insert" ON "public"."challenges" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "challenges_creator_update" ON "public"."challenges" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "challenges_participant_select" ON "public"."challenges" FOR SELECT TO "authenticated" USING ("public"."is_challenge_participant"("id"));



ALTER TABLE "public"."daily_exercise_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_exercise_set_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_exercise_set_logs_owner" ON "public"."daily_exercise_set_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."daily_exercise_sessions" "session"
  WHERE (("session"."id" = "daily_exercise_set_logs"."daily_exercise_session_id") AND ("session"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."daily_exercise_sessions" "session"
  WHERE (("session"."id" = "daily_exercise_set_logs"."daily_exercise_session_id") AND ("session"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."daily_meal_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_progress_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_workout_session_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_workout_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercises_authenticated_select" ON "public"."exercises" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."health_conditions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lifestyle_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meal_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner_policy" ON "public"."ai_chat_messages" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."ai_plan_adjustments" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."body_metrics" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."daily_exercise_sessions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."daily_meal_logs" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."daily_progress_logs" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."daily_workout_session_exercises" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."daily_workout_sessions" "ws"
  WHERE (("ws"."id" = "daily_workout_session_exercises"."session_id") AND ("ws"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."daily_workout_sessions" "ws"
  WHERE (("ws"."id" = "daily_workout_session_exercises"."session_id") AND ("ws"."user_id" = "auth"."uid"())))));



CREATE POLICY "owner_policy" ON "public"."daily_workout_sessions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."health_conditions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."lifestyle_settings" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."meal_feedback" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."user_custom_foods" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."user_notifications" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."weekly_food_items" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."weekly_food_plans" "wfp"
  WHERE (("wfp"."id" = "weekly_food_items"."food_plan_id") AND ("wfp"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."weekly_food_plans" "wfp"
  WHERE (("wfp"."id" = "weekly_food_items"."food_plan_id") AND ("wfp"."user_id" = "auth"."uid"())))));



CREATE POLICY "owner_policy" ON "public"."weekly_food_plans" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."weekly_plan_exercises" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."weekly_plans" "wp"
  WHERE (("wp"."id" = "weekly_plan_exercises"."weekly_plan_id") AND ("wp"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."weekly_plans" "wp"
  WHERE (("wp"."id" = "weekly_plan_exercises"."weekly_plan_id") AND ("wp"."user_id" = "auth"."uid"())))));



CREATE POLICY "owner_policy" ON "public"."weekly_plans" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_policy" ON "public"."workout_session_feedback" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_owner_insert" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "profiles_owner_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "profiles_owner_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."recipe_ingredients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recipe_ingredients_authenticated_select" ON "public"."recipe_ingredients" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."recipes"
  WHERE (("recipes"."id" = "recipe_ingredients"."recipe_id") AND ("recipes"."is_active" = true)))));



ALTER TABLE "public"."recipes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recipes_authenticated_select" ON "public"."recipes" FOR SELECT TO "authenticated" USING (("is_active" = true));



ALTER TABLE "public"."telegram_reminder_dispatches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_custom_foods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_food_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_food_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_plan_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workout_session_feedback" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_exp"("p_user_id" "uuid", "p_amount" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_exp"("p_user_id" "uuid", "p_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_workout_adjustment_atomically"("p_adjustment_id" "uuid", "p_user_id" "uuid", "p_idempotency_key" "text", "p_weekly_plan_id" "uuid", "p_day_of_week" integer, "p_log_date" "date", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_workout_adjustment_atomically"("p_adjustment_id" "uuid", "p_user_id" "uuid", "p_idempotency_key" "text", "p_weekly_plan_id" "uuid", "p_day_of_week" integer, "p_log_date" "date", "p_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_level"("p_exp" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_level"("p_exp" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_crew_challenge"("p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_crew_challenge"("p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_crew_challenge"("p_title" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_custom_challenge"("p_title" "text", "p_description" "text", "p_mode" "text", "p_duration_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_custom_challenge"("p_title" "text", "p_description" "text", "p_mode" "text", "p_duration_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_custom_challenge"("p_title" "text", "p_description" "text", "p_mode" "text", "p_duration_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_default_solo_after_onboarding"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_default_solo_after_onboarding"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_solo_challenge"("p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_solo_challenge"("p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_solo_challenge"("p_title" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_active_solo_challenge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_active_solo_challenge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_active_solo_challenge"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_default_solo_challenge_for_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_default_solo_challenge_for_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_ref_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_ref_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_challenge_participant_progress"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_challenge_participant_progress"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_challenge_participant_progress"("p_challenge_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_challenge_summaries"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_challenge_summaries"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_challenge_summaries"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_profile_system_fields"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_profile_system_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_challenge_participant"("target_challenge_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_challenge_participant"("target_challenge_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_challenge_by_invite_code"("p_invite_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_challenge_by_invite_code"("p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_challenge_by_invite_code"("p_invite_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."leave_challenge"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."leave_challenge"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_challenge"("p_challenge_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."localize_default_challenge_copy"() TO "anon";
GRANT ALL ON FUNCTION "public"."localize_default_challenge_copy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."localize_default_challenge_copy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."manual_challenge_checkin"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."manual_challenge_checkin"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."manual_challenge_checkin"("p_challenge_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."materialize_daily_workout_from_plan_atomically"("p_user_id" "uuid", "p_weekly_plan_id" "uuid", "p_log_date" "date", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."materialize_daily_workout_from_plan_atomically"("p_user_id" "uuid", "p_weekly_plan_id" "uuid", "p_log_date" "date", "p_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_challenge_template"("p_template_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_challenge_template"("p_template_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_challenge_template"("p_template_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_challenge_checkin"("p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_challenge_checkin"("p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_challenge_checkin"("p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_challenge_checkin_for_user"("p_user_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_challenge_checkin_for_user"("p_user_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_challenge_checkin_from_activity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_challenge_checkin_from_activity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_exp_on_meal"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_exp_on_meal"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_exp_on_progress"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_exp_on_progress"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_exp_on_workout"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_exp_on_workout"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_on_referral"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_on_referral"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_set_ref_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_set_ref_code"() TO "service_role";



GRANT ALL ON TABLE "public"."ai_chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."ai_plan_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_plan_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."ai_quota_usage_events" TO "service_role";



GRANT ALL ON TABLE "public"."ai_recommendations" TO "service_role";



GRANT ALL ON TABLE "public"."body_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."body_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_checkins" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_checkins" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_participants" TO "service_role";



GRANT ALL ON TABLE "public"."challenge_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."challenge_templates" TO "service_role";



GRANT ALL ON TABLE "public"."challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."challenges" TO "service_role";



GRANT ALL ON TABLE "public"."daily_exercise_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_exercise_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."daily_exercise_set_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_exercise_set_logs" TO "service_role";



GRANT ALL ON TABLE "public"."daily_meal_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_meal_logs" TO "service_role";



GRANT ALL ON TABLE "public"."daily_progress_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_progress_logs" TO "service_role";



GRANT ALL ON TABLE "public"."daily_workout_session_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_workout_session_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."daily_workout_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_workout_sessions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."health_conditions" TO "authenticated";
GRANT ALL ON TABLE "public"."health_conditions" TO "service_role";



GRANT ALL ON TABLE "public"."lifestyle_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."lifestyle_settings" TO "service_role";



GRANT ALL ON TABLE "public"."meal_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."meal_feedback" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT INSERT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("full_name"),UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("email"),UPDATE("email") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("gender"),UPDATE("gender") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("birthday"),UPDATE("birthday") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("updated_at"),UPDATE("updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("telegram_chat_id"),UPDATE("telegram_chat_id") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("referred_by"),UPDATE("referred_by") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("avatar_url"),UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("telegram_notify_water"),UPDATE("telegram_notify_water") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("telegram_notify_sleep"),UPDATE("telegram_notify_sleep") ON TABLE "public"."profiles" TO "authenticated";



GRANT INSERT("telegram_notify_workout"),UPDATE("telegram_notify_workout") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."recipe_ingredients" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_ingredients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recipe_ingredients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recipe_ingredients_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";



GRANT ALL ON TABLE "public"."telegram_reminder_dispatches" TO "service_role";



GRANT ALL ON TABLE "public"."user_custom_foods" TO "authenticated";
GRANT ALL ON TABLE "public"."user_custom_foods" TO "service_role";



GRANT ALL ON TABLE "public"."user_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_food_items" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_food_items" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_food_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_food_plans" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_plan_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_plan_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_plans" TO "service_role";



GRANT ALL ON TABLE "public"."workout_session_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."workout_session_feedback" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
