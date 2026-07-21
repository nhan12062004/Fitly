-- Prevent duplicate Telegram reminder delivery across multiple backend processes
-- and enforce one Telegram chat per Fitly profile.

with ranked_profiles as (
  select
    id,
    telegram_chat_id,
    row_number() over (
      partition by telegram_chat_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_num
  from public.profiles
  where telegram_chat_id is not null
)
update public.profiles as profiles
set 
  telegram_chat_id = null,
  updated_at = timezone('utc'::text, now())
from ranked_profiles
where profiles.id = ranked_profiles.id
  and ranked_profiles.row_num > 1;

create unique index if not exists profiles_telegram_chat_id_unique_idx
  on public.profiles (telegram_chat_id)
  where telegram_chat_id is not null;

create table if not exists public.telegram_reminder_dispatches (
  reminder_key text primary key,
  reminder_type text not null,
  reminder_date date not null,
  slot_label text not null,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists telegram_reminder_dispatches_lookup_idx
  on public.telegram_reminder_dispatches (reminder_type, reminder_date);
