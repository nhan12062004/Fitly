-- Database-backed challenge recommendations and configurable challenge duration.

create table if not exists public.challenge_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  goal text not null,
  duration_days integer,
  difficulty text not null default 'medium',
  reward_badge text,
  mode text not null default 'solo',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint challenge_templates_duration_check check (duration_days is null or duration_days between 1 and 365),
  constraint challenge_templates_difficulty_check check (difficulty in ('easy', 'medium', 'hard')),
  constraint challenge_templates_mode_check check (mode in ('solo', 'crew'))
);

alter table public.challenge_templates enable row level security;

drop policy if exists challenge_templates_authenticated_select on public.challenge_templates;
create policy challenge_templates_authenticated_select on public.challenge_templates
  for select to authenticated
  using (is_active = true);

insert into public.challenge_templates (
  slug,
  title,
  description,
  goal,
  duration_days,
  difficulty,
  reward_badge,
  mode,
  is_active
)
values
  (
    'khoi-dong-lai-7-ngay',
    '7 ngày khởi động lại',
    'Một tuần vận động nhẹ, uống đủ nước và chủ động phục hồi.',
    'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.',
    7,
    'easy',
    'Bước đầu tiên',
    'solo',
    true
  ),
  (
    'anh-hung-uong-nuoc',
    'Anh hùng uống nước',
    'Tạo thói quen uống nước đều đặn theo mục tiêu cá nhân.',
    'Uống đủ nước theo mục tiêu cá nhân mỗi ngày.',
    10,
    'easy',
    'Anh hùng uống nước',
    'solo',
    true
  ),
  (
    'lean-14',
    'Lean 14',
    'Duy trì tập luyện, bữa ăn cân bằng và phục hồi trong hai tuần.',
    'Duy trì tập luyện và calories hợp lý trong 14 ngày.',
    14,
    'hard',
    'Bậc thầy đều đặn',
    'solo',
    true
  ),
  (
    'manh-hon-moi-tuan',
    'Mạnh hơn mỗi tuần',
    'Tiến bộ qua số lần lặp, số hiệp hoặc mức tạ ở bài tập chính.',
    'Hoàn thành bốn buổi tập sức mạnh.',
    7,
    'medium',
    'Tăng sức mạnh',
    'solo',
    true
  ),
  (
    'ngu-ngon-hon',
    'Ngủ ngon hơn',
    'Xây dựng thói quen buổi tối nhẹ nhàng để phục hồi tốt hơn.',
    'Ghi nhận giấc ngủ đều đặn trong bảy đêm.',
    7,
    'medium',
    'Ngọn lửa 7 ngày',
    'solo',
    true
  ),
  (
    'team-streak',
    'Đừng để team mất streak',
    'Thử thách nhóm riêng tư, nơi mỗi lượt hoàn thành đều có ý nghĩa.',
    'Cùng nhóm hoàn thành nhiệm vụ mỗi ngày để giữ chuỗi streak.',
    7,
    'medium',
    'Đồng đội tích cực',
    'crew',
    true
  )
on conflict (slug) do update
set title = excluded.title,
    description = excluded.description,
    goal = excluded.goal,
    duration_days = excluded.duration_days,
    difficulty = excluded.difficulty,
    reward_badge = excluded.reward_badge,
    mode = excluded.mode,
    is_active = excluded.is_active,
    updated_at = now();

alter table public.challenges drop constraint if exists challenges_date_check;
alter table public.challenges alter column end_date drop not null;
alter table public.challenges
  add constraint challenges_date_check check (end_date is null or end_date >= start_date);

create or replace function public.create_custom_challenge(
  p_title text,
  p_description text default null,
  p_mode text default 'solo',
  p_duration_days integer default 7
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
  if p_mode not in ('solo', 'crew') then
    raise exception 'Loại thử thách không hợp lệ.';
  end if;
  if p_duration_days is not null and (p_duration_days < 1 or p_duration_days > 365) then
    raise exception 'Thời lượng thử thách phải từ 1 đến 365 ngày.';
  end if;

  if p_mode = 'crew' then
    loop
      new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from public.challenges where invite_code = new_invite_code);
    end loop;
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
    invite_code,
    max_members
  )
  values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Thử thách của tôi'), 80),
    left(coalesce(nullif(trim(p_description), ''), 'Hoàn thành một hành động lành mạnh mỗi ngày.'), 500),
    p_mode,
    'daily_checkin',
    today_vn,
    case when p_duration_days is null then null else today_vn + p_duration_days - 1 end,
    jsonb_build_object(
      'healthy_actions_per_day', 1,
      'duration_days', p_duration_days
    ),
    new_invite_code,
    case when p_mode = 'crew' then 5 else 1 end
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;

create or replace function public.start_challenge_template(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  selected_template public.challenge_templates%rowtype;
  new_challenge_id uuid;
  new_invite_code text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để tham gia thử thách.';
  end if;

  select * into selected_template
  from public.challenge_templates
  where id = p_template_id and is_active = true;

  if selected_template.id is null then
    raise exception 'Mẫu thử thách không tồn tại hoặc đã ngừng hoạt động.';
  end if;

  if selected_template.mode = 'crew' then
    loop
      new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from public.challenges where invite_code = new_invite_code);
    end loop;
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
    invite_code,
    max_members
  )
  values (
    current_user_id,
    selected_template.title,
    selected_template.description,
    selected_template.mode,
    'daily_checkin',
    today_vn,
    case
      when selected_template.duration_days is null then null
      else today_vn + selected_template.duration_days - 1
    end,
    jsonb_build_object(
      'healthy_actions_per_day', 1,
      'duration_days', selected_template.duration_days,
      'difficulty', selected_template.difficulty,
      'goal', selected_template.goal,
      'reward_badge', selected_template.reward_badge,
      'template_id', selected_template.id
    ),
    new_invite_code,
    case when selected_template.mode = 'crew' then 5 else 1 end
  )
  returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;

