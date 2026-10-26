begin;
alter table public.daily_exercise_sessions add column version bigint not null default 0;
create function public.bump_workout_version() returns trigger language plpgsql set search_path = '' as $$
begin new.version := old.version + 1; return new; end;
$$;
revoke all on function public.bump_workout_version() from public, anon, authenticated;
create trigger workout_server_version before update on public.daily_exercise_sessions for each row execute function public.bump_workout_version();

create function public.record_workout_progress_atomically(
  p_user_id uuid, p_session_id uuid, p_expected_version bigint, p_target_sets integer,
  p_actual_kcal integer, p_rest_seconds integer, p_mode text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare exercise public.daily_exercise_sessions%rowtype; workout public.daily_workout_sessions%rowtype;
  snapshot_id uuid; total_sets integer; kcal integer; has_progress boolean; all_complete boolean; set_index integer;
begin
  select * into exercise from public.daily_exercise_sessions where id = p_session_id and user_id = p_user_id;
  if not found then raise exception using errcode = '42501', message = 'Session not found'; end if;
  -- Serialize totals across every exercise for this user/day, including cases
  -- where the daily progress row does not exist yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || exercise.log_date::text, 0));
  select * into exercise from public.daily_exercise_sessions where id = p_session_id and user_id = p_user_id for update;
  total_sets := greatest(1, coalesce(exercise.actual_sets,exercise.sets,1));
  if p_mode not in ('set','completion') or p_target_sets < 0 or p_target_sets > total_sets
    or p_actual_kcal < 0 or p_rest_seconds not between 0 and 300 then raise exception 'Invalid progress'; end if;
  if p_mode = 'set' and p_target_sets <= coalesce(exercise.completed_sets,0) then
    return jsonb_build_object('already_recorded',true,'session_id',exercise.id);
  end if;
  if exercise.version <> p_expected_version or (p_mode = 'set' and p_target_sets <> coalesce(exercise.completed_sets,0) + 1) then
    raise exception using errcode = '40001', message = 'Session changed; reload';
  end if;
  update public.daily_exercise_sessions set completed_sets = p_target_sets, actual_kcal_estimated = p_actual_kcal,
    is_completed = p_target_sets >= total_sets where id = exercise.id returning * into exercise;
  select * into workout from public.daily_workout_sessions where user_id = p_user_id and log_date = exercise.log_date
    order by started_at desc nulls last, id limit 1 for update;
  if workout.id is not null then
    select id into snapshot_id from public.daily_workout_session_exercises where session_id = workout.id
      and daily_exercise_session_id = exercise.id order by id limit 1 for update;
    if snapshot_id is null then
      insert into public.daily_workout_session_exercises(session_id,daily_exercise_session_id,exercise_id,order_index)
        values(workout.id,exercise.id,exercise.exercise_id,coalesce(exercise.order_index,0)) returning id into snapshot_id;
    end if;
    update public.daily_workout_session_exercises set exercise_id = exercise.exercise_id,
      sets = exercise.sets, reps = exercise.reps, weight_kg = exercise.weight_kg, rest_seconds = exercise.rest_seconds,
      planned_sets = exercise.planned_sets, planned_reps = exercise.planned_reps, planned_weight_kg = exercise.planned_weight_kg,
      planned_rest_seconds = exercise.planned_rest_seconds, actual_sets = exercise.actual_sets, actual_reps = exercise.actual_reps,
      actual_weight_kg = exercise.actual_weight_kg, actual_rest_seconds = exercise.actual_rest_seconds, target_rpe = exercise.target_rpe,
      estimated_kcal = exercise.estimated_kcal, actual_kcal_estimated = exercise.actual_kcal_estimated,
      completed_sets = exercise.completed_sets, is_completed = exercise.is_completed where id = snapshot_id;
  end if;
  if p_mode = 'completion' then delete from public.daily_exercise_set_logs where daily_exercise_session_id = exercise.id and set_number > p_target_sets; end if;
  if p_target_sets > 0 then
    for set_index in (case when p_mode = 'set' then p_target_sets else 1 end)..p_target_sets loop
      insert into public.daily_exercise_set_logs(daily_exercise_session_id,workout_session_exercise_id,set_number,
        planned_reps,target_weight_kg,actual_reps,actual_weight_kg,rest_seconds,estimated_kcal,is_completed)
      values(exercise.id,snapshot_id,set_index,coalesce(exercise.planned_reps,exercise.reps,''),
        coalesce(exercise.planned_weight_kg,exercise.weight_kg),
        greatest(1,coalesce(nullif(substring(coalesce(exercise.actual_reps,exercise.reps,'10') from '[0-9]+'),''),'10')::integer),
        coalesce(exercise.actual_weight_kg,exercise.weight_kg),p_rest_seconds,
        greatest(0,round(p_actual_kcal::numeric/greatest(1,p_target_sets)))::integer,true)
      on conflict(daily_exercise_session_id,set_number) do update set
        workout_session_exercise_id = excluded.workout_session_exercise_id, actual_reps = excluded.actual_reps,
        actual_weight_kg = excluded.actual_weight_kg, rest_seconds = excluded.rest_seconds,
        estimated_kcal = excluded.estimated_kcal, is_completed = true;
    end loop;
  end if;
  select coalesce(sum(case when coalesce(actual_kcal_estimated,0) > 0 then actual_kcal_estimated
    when is_completed then greatest(0,coalesce(estimated_kcal,0)) else 0 end),0)::integer,
    coalesce(bool_or(is_completed or completed_sets > 0),false),
    coalesce(bool_and(is_completed or coalesce(completed_sets,0) >= greatest(1,coalesce(actual_sets,sets,1))),false)
    into kcal,has_progress,all_complete from public.daily_exercise_sessions where user_id = p_user_id and log_date = exercise.log_date;
  insert into public.daily_progress_logs(user_id,log_date,calories_burned) values(p_user_id,exercise.log_date,kcal)
    on conflict(user_id,log_date) do update set calories_burned = excluded.calories_burned;
  if workout.id is not null then
    update public.daily_workout_sessions set calories_burned = kcal,
      status = case when all_complete then 'completed' when has_progress then 'in_progress' else 'planned' end,
      started_at = case when has_progress then coalesce(started_at,now()) else started_at end,
      completed_at = case when all_complete then coalesce(completed_at,now()) else null end where id = workout.id;
  end if;
  return jsonb_build_object('already_recorded',false,'session_id',exercise.id);
end;
$$;
revoke all on function public.record_workout_progress_atomically(uuid,uuid,bigint,integer,integer,integer,text) from public, anon, authenticated;
grant execute on function public.record_workout_progress_atomically(uuid,uuid,bigint,integer,integer,integer,text) to service_role;
commit;
