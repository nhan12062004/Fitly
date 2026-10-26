-- Apply before the matching API/client release. Never derive entitlements from
-- client-editable presentation/history rows.
begin;
revoke create on schema public from public, anon, authenticated;
revoke truncate, references, trigger, maintain on all tables in schema public from anon, authenticated;

revoke insert(referred_by), update(referred_by) on public.profiles from authenticated;
revoke truncate, references, trigger, maintain on public.profiles from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on public.ai_plan_adjustments from authenticated;
revoke insert, update on public.ai_chat_messages from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create table public.referral_events (
  referred_user_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_id)
);
alter table public.referral_events enable row level security;
revoke all on public.referral_events from public, anon, authenticated;
grant all on public.referral_events to service_role;
insert into public.referral_events(referred_user_id, referrer_id)
select child.id, parent.id from public.profiles child join public.profiles parent on parent.ref_code = child.referred_by
where child.id <> parent.id on conflict do nothing;

create or replace function public.trg_on_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
declare referrer uuid; awarded integer;
begin
  if new.referred_by is not distinct from old.referred_by then return new; end if;
  if old.referred_by is not null or new.referred_by is null then
    raise exception using errcode = '23514', message = 'Referral cannot be reset or changed';
  end if;
  select id into referrer from public.profiles where ref_code = new.referred_by and id <> new.id;
  if referrer is null then raise exception using errcode = '22023', message = 'Invalid referral'; end if;
  insert into public.referral_events(referred_user_id, referrer_id) values(new.id, referrer) on conflict do nothing;
  if not found then return new; end if;
  update public.profiles set referral_count = referral_count + 1, updated_at = now()
  where id = referrer returning referral_count into awarded;
  update public.profiles set membership_tier = case when awarded >= 20 then 'pro' else 'plus' end, updated_at = now()
  where id = referrer and awarded >= 5 and (membership_tier = 'free' or (membership_tier = 'plus' and awarded >= 20));
  return new;
end;
$$;
revoke all on function public.trg_on_referral() from public, anon, authenticated;

create function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); prior text;
begin
  if uid is null or not exists(select 1 from auth.users where id = uid and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'Verified account required';
  end if;
  select referred_by into prior from public.profiles where id = uid for update;
  if not found then raise exception using errcode = '42501', message = 'Profile required'; end if;
  if prior is not null then return prior = upper(trim(p_code)); end if;
  if length(trim(p_code)) not between 4 and 32 then return false; end if;
  if not exists(select 1 from public.profiles where ref_code = upper(trim(p_code)) and id <> uid) then return false; end if;
  update public.profiles set referred_by = upper(trim(p_code)), updated_at = now() where id = uid;
  return true;
end;
$$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- A durable request record prevents concurrent actions and replays across web
-- instances. Hashes contain no request content. Responses are purged after 7d;
-- request keys remain tombstones so an old retry is never executed again.
create table public.api_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  key_hash text not null check(length(key_hash) = 64),
  request_hash text not null check(length(request_hash) = 64),
  state text not null default 'pending' check(state in ('pending', 'completed', 'failed')),
  quota_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  response_status integer,
  response_body jsonb,
  unique(user_id, key_hash)
);
create index api_operations_pending on public.api_operations(created_at) where state = 'pending';
create index api_operations_user_created on public.api_operations(user_id, created_at desc);
alter table public.api_operations enable row level security;
revoke all on public.api_operations from public, anon, authenticated;
grant all on public.api_operations to service_role;
alter table public.ai_quota_usage_events add column operation_id uuid unique references public.api_operations(id) on delete set null;
alter table public.ai_quota_usage_events add column legacy_adjustment_id uuid unique;

-- Reconcile historical adjustment counts without charging existing legacy
-- usage events twice. Legacy sources were counted by month in the old API.
with history as (
  select id, user_id, created_at,
    case when source_type = 'ai_coach_generate' then 'planGenerations'
      when plan_type = 'workout' then 'workoutAdjustments' else 'mealAdjustments' end as key
  from public.ai_plan_adjustments
  where status = 'applied' and user_id is not null
    and (source_type = 'ai_coach_generate' or (plan_type in ('workout','meal')
      and source_type not in ('premium_auto_generate','onboarding_meal_generate')))
), ranked as (
  select *, row_number() over(partition by user_id, key, date_trunc('month', created_at) order by created_at, id) n from history
)
insert into public.ai_quota_usage_events(user_id, quota_key, created_at, legacy_adjustment_id)
select user_id, key, created_at, id from ranked h
where n > (select count(*) from public.ai_quota_usage_events e where e.user_id = h.user_id and e.quota_key = h.key
  and date_trunc('month', e.created_at) = date_trunc('month', h.created_at));

