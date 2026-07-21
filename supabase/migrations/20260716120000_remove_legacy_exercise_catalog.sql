-- Replace exactly the legacy 100-exercise catalog. The related plan/session
-- rows are exercise data too, so remove them before deleting their catalog rows.
do $fitly_remove_legacy_catalog$
declare
  legacy_count integer;
begin
  select count(*) into legacy_count
  from public.exercises
  where id like 'vn\_%' escape '\';

  if legacy_count <> 100 then
    raise exception 'Expected exactly 100 legacy vn_* exercises, found %. Refusing to delete.', legacy_count;
  end if;

  delete from public.daily_workout_session_exercises
  where exercise_id like 'vn\_%' escape '\';

  delete from public.daily_exercise_sessions
  where exercise_id like 'vn\_%' escape '\';

  delete from public.weekly_plan_exercises
  where exercise_id like 'vn\_%' escape '\';

  delete from public.exercises
  where id like 'vn\_%' escape '\';
end
$fitly_remove_legacy_catalog$;
