alter table public.profiles
  add column if not exists membership_expires_at timestamp with time zone;

