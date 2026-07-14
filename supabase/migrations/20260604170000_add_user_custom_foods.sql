-- Store user-specific foods estimated from Telegram photo/voice without
-- polluting the shared foods catalog.

create table if not exists public.user_custom_foods (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null,
  name text not null,
  normalized_name text not null,
  serving_description text,
  calories numeric default 0,
  protein numeric default 0,
  carbs numeric default 0,
  fat numeric default 0,
  source text default 'telegram_photo_ai',
  confidence text default 'medium',
  image_url text,
  telegram_file_id text,
  usage_count integer not null default 1,
  last_used_at timestamp with time zone not null default timezone('utc'::text, now()),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

create unique index if not exists user_custom_foods_user_normalized_name_idx
  on public.user_custom_foods (user_id, normalized_name);

create index if not exists user_custom_foods_user_last_used_idx
  on public.user_custom_foods (user_id, last_used_at desc);

alter table if exists public.daily_meal_logs
  add column if not exists custom_food_id uuid references public.user_custom_foods(id) on delete set null,
  add column if not exists custom_food_name text,
  add column if not exists source text,
  add column if not exists confidence text,
  add column if not exists image_url text,
  add column if not exists telegram_file_id text,
  add column if not exists notes text,
  add column if not exists ai_estimate jsonb;

create index if not exists daily_meal_logs_user_custom_food_idx
  on public.daily_meal_logs (user_id, custom_food_id);

alter table public.user_custom_foods enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_custom_foods'
      and policyname = 'owner_policy'
  ) then
    create policy owner_policy on public.user_custom_foods
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;
