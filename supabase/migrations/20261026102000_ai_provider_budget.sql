begin;
create table public.ai_provider_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  active boolean not null default true,
  reserved_tokens integer not null check(reserved_tokens > 0),
  actual_tokens integer
);
alter table public.ai_provider_calls enable row level security;
revoke all on public.ai_provider_calls from public,anon,authenticated;
grant all on public.ai_provider_calls to service_role;
create index ai_provider_calls_day on public.ai_provider_calls(created_at);

create function public.reserve_ai_provider_call(p_tokens integer,p_daily_calls integer,p_daily_tokens bigint,p_concurrent integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare call_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(741260002);
  if p_tokens <= 0 or p_daily_calls <= 0 or p_daily_tokens <= 0 or p_concurrent <= 0 then return null; end if;
  if (select count(*) from public.ai_provider_calls where created_at >= date_trunc('day',now())) >= p_daily_calls
    or (select coalesce(sum(coalesce(actual_tokens,reserved_tokens)),0) from public.ai_provider_calls where created_at >= date_trunc('day',now())) + p_tokens > p_daily_tokens
    or (select count(*) from public.ai_provider_calls where active and expires_at > now()) >= p_concurrent then return null; end if;
  insert into public.ai_provider_calls(reserved_tokens) values(p_tokens) returning id into call_id;
  return call_id;
end;
$$;
revoke all on function public.reserve_ai_provider_call(integer,integer,bigint,integer) from public,anon,authenticated;
grant execute on function public.reserve_ai_provider_call(integer,integer,bigint,integer) to service_role;

create or replace function public.prune_runtime_data() returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.api_operations set response_body = null where created_at < now()-interval '7 days' and response_body is not null;
  delete from public.background_job_runs where created_at < now()-interval '90 days' and state <> 'running';
  delete from public.ai_provider_calls where created_at < now()-interval '90 days';
end;
$$;
commit;
