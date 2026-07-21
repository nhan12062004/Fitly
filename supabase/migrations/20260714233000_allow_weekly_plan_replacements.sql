begin;

do $$
declare
  v_constraint_name text;
begin
  select conname
  into v_constraint_name
  from pg_constraint
  where conrelid = 'public.weekly_plans'::regclass
    and conname = 'idx_weekly_plans_user_week';

  if v_constraint_name is not null then
    execute format('alter table public.weekly_plans drop constraint %I', v_constraint_name);
  else
    drop index if exists public.idx_weekly_plans_user_week;
  end if;
end;
$$;

-- Retain exactly one active weekly plan, while allowing a draft replacement
-- and the adjusted historical plan to coexist for the same user and week.
create unique index idx_weekly_plans_user_week
  on public.weekly_plans (user_id, week_start_date)
  where plan_status = 'active';

commit;
