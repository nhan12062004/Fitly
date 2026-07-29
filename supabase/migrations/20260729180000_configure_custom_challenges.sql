-- Custom challenges need a concrete activity target and a deliberately chosen
-- crew size.  Existing challenges keep their original all-activity behaviour.
CREATE OR REPLACE FUNCTION public.create_configured_challenge(
  p_title text,
  p_description text DEFAULT NULL,
  p_mode text DEFAULT 'solo',
  p_duration_days integer DEFAULT 7,
  p_goal_key text DEFAULT 'any',
  p_max_members integer DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
declare
  current_user_id uuid := auth.uid();
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
  new_challenge_id uuid;
  new_invite_code text;
  normalized_goal text := lower(trim(coalesce(p_goal_key, 'any')));
  normalized_member_limit integer := coalesce(p_max_members, 1);
  goal_label text;
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
  if normalized_goal not in ('any', 'workout', 'meal', 'water', 'sleep') then
    raise exception 'Mục tiêu thử thách không hợp lệ.';
  end if;
  if p_mode = 'solo' then
    normalized_member_limit := 1;
  elsif normalized_member_limit < 2 or normalized_member_limit > 5 then
    raise exception 'Nhóm cần từ 2 đến 5 thành viên.';
  end if;

  goal_label := case normalized_goal
    when 'workout' then 'Hoàn thành buổi tập mỗi ngày'
    when 'meal' then 'Hoàn thành bữa ăn theo kế hoạch mỗi ngày'
    when 'water' then 'Ghi nhận lượng nước mỗi ngày'
    when 'sleep' then 'Ghi nhận giấc ngủ mỗi ngày'
    else 'Hoàn thành một hoạt động lành mạnh mỗi ngày'
  end;

  if p_mode = 'crew' then
    loop
      new_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from public.challenges where invite_code = new_invite_code);
    end loop;
  end if;

  insert into public.challenges (
    created_by, title, description, mode, challenge_type, start_date, end_date,
    target, invite_code, max_members
  ) values (
    current_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Thử thách của tôi'), 80),
    left(coalesce(nullif(trim(p_description), ''), goal_label), 500),
    p_mode,
    'daily_checkin',
    today_vn,
    case when p_duration_days is null then null else today_vn + p_duration_days - 1 end,
    jsonb_build_object(
      'healthy_actions_per_day', 1,
      'duration_days', p_duration_days,
      'goal_key', normalized_goal,
      'goal_label', goal_label
    ),
    new_invite_code,
    normalized_member_limit
  ) returning id into new_challenge_id;

  insert into public.challenge_participants (challenge_id, user_id, role)
  values (new_challenge_id, current_user_id, 'owner');

  return new_challenge_id;
end;
$$;

-- A specific challenge is fulfilled only by the activity it was created for.
-- Challenges created before this migration have no goal_key and remain flexible.
CREATE OR REPLACE FUNCTION public.sync_challenge_checkin_for_user(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
    and (
      coalesce(challenge.target ->> 'goal_key', 'any') = 'any'
      or challenge.target ->> 'goal_key' = p_source_type
    )
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

CREATE OR REPLACE FUNCTION public.manual_challenge_checkin(p_challenge_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
    and coalesce(challenge.target ->> 'goal_key', 'any') = 'any'
    and today_vn >= challenge.start_date
    and (challenge.end_date is null or today_vn <= challenge.end_date)
  on conflict (challenge_id, user_id, checkin_date) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count > 0;
end;
$$;

REVOKE ALL ON FUNCTION public.create_configured_challenge(text, text, text, integer, text, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_configured_challenge(text, text, text, integer, text, integer) TO authenticated, service_role;
