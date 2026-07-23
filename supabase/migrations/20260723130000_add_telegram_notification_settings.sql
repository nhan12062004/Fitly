-- Add Telegram notification preference columns to profiles table
alter table public.profiles
  add column if not exists telegram_notify_water boolean not null default true,
  add column if not exists telegram_notify_sleep boolean not null default true,
  add column if not exists telegram_notify_workout boolean not null default true;
