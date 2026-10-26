begin;
revoke insert,update,delete on public.ai_data_consents from authenticated;
create table public.ai_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  action text not null check(action in ('accepted','revoked','legacy_import')),
  created_at timestamptz not null default now()
);
alter table public.ai_consent_events enable row level security;
revoke all on public.ai_consent_events from public,anon,authenticated;
grant select on public.ai_consent_events to authenticated;
grant all on public.ai_consent_events to service_role;
create policy ai_consent_events_owner_read on public.ai_consent_events for select to authenticated using(user_id = (select auth.uid()));
create index ai_consent_events_user_created on public.ai_consent_events(user_id,created_at);
insert into public.ai_consent_events(user_id,version,action) select user_id,version,'legacy_import' from public.ai_data_consents;

create function public.set_ai_data_consent(p_accept boolean, p_version integer default 1)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_version integer;
begin
  if uid is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_accept is null or p_version <> 1 then raise exception 'Invalid consent version'; end if;
  perform 1 from public.profiles where id = uid for update;
  if not found then raise exception using errcode='42501',message='Profile required'; end if;
  select version into current_version from public.ai_data_consents where user_id = uid;
  if p_accept then
    if current_version = p_version then return; end if;
    insert into public.ai_data_consents(user_id,version,accepted_at) values(uid,p_version,now())
      on conflict(user_id) do update set version=excluded.version,accepted_at=excluded.accepted_at;
  else
    if current_version is null then return; end if;
    delete from public.ai_data_consents where user_id = uid;
  end if;
  insert into public.ai_consent_events(user_id,version,action) values(uid,p_version,case when p_accept then 'accepted' else 'revoked' end);
end;
$$;
revoke all on function public.set_ai_data_consent(boolean,integer) from public,anon;
grant execute on function public.set_ai_data_consent(boolean,integer) to authenticated;

create table public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_deleted boolean not null default false,
  requested_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant all on public.account_deletion_requests to service_role;

create function public.account_accepts_uploads() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists(select 1 from public.account_deletion_requests where user_id = auth.uid());
$$;
revoke all on function public.account_accepts_uploads() from public,anon;
grant execute on function public.account_accepts_uploads() to authenticated;
create policy avatar_active_account_insert on storage.objects as restrictive for insert to authenticated
  with check(bucket_id <> 'avatars' or public.account_accepts_uploads());
create policy avatar_active_account_update on storage.objects as restrictive for update to authenticated
  using(bucket_id <> 'avatars' or public.account_accepts_uploads()) with check(bucket_id <> 'avatars' or public.account_accepts_uploads());

commit;
