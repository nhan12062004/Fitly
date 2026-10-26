begin;
create table public.background_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_key text not null,
  state text not null default 'running' check(state in ('running','completed','failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(job_name,run_key)
);
alter table public.background_job_runs enable row level security;
revoke all on public.background_job_runs from public,anon,authenticated;
grant all on public.background_job_runs to service_role;

create function public.claim_background_job(p_job_name text,p_run_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare job_id uuid;
begin
  insert into public.background_job_runs(job_name,run_key) values(p_job_name,p_run_key)
    on conflict(job_name,run_key) do nothing returning id into job_id;
  return job_id;
end;
$$;
revoke all on function public.claim_background_job(text,text) from public,anon,authenticated;
grant execute on function public.claim_background_job(text,text) to service_role;

create function public.prune_runtime_data() returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Keep operation keys/usage so replay and billing are stable. Remove the
  -- health-bearing cached response; a very old replay gets 410, never new work.
  update public.api_operations set response_body = null where created_at < now()-interval '7 days' and response_body is not null;
  delete from public.background_job_runs where created_at < now()-interval '90 days' and state <> 'running';
end;
$$;
revoke all on function public.prune_runtime_data() from public,anon,authenticated;
grant execute on function public.prune_runtime_data() to service_role;
create index api_operations_response_expiry on public.api_operations(created_at) where response_body is not null;

-- Restrict new avatar names to the four bounded API-owned slots. Existing
-- legacy images remain readable/deletable during account cleanup.
create policy avatar_bounded_names_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id <> 'avatars' or name in (
    auth.uid()::text || '/avatar.jpg', auth.uid()::text || '/avatar.png',auth.uid()::text || '/avatar.webp',auth.uid()::text || '/avatar.gif'));
create policy avatar_bounded_names_update on storage.objects as restrictive for update to authenticated
  using(bucket_id <> 'avatars' or name in (
    auth.uid()::text || '/avatar.jpg', auth.uid()::text || '/avatar.png',auth.uid()::text || '/avatar.webp',auth.uid()::text || '/avatar.gif'))
  with check(bucket_id <> 'avatars' or name in (
    auth.uid()::text || '/avatar.jpg', auth.uid()::text || '/avatar.png',auth.uid()::text || '/avatar.webp',auth.uid()::text || '/avatar.gif'));
commit;
