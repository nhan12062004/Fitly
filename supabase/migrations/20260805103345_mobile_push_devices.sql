-- Tokens are private. The mobile client may register only its own token using
-- the security-definer RPC; the backend reads active devices with service role.
create table public.mobile_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mobile_push_devices_active_user_idx
  on public.mobile_push_devices (user_id, last_seen_at desc)
  where enabled = true;

alter table public.mobile_push_devices enable row level security;

create or replace function public.register_mobile_push_device(
  p_expo_push_token text,
  p_platform text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  device_id uuid;
  normalized_token text := trim(coalesce(p_expo_push_token, ''));
  normalized_platform text := lower(trim(coalesce(p_platform, '')));
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để đăng ký thiết bị.';
  end if;
  if normalized_platform not in ('ios', 'android') then
    raise exception 'Nền tảng thiết bị không hợp lệ.';
  end if;
  if normalized_token !~ '^(ExponentPushToken|ExpoPushToken)\[[[:print:]]{8,}\]$' then
    raise exception 'Push token không hợp lệ.';
  end if;

  insert into public.mobile_push_devices (
    user_id, expo_push_token, platform, enabled, last_seen_at, disabled_at, updated_at
  ) values (
    current_user_id, normalized_token, normalized_platform, true, now(), null, now()
  )
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    enabled = true,
    last_seen_at = now(),
    disabled_at = null,
    updated_at = now()
  returning id into device_id;

  return device_id;
end;
$$;

revoke all on table public.mobile_push_devices from anon, authenticated;
revoke all on function public.register_mobile_push_device(text, text) from public;
grant execute on function public.register_mobile_push_device(text, text) to authenticated;
