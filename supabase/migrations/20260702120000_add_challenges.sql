-- Fitly Challenges MVP: private solo and crew consistency challenges.
-- Scores are intentionally based on daily healthy-action check-ins, never on
-- weight, calories, or body measurements.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  mode text not null default 'solo',
  challenge_type text not null default 'daily_checkin',
  start_date date not null,
  end_date date not null,
  status text not null default 'active',
  target jsonb not null default '{}'::jsonb,
  invite_code text unique,
  max_members integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint challenges_mode_check check (mode in ('solo', 'crew')),
  constraint challenges_type_check check (challenge_type in ('daily_checkin')),
  constraint challenges_status_check check (status in ('active', 'completed', 'cancelled')),
  constraint challenges_max_members_check check (max_members >= 1 and max_members <= 5),
  constraint challenges_date_check check (end_date >= start_date)
);

create table if not exists public.challenge_participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),

  unique(challenge_id, user_id),
  constraint challenge_participants_role_check check (role in ('owner', 'member'))
);

create table if not exists public.challenge_checkins (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null default current_date,
  source_type text not null,
  source_id uuid,
  score integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  unique(challenge_id, user_id, checkin_date),
  constraint challenge_checkins_source_type_check check (
    source_type in ('water', 'meal', 'workout', 'sleep', 'manual')
  )
);

create index if not exists idx_challenges_created_by on public.challenges(created_by);
create index if not exists idx_challenges_invite_code on public.challenges(invite_code);
create index if not exists idx_challenge_participants_user_id on public.challenge_participants(user_id);
create index if not exists idx_challenge_participants_challenge_id on public.challenge_participants(challenge_id);
create index if not exists idx_challenge_checkins_challenge_id on public.challenge_checkins(challenge_id);
create index if not exists idx_challenge_checkins_user_date on public.challenge_checkins(user_id, checkin_date);

alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.challenge_checkins enable row level security;

create or replace function public.is_challenge_participant(
  target_challenge_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.challenge_participants
    where challenge_id = target_challenge_id
      and user_id = target_user_id
  );
$$;

drop policy if exists challenges_participant_select on public.challenges;
create policy challenges_participant_select on public.challenges
  for select to authenticated
  using (public.is_challenge_participant(id));

drop policy if exists challenges_creator_insert on public.challenges;
create policy challenges_creator_insert on public.challenges
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists challenges_creator_update on public.challenges;
create policy challenges_creator_update on public.challenges
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists challenges_creator_delete on public.challenges;
create policy challenges_creator_delete on public.challenges
  for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists challenge_participants_member_select on public.challenge_participants;
create policy challenge_participants_member_select on public.challenge_participants
  for select to authenticated
  using (public.is_challenge_participant(challenge_id));

drop policy if exists challenge_checkins_member_select on public.challenge_checkins;
create policy challenge_checkins_member_select on public.challenge_checkins
  for select to authenticated
  using (public.is_challenge_participant(challenge_id));

drop policy if exists challenge_checkins_self_insert on public.challenge_checkins;
create policy challenge_checkins_self_insert on public.challenge_checkins
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_challenge_participant(challenge_id)
  );

create or replace function public.create_solo_challenge(
  p_title text default 'Thử thách điểm danh 7 ngày'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo thử thách.';
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Thử thách điểm danh 7 ngày'), 80),
    'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.',
    'solo',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7}'::jsonb,
    1
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;

-- Ensures every onboarded user always has an active default Solo cycle.
create or replace function public.ensure_default_solo_challenge_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  existing_challenge_id uuid;
  new_challenge_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_user_id
      and coalesce(role, 'user') <> 'admin'
      and exists (
        select 1
        from public.lifestyle_settings
        where user_id = p_user_id
      )
  ) then
    return null;
  end if;

  update public.challenges
  set status = 'completed',
      updated_at = now()
  where created_by = p_user_id
    and mode = 'solo'
    and status = 'active'
    and end_date < today_vn;

  select challenge.id
  into existing_challenge_id
  from public.challenges challenge
  where challenge.created_by = p_user_id
    and challenge.mode = 'solo'
    and challenge.status = 'active'
    and today_vn between challenge.start_date and challenge.end_date
  order by challenge.created_at desc
  limit 1;

  if existing_challenge_id is not null then
    return existing_challenge_id;
  end if;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    max_members
  )
  values (
    p_user_id,
    'Thử thách điểm danh 7 ngày',
    'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.',
    'solo',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7, "is_default": true}'::jsonb,
    1
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, p_user_id, 'owner');

  return new_challenge_id;