create or replace function public.leave_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  participant_role text;
begin
  if current_user_id is null then
    raise exception 'Bạn cần đăng nhập để rời thử thách.';
  end if;

  select role into participant_role
  from public.challenge_participants
  where challenge_id = p_challenge_id and user_id = current_user_id;

  if participant_role is null then
    return false;
  end if;
  if participant_role = 'owner' then
    raise exception 'Chủ nhóm không thể rời thử thách. Hãy hủy thử thách nếu không muốn tiếp tục.';
  end if;

  delete from public.challenge_checkins
  where challenge_id = p_challenge_id and user_id = current_user_id;
  delete from public.challenge_participants
  where challenge_id = p_challenge_id and user_id = current_user_id;
  return true;
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
  if current_user_id is null then raise exception 'Bạn cần đăng nhập để tham gia thử thách.'; end if;
  select * into selected_challenge
  from public.challenges
  where invite_code = upper(trim(coalesce(p_invite_code, '')))
  for update;
  if selected_challenge.id is null then raise exception 'Mã mời không tồn tại.'; end if;
  if selected_challenge.mode <> 'crew' then raise exception 'Mã mời này không thuộc thử thách nhóm.'; end if;
  if selected_challenge.status <> 'active'
    or (selected_challenge.end_date is not null and selected_challenge.end_date < today_vn)
  then raise exception 'Thử thách đã kết thúc hoặc bị hủy.'; end if;
  if exists (
    select 1 from public.challenge_participants
    where challenge_id = selected_challenge.id and user_id = current_user_id
  ) then return selected_challenge.id; end if;
  select count(*) into participant_count
  from public.challenge_participants where challenge_id = selected_challenge.id;
  if participant_count >= selected_challenge.max_members then
    raise exception 'Thử thách nhóm đã đủ thành viên.';
  end if;
  insert into public.challenge_participants (challenge_id, user_id, role)
  values (selected_challenge.id, current_user_id, 'member');
  return selected_challenge.id;
end;
$$;

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
    challenge_id, user_id, checkin_date, source_type, source_id, metadata
  )
  select challenge.id, p_user_id, today_vn, p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb)
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id and participant.user_id = p_user_id
  where challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn >= challenge.start_date
    and (challenge.end_date is null or today_vn <= challenge.end_date)
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
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
  if current_user_id is null then raise exception 'Bạn cần đăng nhập để điểm danh.'; end if;
  insert into public.challenge_checkins (challenge_id, user_id, checkin_date, source_type)
  select challenge.id, current_user_id, today_vn, 'manual'
  from public.challenges challenge
  join public.challenge_participants participant
    on participant.challenge_id = challenge.id and participant.user_id = current_user_id
  where challenge.id = p_challenge_id
    and challenge.status = 'active'
    and challenge.challenge_type = 'daily_checkin'
    and today_vn >= challenge.start_date
    and (challenge.end_date is null or today_vn <= challenge.end_date)
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;

drop function if exists public.get_user_challenge_summaries();
create function public.get_user_challenge_summaries()
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
  user_checkin_count bigint,
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
        and challenge.end_date is not null
        and challenge.end_date < (timezone('Asia/Ho_Chi_Minh', now()))::date
      then 'completed'
      else challenge.status
    end,
    challenge.target,
    challenge.invite_code,
    challenge.max_members,
    challenge.created_at,
    count(distinct all_participants.user_id),
    count(distinct today_checkins.user_id),
    count(distinct my_checkins.checkin_date),
    bool_or(today_checkins.user_id = auth.uid())
  from public.challenge_participants mine
  join public.challenges challenge on challenge.id = mine.challenge_id
  join public.challenge_participants all_participants on all_participants.challenge_id = challenge.id
  left join public.challenge_checkins today_checkins
    on today_checkins.challenge_id = challenge.id
   and today_checkins.checkin_date = (timezone('Asia/Ho_Chi_Minh', now()))::date
  left join public.challenge_checkins my_checkins
    on my_checkins.challenge_id = challenge.id
   and my_checkins.user_id = auth.uid()
  where mine.user_id = auth.uid()
  group by challenge.id
  order by
    case
      when challenge.status = 'active'
        and (challenge.end_date is null or challenge.end_date >= (timezone('Asia/Ho_Chi_Minh', now()))::date)
      then 0 else 1
    end,
    challenge.created_at desc;
$$;

revoke all on table public.challenge_templates from anon;
grant select on table public.challenge_templates to authenticated;

revoke all on function public.create_custom_challenge(text, text, text, integer) from public;
revoke all on function public.start_challenge_template(uuid) from public;
revoke all on function public.leave_challenge(uuid) from public;
revoke all on function public.get_user_challenge_summaries() from public;
grant execute on function public.create_custom_challenge(text, text, text, integer) to authenticated;
grant execute on function public.start_challenge_template(uuid) to authenticated;
grant execute on function public.leave_challenge(uuid) to authenticated;
grant execute on function public.get_user_challenge_summaries() to authenticated;
