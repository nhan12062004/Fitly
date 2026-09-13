-- Verified store rights are separate from referral/admin grants in profiles.
create table public.store_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null check (tier in ('free', 'plus', 'pro')),
  expires_at timestamptz,
  checked_at timestamptz not null
);
alter table public.store_entitlements enable row level security;
revoke all on public.store_entitlements from anon, authenticated;
grant select on public.store_entitlements to authenticated;
grant all on public.store_entitlements to service_role;
create policy store_entitlements_owner_read on public.store_entitlements
  for select to authenticated using ((select auth.uid()) = user_id);

-- Repeated or out-of-order webhook deliveries cannot overwrite a newer snapshot.
create function public.sync_store_entitlement(p_user_id uuid, p_tier text, p_expires_at timestamptz, p_checked_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into public.store_entitlements(user_id, tier, expires_at, checked_at)
  values (p_user_id, p_tier, p_expires_at, p_checked_at)
  on conflict (user_id) do update set tier = excluded.tier, expires_at = excluded.expires_at, checked_at = excluded.checked_at
  where public.store_entitlements.checked_at <= excluded.checked_at;
$$;
revoke all on function public.sync_store_entitlement(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_store_entitlement(uuid, text, timestamptz, timestamptz) to service_role;

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('support', 'ai_report', 'privacy', 'challenge_report')),
  message text not null check (length(message) between 5 and 5000),
  context text check (length(context) <= 5000),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  created_at timestamptz not null default now()
);
create index app_feedback_status_created_at on public.app_feedback(status, created_at desc);
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;
grant all on public.app_feedback to service_role;

-- Revocation must also stop server-side scheduled AI work, on every device.
create table public.ai_data_consents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  version integer not null check (version = 1),
  accepted_at timestamptz not null default now()
);
alter table public.ai_data_consents enable row level security;
revoke all on public.ai_data_consents from anon, authenticated;
grant select, insert, update, delete on public.ai_data_consents to authenticated;
grant all on public.ai_data_consents to service_role;
create policy ai_data_consents_owner on public.ai_data_consents
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
