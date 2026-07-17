begin;

-- Keep quota accounting after a user clears the visible conversation.
-- Chat history is disposable UI data; quota events are billing/entitlement data.
create table if not exists public.ai_quota_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quota_key text not null check (quota_key in (
    'planGenerations',
    'workoutAdjustments',
    'mealAdjustments',
    'chatMessages'
  )),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_quota_usage_events_user_key_created_at_idx
  on public.ai_quota_usage_events (user_id, quota_key, created_at desc);

alter table public.ai_quota_usage_events enable row level security;

-- Preserve quota use already recorded in the old, deletable chat history.
insert into public.ai_quota_usage_events (user_id, quota_key, created_at)
select user_id, 'chatMessages', created_at
from public.ai_chat_messages
where role = 'user'
  and created_at is not null;

commit;
