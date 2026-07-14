alter table public.weekly_plan_exercises
  add column if not exists planned_sets integer,
  add column if not exists planned_reps text,
  add column if not exists planned_weight_kg numeric,
  add column if not exists planned_rest_seconds integer,
  add column if not exists target_rpe numeric(3,1),
  add column if not exists estimated_kcal integer default 0,
  add column if not exists ai_note text,
  add column if not exists load_instruction text;

update public.weekly_plan_exercises
set
  planned_sets = coalesce(planned_sets, sets),
  planned_reps = coalesce(planned_reps, reps),
  planned_weight_kg = coalesce(planned_weight_kg, weight_kg),
  planned_rest_seconds = coalesce(planned_rest_seconds, rest_seconds),
  target_rpe = coalesce(target_rpe, 7.0),
  estimated_kcal = coalesce(estimated_kcal, 0)
where
  planned_sets is null
  or planned_reps is null
  or planned_weight_kg is null
  or planned_rest_seconds is null
  or target_rpe is null
  or estimated_kcal is null;

alter table public.daily_exercise_sessions
  add column if not exists weekly_plan_exercise_id uuid,
  add column if not exists planned_sets integer,
  add column if not exists planned_reps text,
  add column if not exists planned_weight_kg numeric,
  add column if not exists planned_rest_seconds integer,
  add column if not exists actual_sets integer,
  add column if not exists actual_reps text,
  add column if not exists actual_weight_kg numeric,
  add column if not exists actual_rest_seconds integer,
  add column if not exists target_rpe numeric(3,1),
  add column if not exists estimated_kcal integer default 0,
  add column if not exists actual_kcal_estimated integer default 0,
  add column if not exists completed_sets integer default 0,
  add column if not exists load_adjustment_note text;

update public.daily_exercise_sessions
set
  planned_sets = coalesce(planned_sets, sets),
  planned_reps = coalesce(planned_reps, reps),
  planned_weight_kg = coalesce(planned_weight_kg, weight_kg),
  planned_rest_seconds = coalesce(planned_rest_seconds, rest_seconds),
  actual_sets = coalesce(actual_sets, sets),
  actual_reps = coalesce(actual_reps, reps),
  actual_weight_kg = coalesce(actual_weight_kg, weight_kg),
  actual_rest_seconds = coalesce(actual_rest_seconds, rest_seconds),
  target_rpe = coalesce(target_rpe, 7.0),
  estimated_kcal = coalesce(estimated_kcal, 0),
  actual_kcal_estimated = coalesce(actual_kcal_estimated, 0),
  completed_sets = coalesce(completed_sets, case when is_completed then greatest(sets, 0) else 0 end)
where
  planned_sets is null
  or planned_reps is null
  or planned_weight_kg is null
  or planned_rest_seconds is null
  or actual_sets is null
  or actual_reps is null
  or actual_weight_kg is null
  or actual_rest_seconds is null
  or target_rpe is null
  or estimated_kcal is null
  or actual_kcal_estimated is null
  or completed_sets is null;

alter table public.daily_workout_session_exercises
  add column if not exists daily_exercise_session_id uuid,
  add column if not exists weekly_plan_exercise_id uuid,
  add column if not exists planned_sets integer,
  add column if not exists planned_reps text,
  add column if not exists planned_weight_kg numeric,
  add column if not exists planned_rest_seconds integer,
  add column if not exists actual_sets integer,
  add column if not exists actual_reps text,
  add column if not exists actual_weight_kg numeric,
  add column if not exists actual_rest_seconds integer,
  add column if not exists target_rpe numeric(3,1),
  add column if not exists estimated_kcal integer default 0,
  add column if not exists actual_kcal_estimated integer default 0,
  add column if not exists completed_sets integer default 0;

update public.daily_workout_session_exercises
set
  planned_sets = coalesce(planned_sets, sets),
  planned_reps = coalesce(planned_reps, reps),
  planned_weight_kg = coalesce(planned_weight_kg, weight_kg),
  planned_rest_seconds = coalesce(planned_rest_seconds, rest_seconds),
  actual_sets = coalesce(actual_sets, sets),
  actual_reps = coalesce(actual_reps, reps),
  actual_weight_kg = coalesce(actual_weight_kg, weight_kg),
  actual_rest_seconds = coalesce(actual_rest_seconds, rest_seconds),
  target_rpe = coalesce(target_rpe, 7.0),
  estimated_kcal = coalesce(estimated_kcal, 0),
  actual_kcal_estimated = coalesce(actual_kcal_estimated, 0),
  completed_sets = coalesce(completed_sets, case when is_completed then greatest(sets, 0) else 0 end)
where
  planned_sets is null
  or planned_reps is null
  or planned_weight_kg is null
  or planned_rest_seconds is null
  or actual_sets is null
  or actual_reps is null
  or actual_weight_kg is null
  or actual_rest_seconds is null
  or target_rpe is null
  or estimated_kcal is null
  or actual_kcal_estimated is null
  or completed_sets is null;

create table if not exists public.daily_exercise_set_logs (
  id uuid not null default gen_random_uuid() primary key,
  daily_exercise_session_id uuid not null,
  workout_session_exercise_id uuid,
  set_number integer not null,
  planned_reps text,
  target_weight_kg numeric,
  actual_reps integer,
  actual_weight_kg numeric,
  rest_seconds integer,
  rpe numeric(3,1),
  estimated_kcal integer default 0,
  notes text,
  is_completed boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_exercise_set_logs_daily_exercise_session_id_fkey'
  ) then
    alter table public.daily_exercise_set_logs
      add constraint daily_exercise_set_logs_daily_exercise_session_id_fkey
      foreign key (daily_exercise_session_id)
      references public.daily_exercise_sessions(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_exercise_set_logs_workout_session_exercise_id_fkey'
  ) then
    alter table public.daily_exercise_set_logs
      add constraint daily_exercise_set_logs_workout_session_exercise_id_fkey
      foreign key (workout_session_exercise_id)
      references public.daily_workout_session_exercises(id)
      on delete set null;
  end if;
end $$;

create unique index if not exists daily_exercise_set_logs_session_set_unique
  on public.daily_exercise_set_logs(daily_exercise_session_id, set_number);

create index if not exists daily_exercise_sessions_weekly_plan_exercise_idx
  on public.daily_exercise_sessions(weekly_plan_exercise_id);

create index if not exists daily_workout_session_exercises_daily_session_idx
  on public.daily_workout_session_exercises(daily_exercise_session_id);

create index if not exists daily_exercise_set_logs_workout_session_idx
  on public.daily_exercise_set_logs(workout_session_exercise_id);