end;
$$;

create or replace function public.ensure_active_solo_challenge()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để sử dụng thử thách.';
  end if;

  return public.ensure_default_solo_challenge_for_user(auth.uid());
end;
$$;

create or replace function public.create_crew_challenge(
  p_title text default 'Thử thách nhóm 7 ngày'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
  new_invite_code text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo thử thách.';
  end if;

  loop
    new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.challenges where invite_code = new_invite_code
    );
  end loop;

  insert into public.challenges (
    created_by,
    title,
    description,
    mode,
    challenge_type,
    start_date,
    end_date,
    target,
    invite_code,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Thử thách nhóm 7 ngày'), 80),
    'Cùng nhau duy trì thói quen lành mạnh trong 7 ngày.',
    'crew',
    'daily_checkin',
    today_vn,
    today_vn + 6,
    '{"healthy_actions_per_day": 1, "duration_days": 7}'::jsonb,
    new_invite_code,
    5
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;

create or replace function public.join_challenge_by_invite_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  selected_challenge public.challenges%rowtype;
  participant_count integer;
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tham gia thử thách.';
  end if;

  select *
  into selected_challenge
  from public.challenges
  where invite_code = upper(trim(coalesce(p_invite_code, '')))
  for update;

  if selected_challenge.id is null then
    raise exception 'Mã mời không tồn tại.';
  end if;

  if selected_challenge.mode <> 'crew' then
    raise exception 'Mã mời này không thuộc thử thách nhóm.';
  end if;

  if selected_challenge.status <> 'active'
    or selected_challenge.end_date < today_vn then
    raise exception 'Thử thách đã kết thúc hoặc bị hủy.';
  end if;

  if exists (
    select 1
    from public.challenge_participants
    where challenge_id = selected_challenge.id
      and user_id = current_user_id
  ) then
    return selected_challenge.id;
  end if;

  select count(*)
  into participant_count
  from public.challenge_participants
  where challenge_id = selected_challenge.id;

  if participant_count >= selected_challenge.max_members then
    raise exception 'Thử thách nhóm đã đủ thành viên.';
  end if;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (selected_challenge.id, current_user_id, 'member');

  return selected_challenge.id;
end;
$$;

-- Internal variant used by activity triggers. It is intentionally not granted
-- to authenticated users because it accepts an explicit user id.
create or replace function public.sync_challenge_checkin_for_user(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  inserted_count integer := 0;
begin
  if p_source_type not in ('water', 'meal', 'workout', 'sleep', 'manual') then
    raise exception 'Nguồn check-in không hợp lệ.';
  end if;

  insert into public.challenge_checkins (
    challenge_id,
    user_id,
    checkin_date,
    source_type,
    source_id,
    metadata
  )
  select
    challenge.id,
    p_user_id,
    today_vn,
    p_source_type,
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id
   and participant.user_id = p_user_id
  where challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn between challenge.start_date and challenge.end_date
  on conflict (challenge_id, user_id, checkin_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.sync_challenge_checkin(
  p_source_type text,
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để điểm danh.';
  end if;

  return public.sync_challenge_checkin_for_user(
    auth.uid(),
    p_source_type,
    p_source_id,
    p_metadata
  );
end;
$$;

create or replace function public.manual_challenge_checkin(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  inserted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để điểm danh.';
  end if;

  insert into public.challenge_checkins (
    challenge_id,
    user_id,
    checkin_date,
    source_type
  )
  select
    challenge.id,
    current_user_id,
    today_vn,
    'manual'
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id
   and participant.user_id = current_user_id
  where challenge.id = p_challenge_id
    and challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn between challenge.start_date and challenge.end_date
  on conflict (challenge_id, user_id, checkin_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;

create or replace function public.get_user_challenge_summaries()
returns table (
  id uuid,
  created_by uuid,
  title text,
  description text,
  mode text,
  challenge_type text,
  start_date date,
  end_date date,
  status text,
  target jsonb,
  invite_code text,
  max_members integer,
  created_at timestamptz,
  participant_count bigint,
  today_checkin_count bigint,
  user_checked_in boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    challenge.id,
    challenge.created_by,
    challenge.title,
    challenge.description,
    challenge.mode,
    challenge.challenge_type,
    challenge.start_date,
    challenge.end_date,
    case
      when challenge.status = 'active'
        and challenge.end_date < (timezone('Asia/Ho_Chi_Minh', now()))::date
      then 'completed'
      else challenge.status
    end as status,
    challenge.target,
    challenge.invite_code,
    challenge.max_members,
    challenge.created_at,
    count(distinct all_participants.user_id) as participant_count,
    count(distinct today_checkins.user_id) as today_checkin_count,
    bool_or(today_checkins.user_id = auth.uid()) as user_checked_in
  from public.challenge_participants mine
  join public.challenges challenge on challenge.id = mine.challenge_id
  join public.challenge_participants all_participants on all_participants.challenge_id = challenge.id
  left join public.challenge_checkins today_checkins
    on today_checkins.challenge_id = challenge.id
   and today_checkins.checkin_date = (timezone('Asia/Ho_Chi_Minh', now()))::date
  where mine.user_id = auth.uid()
  group by challenge.id
  order by
    case when challenge.status = 'active'
      and challenge.end_date >= (timezone('Asia/Ho_Chi_Minh', now()))::date
      then 0 else 1 end,
    challenge.created_at desc;
$$;

create or replace function public.get_challenge_participant_progress(p_challenge_id uuid)
returns table (
  user_id uuid,
  display_name text,
  role text,
  joined_at timestamptz,
  checkin_dates date[]
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_challenge_participant(p_challenge_id) then
    raise exception 'Bạn không có quyền xem thử thách này.';
  end if;

  return query
    select
      participant.user_id,
      coalesce(nullif(trim(profile.full_name), ''), 'Thành viên Fitly') as display_name,
      participant.role,
      participant.joined_at,
      coalesce(
        array_agg(checkin.checkin_date order by checkin.checkin_date)
          filter (where checkin.id is not null),
        array[]::date[]
      ) as checkin_dates
    from public.challenge_participants participant
    left join public.profiles profile on profile.id = participant.user_id
    left join public.challenge_checkins checkin
      on checkin.challenge_id = participant.challenge_id
     and checkin.user_id = participant.user_id
    where participant.challenge_id = p_challenge_id
    group by participant.user_id, profile.full_name, participant.role, participant.joined_at
    order by
      case participant.role when 'owner' then 0 else 1 end,
      participant.joined_at asc;
end;
$$;

-- Automatic healthy-action integration. This also covers actions recorded by
-- Telegram because it runs in Postgres rather than only in the web client.
create or replace function public.sync_challenge_checkin_from_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
  -- Back-filling an older log must not count as showing up today.
  if new.log_date is distinct from today_vn then
    return new;
  end if;

  if tg_table_name = 'daily_progress_logs' then
    if tg_op = 'INSERT' then
      if coalesce(new.water_intake_ml, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'water', new.id);
      end if;
      if coalesce(new.sleep_hours, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'sleep', new.id);
      end if;
    else
      if coalesce(new.water_intake_ml, 0) > coalesce(old.water_intake_ml, 0) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'water', new.id);
      end if;
      if coalesce(new.sleep_hours, 0) > 0
        and coalesce(new.sleep_hours, 0) <> coalesce(old.sleep_hours, 0) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'sleep', new.id);
      end if;
    end if;
  elsif tg_table_name = 'daily_meal_logs' then
    if tg_op = 'INSERT' then
      if new.is_completed = true then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'meal', new.id);
      end if;
    elsif new.is_completed = true and coalesce(old.is_completed, false) = false then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'meal', new.id);
    end if;
  elsif tg_table_name = 'daily_exercise_sessions' then
    if tg_op = 'INSERT' then
      if new.is_completed = true or coalesce(new.completed_sets, 0) > 0 then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
      end if;
    elsif (
      (new.is_completed = true and coalesce(old.is_completed, false) = false)
      or coalesce(new.completed_sets, 0) > coalesce(old.completed_sets, 0)
    ) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
    end if;
  elsif tg_table_name = 'daily_workout_sessions' then
    if tg_op = 'INSERT' then
      if (
        new.started_at is not null
        or new.completed_at is not null
        or new.status in ('started', 'in_progress', 'completed')
      ) then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
      end if;
    elsif (
      (new.started_at is not null and old.started_at is null)
      or (new.completed_at is not null and old.completed_at is null)
      or (
        new.status in ('started', 'in_progress', 'completed')
        and coalesce(old.status, '') not in ('started', 'in_progress', 'completed')
      )
    ) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists challenge_checkin_from_progress on public.daily_progress_logs;
create trigger challenge_checkin_from_progress
  after insert or update of water_intake_ml, sleep_hours
  on public.daily_progress_logs
  for each row execute function public.sync_challenge_checkin_from_activity();

drop trigger if exists challenge_checkin_from_meal on public.daily_meal_logs;
create trigger challenge_checkin_from_meal
  after insert or update of is_completed
  on public.daily_meal_logs
  for each row execute function public.sync_challenge_checkin_from_activity();

drop trigger if exists challenge_checkin_from_exercise on public.daily_exercise_sessions;
create trigger challenge_checkin_from_exercise
  after insert or update of is_completed, completed_sets
  on public.daily_exercise_sessions
  for each row execute function public.sync_challenge_checkin_from_activity();

drop trigger if exists challenge_checkin_from_workout on public.daily_workout_sessions;
create trigger challenge_checkin_from_workout
  after insert or update of started_at, completed_at, status
  on public.daily_workout_sessions
  for each row execute function public.sync_challenge_checkin_from_activity();

create or replace function public.create_default_solo_after_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_default_solo_challenge_for_user(new.user_id);
  return new;
end;
$$;

drop trigger if exists create_default_solo_challenge on public.lifestyle_settings;
create trigger create_default_solo_challenge
  after insert on public.lifestyle_settings
  for each row execute function public.create_default_solo_after_onboarding();

-- Existing onboarded users receive the same one-time default challenge when
-- this migration is applied.
do $$
declare
  existing_user record;
begin
  for existing_user in
    select profile.id
    from public.profiles profile
    join public.lifestyle_settings lifestyle on lifestyle.user_id = profile.id
    where coalesce(profile.role, 'user') <> 'admin'
  loop
    perform public.ensure_default_solo_challenge_for_user(existing_user.id);
  end loop;
end;
$$;

revoke all on function public.is_challenge_participant(uuid, uuid) from public;
revoke all on function public.create_solo_challenge(text) from public;
revoke all on function public.ensure_default_solo_challenge_for_user(uuid) from public;
revoke all on function public.ensure_active_solo_challenge() from public;
revoke all on function public.create_crew_challenge(text) from public;
revoke all on function public.join_challenge_by_invite_code(text) from public;
revoke all on function public.sync_challenge_checkin_for_user(uuid, text, uuid, jsonb) from public;
revoke all on function public.sync_challenge_checkin(text, uuid, jsonb) from public;
revoke all on function public.manual_challenge_checkin(uuid) from public;
revoke all on function public.get_user_challenge_summaries() from public;
revoke all on function public.get_challenge_participant_progress(uuid) from public;
revoke all on function public.sync_challenge_checkin_from_activity() from public;
revoke all on function public.create_default_solo_after_onboarding() from public;

grant execute on function public.is_challenge_participant(uuid, uuid) to authenticated;
grant execute on function public.create_solo_challenge(text) to authenticated;
grant execute on function public.ensure_active_solo_challenge() to authenticated;
grant execute on function public.create_crew_challenge(text) to authenticated;
grant execute on function public.join_challenge_by_invite_code(text) to authenticated;
grant execute on function public.sync_challenge_checkin(text, uuid, jsonb) to authenticated;
grant execute on function public.manual_challenge_checkin(uuid) to authenticated;
grant execute on function public.get_user_challenge_summaries() to authenticated;
grant execute on function public.get_challenge_participant_progress(uuid) to authenticated;

grant select, insert, update, delete on table public.challenges to authenticated;
grant select on table public.challenge_participants to authenticated;
grant select, insert on table public.challenge_checkins to authenticated;