create function public.begin_api_operation(
  p_user_id uuid, p_action text, p_key_hash text, p_request_hash text,
  p_quota_key text, p_limit integer, p_starts_at timestamptz, p_ends_at timestamptz,
  p_max_concurrent integer default 8, p_daily_limit integer default 5000
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior public.api_operations%rowtype; op uuid; used bigint;
begin
  -- Global admission lock is held only for this short transaction, never AI IO.
  perform pg_catalog.pg_advisory_xact_lock(741260001);
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'Profile required'; end if;
  select * into prior from public.api_operations where user_id = p_user_id and key_hash = p_key_hash;
  if found then
    if prior.action <> p_action or prior.request_hash <> p_request_hash then return jsonb_build_object('kind','conflict'); end if;
    if prior.state = 'pending' then return jsonb_build_object('kind','busy'); end if;
    return jsonb_build_object('kind','replay','status',prior.response_status,'body',prior.response_body);
  end if;
  if exists(select 1 from public.api_operations where user_id = p_user_id and state = 'pending' and expires_at > now()) then
    return jsonb_build_object('kind','busy');
  end if;
  if (select count(*) from public.api_operations where state = 'pending' and expires_at > now()) >= p_max_concurrent then
    return jsonb_build_object('kind','overloaded');
  end if;
  if (select count(*) from public.api_operations where created_at >= date_trunc('day',now())) >= p_daily_limit then
    return jsonb_build_object('kind','budget');
  end if;
  if p_quota_key is not null then
    if p_limit is null or p_limit < 1 or p_starts_at is null or (p_ends_at is not null and p_ends_at <= now()) then
      return jsonb_build_object('kind','exhausted');
    end if;
    select count(*) into used from public.ai_quota_usage_events where user_id = p_user_id and quota_key = p_quota_key
      and created_at >= p_starts_at and (p_ends_at is null or created_at < p_ends_at);
    if used >= p_limit then return jsonb_build_object('kind','exhausted'); end if;
  end if;
  insert into public.api_operations(user_id, action, key_hash, request_hash, quota_key)
    values(p_user_id,p_action,p_key_hash,p_request_hash,p_quota_key) returning id into op;
  if p_quota_key is not null then
    insert into public.ai_quota_usage_events(user_id, quota_key, operation_id) values(p_user_id,p_quota_key,op);
  end if;
  return jsonb_build_object('kind','started','id',op);
end;
$$;
revoke all on function public.begin_api_operation(uuid,text,text,text,text,integer,timestamptz,timestamptz,integer,integer) from public, anon, authenticated;
grant execute on function public.begin_api_operation(uuid,text,text,text,text,integer,timestamptz,timestamptz,integer,integer) to service_role;

create function public.finish_api_operation(p_id uuid, p_status integer, p_body jsonb, p_charge boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.api_operations where id = p_id and state = 'pending' for update;
  if not found then raise exception 'Operation is not pending'; end if;
  if not p_charge then delete from public.ai_quota_usage_events where operation_id = p_id; end if;
  update public.api_operations set state = case when p_status < 400 then 'completed' else 'failed' end,
    response_status = p_status, response_body = p_body where id = p_id;
end;
$$;
revoke all on function public.finish_api_operation(uuid,integer,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.finish_api_operation(uuid,integer,jsonb,boolean) to service_role;

-- Safe policy helper: authenticated callers may only test their own membership.
create or replace function public.is_challenge_participant(target_challenge_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select (auth.role() = 'service_role' or target_user_id = auth.uid()) and exists(
    select 1 from public.challenge_participants where challenge_id = target_challenge_id and user_id = target_user_id
  );
$$;
grant execute on function public.is_challenge_participant(uuid,uuid) to authenticated;

commit;
