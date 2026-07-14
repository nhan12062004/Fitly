begin;

create table if not exists public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_type text not null,
  recommendation_content jsonb not null,
  status text not null default 'active',
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists ai_recommendations_user_created_at_idx
  on public.ai_recommendations (user_id, created_at desc);

alter table public.ai_recommendations enable row level security;

commit;
