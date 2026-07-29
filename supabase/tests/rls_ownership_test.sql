begin;
select plan(16);

-- These deterministic fixture IDs are never committed: the transaction rolls
-- back after the assertions. session_replication_role only bypasses foreign
-- keys while arranging fixture rows; the assertions run as `authenticated`
-- with an explicit JWT subject so RLS is exercised normally.
set local session_replication_role = replica;

insert into public.profiles (id, full_name, email)
values
  ('00000000-0000-4000-8000-000000000001', 'RLS User A', 'rls-user-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'RLS User B', 'rls-user-b@example.invalid')
on conflict (id) do update
set full_name = excluded.full_name, email = excluded.email;

insert into public.daily_exercise_sessions (id, user_id, log_date, order_index)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', current_date, 1),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', current_date, 1)
on conflict (id) do update set user_id = excluded.user_id;

insert into public.daily_exercise_set_logs (id, daily_exercise_session_id, set_number)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1)
on conflict (id) do update set daily_exercise_session_id = excluded.daily_exercise_session_id;

set local session_replication_role = origin;

select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.daily_exercise_sessions'::regclass), 'daily exercise sessions have RLS enabled');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$ select count(*) from public.profiles $$,
  array[1::bigint],
  'User A reads only User A profile'
);
select is_empty(
  $$ select id from public.profiles where id = '00000000-0000-4000-8000-000000000002'::uuid $$,
  'User A cannot read User B profile'
);
select is_empty(
  $$ update public.profiles set full_name = 'compromised' where id = '00000000-0000-4000-8000-000000000002'::uuid returning id $$,
  'User A cannot update User B profile'
);
select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-4000-8000-000000000002'::uuid $$,
  '42501',
  'permission denied for table profiles',
  'User A cannot delete User B profile'
);
select results_eq(
  $$ select count(*) from public.daily_exercise_sessions $$,
  array[1::bigint],
  'User A reads only User A daily exercise session'
);
select is_empty(
  $$ update public.daily_exercise_sessions set is_completed = true where id = '10000000-0000-4000-8000-000000000002'::uuid returning id $$,
  'User A cannot update User B daily exercise session'
);
select is_empty(
  $$ delete from public.daily_exercise_sessions where id = '10000000-0000-4000-8000-000000000002'::uuid returning id $$,
  'User A cannot delete User B daily exercise session'
);
select is_empty(
  $$ select id from public.daily_exercise_set_logs where id = '20000000-0000-4000-8000-000000000002'::uuid $$,
  'User A cannot read User B daily exercise set log'
);
select is_empty(
  $$ update public.daily_exercise_set_logs set notes = 'compromised' where id = '20000000-0000-4000-8000-000000000002'::uuid returning id $$,
  'User A cannot update User B daily exercise set log'
);
select is_empty(
  $$ delete from public.daily_exercise_set_logs where id = '20000000-0000-4000-8000-000000000002'::uuid returning id $$,
  'User A cannot delete User B daily exercise set log'
);
select ok(not has_column_privilege('authenticated', 'public.profiles', 'membership_tier', 'UPDATE'), 'membership tier is not client-updatable');
select ok(not has_table_privilege('authenticated', 'public.ai_quota_usage_events', 'SELECT'), 'regular users cannot read service-only quota events');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can update their own avatar'
      and roles = array['authenticated']::name[]
  ),
  'avatar updates require the authenticated owner policy'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'user_custom_foods_user_id_fkey'
      and confdeltype = 'c'
  ),
  'account deletion cascades to user custom foods'
);

select * from finish();
rollback;
