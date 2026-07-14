-- Run only after 20260714120000_add_exercise_catalog_metadata.sql has been
-- applied to a confirmed staging project. A PASS result means the browser
-- roles cannot execute either RPC while service_role can.
with target as (
  select
    p.oid,
    p.oid::regprocedure as function_signature,
    p.prosecdef,
    coalesce(p.proacl, acldefault('f', p.proowner)) as effective_acl
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      (p.proname = 'apply_workout_adjustment_atomically' and p.pronargs = 7)
      or (p.proname = 'materialize_daily_workout_from_plan_atomically' and p.pronargs = 4)
    )
), checks as (
  select
    function_signature,
    prosecdef,
    has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', oid, 'EXECUTE') as service_role_execute,
    exists (
      select 1
      from aclexplode(effective_acl) as acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute
  from target
)
select
  function_signature,
  not prosecdef as security_invoker,
  public_execute,
  anon_execute,
  authenticated_execute,
  service_role_execute,
  case
    when not public_execute
      and not anon_execute
      and not authenticated_execute
      and service_role_execute
      and not prosecdef
    then 'PASS'
    else 'FAIL'
  end as verification
from checks
order by function_signature;
