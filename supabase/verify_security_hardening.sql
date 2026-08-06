-- Expected result: every row is PASS.
with checks as (
  select
    'profiles protected columns are not client-updatable' as check_name,
    not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'membership_tier', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'membership_expires_at', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'has_purchased_plus', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'has_purchased_pro', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'exp', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.profiles', 'level', 'UPDATE') as passed

  union all

  select
    'profiles safe columns remain client-updatable',
    has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
      and has_column_privilege('authenticated', 'public.profiles', 'birthday', 'UPDATE')
      and has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'UPDATE')

  union all

  select
    'anonymous users have no public table privileges',
    not exists (
      select 1
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
    )

  union all

  select
    'arbitrary challenge helper is internal-only',
    not has_function_privilege(
      'anon',
      'public.sync_challenge_checkin_for_user(uuid,text,uuid,jsonb)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.sync_challenge_checkin_for_user(uuid,text,uuid,jsonb)',
      'EXECUTE'
    )

  union all

  select
    'challenge client RPC remains signed-in only',
    not has_function_privilege(
      'anon',
      'public.sync_challenge_checkin(text,uuid,jsonb)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.sync_challenge_checkin(text,uuid,jsonb)',
      'EXECUTE'
    )

  union all

  select
    'database export RPCs were removed',
    to_regprocedure('public.export_all_public_tables_as_sql()') is null
      and to_regprocedure('public.export_public_tables_structure()') is null

  union all

  select
    'avatar listing is owner-scoped',
    not exists (
      select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'Public read avatars'
    )
    and exists (
      select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'Users can read their own avatar metadata'
        and roles = array['authenticated']::name[]
    )
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
