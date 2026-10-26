begin;
create function public.operational_snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'providerCallsToday',(select count(*) from public.ai_provider_calls where created_at >= date_trunc('day',now())),
    'providerTokensToday',(select coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) from public.ai_provider_calls where created_at >= date_trunc('day',now())),
    'providerCallsActive',(select count(*) from public.ai_provider_calls where active and expires_at > now()),
    'uncertainOperations',(select count(*) from public.api_operations where state = 'pending' and expires_at < now()),
    'failedJobsLastDay',(select count(*) from public.background_job_runs where state = 'failed' and created_at > now()-interval '1 day'),
    'pendingAccountDeletions',(select count(*) from public.account_deletion_requests)
  );
$$;
revoke all on function public.operational_snapshot() from public,anon,authenticated;
grant execute on function public.operational_snapshot() to service_role;
create or replace function public.production_schema_version() returns integer language sql immutable set search_path = '' as $$ select 20261026 $$;
revoke all on function public.production_schema_version() from public,anon,authenticated;
grant execute on function public.production_schema_version() to service_role;
commit;
