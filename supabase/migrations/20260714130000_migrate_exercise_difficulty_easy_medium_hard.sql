begin;

-- Existing rows keep their IDs, progression level, and experience gate. Only
-- the descriptive difficulty taxonomy changes.
do $fitly_difficulty$
declare
  v_constraint record;
begin
  -- A legacy installation can have a differently named CHECK constraint.
  -- Remove only CHECK constraints that mention this column before writing the
  -- canonical keys, then recreate one stable constraint below.
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.exercises'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%difficulty%'
  loop
    execute format('alter table public.exercises drop constraint %I', v_constraint.conname);
  end loop;
end
$fitly_difficulty$;

update public.exercises
set
  difficulty = case difficulty
    when 'absolute_beginner' then 'easy'
    when 'beginner' then 'medium'
    when 'beginner_plus' then 'hard'
    when 'novice' then 'easy'
    when 'intermediate' then 'medium'
    when 'advanced' then 'hard'
    else difficulty
  end,
  updated_at = now()
where difficulty in (
  'absolute_beginner',
  'beginner',
  'beginner_plus',
  'novice',
  'intermediate',
  'advanced'
);

alter table public.exercises
  add constraint exercises_difficulty_check
  check (difficulty is null or difficulty in ('easy', 'medium', 'hard'));

commit;
