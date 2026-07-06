create table if not exists public.user_notifications (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tone text not null check (tone in ('workout', 'nutrition', 'coach', 'progress', 'system')),
  title text not null,
  message text not null,
  href text not null default '/overview',
  source_type text not null default 'system',
  source_id text,
  dedupe_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  expires_at timestamp with time zone,
  unique (user_id, dedupe_key)
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications (user_id, created_at desc);

create index if not exists user_notifications_user_unread_idx
  on public.user_notifications (user_id, read_at)
  where read_at is null;

alter table public.user_notifications enable row level security;

drop policy if exists owner_policy on public.user_notifications;
create policy owner_policy on public.user_notifications
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.user_notifications to authenticated;

do $$
begin
  execute 'alter publication supabase_realtime add table public.user_notifications';
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;
