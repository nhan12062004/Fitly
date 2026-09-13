-- Blocking removes shared membership and prevents future shared groups.
create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;
create policy user_blocks_owner on public.user_blocks for all to authenticated
  using ((select auth.uid()) = blocker_id) with check ((select auth.uid()) = blocker_id);

create function public.remove_blocked_shared_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.challenges challenge where challenge.id in (
    select member.challenge_id from public.challenge_participants member
    where member.user_id in (new.blocker_id, new.blocked_id)
  ) order by challenge.id for update;
  delete from public.challenge_checkins checkin using public.challenges challenge
  where checkin.challenge_id = challenge.id and (
    (challenge.created_by = new.blocker_id and checkin.user_id = new.blocked_id) or
    (challenge.created_by <> new.blocker_id and checkin.user_id = new.blocker_id and exists (
      select 1 from public.challenge_participants member where member.challenge_id = challenge.id and member.user_id = new.blocked_id
    ))
  );
  delete from public.challenge_participants participant using public.challenges challenge
  where participant.challenge_id = challenge.id and (
    (challenge.created_by = new.blocker_id and participant.user_id = new.blocked_id) or
    (challenge.created_by <> new.blocker_id and participant.user_id = new.blocker_id and exists (
      select 1 from public.challenge_participants member where member.challenge_id = challenge.id and member.user_id = new.blocked_id
    ))
  );
  return new;
end;
$$;
create trigger remove_blocked_shared_memberships after insert on public.user_blocks
  for each row execute function public.remove_blocked_shared_memberships();

create function public.reject_blocked_challenge_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize with joining the same group so two concurrent joins cannot bypass blocking.
  perform 1 from public.challenges where id = new.challenge_id for update;
  if exists (
    select 1 from public.challenge_participants member join public.user_blocks block
      on (block.blocker_id = new.user_id and block.blocked_id = member.user_id)
      or (block.blocked_id = new.user_id and block.blocker_id = member.user_id)
    where member.challenge_id = new.challenge_id
  ) then raise exception 'Không thể tham gia nhóm này do lựa chọn chặn thành viên.'; end if;
  return new;
end;
$$;
create trigger reject_blocked_challenge_membership before insert or update on public.challenge_participants
  for each row execute function public.reject_blocked_challenge_membership();

create function public.get_blocked_users() returns table(user_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select block.blocked_id, coalesce(nullif(trim(profile.full_name), ''), 'Thành viên Fitly')
  from public.user_blocks block join public.profiles profile on profile.id = block.blocked_id
  where block.blocker_id = (select auth.uid()) order by block.created_at desc;
$$;
revoke all on function public.get_blocked_users() from public, anon;
grant execute on function public.get_blocked_users() to authenticated;

-- Small initial harassment filter; reports and human review remain necessary.
create table public.community_blocked_phrases (
  phrase text primary key check (length(phrase) >= 3)
);
revoke all on public.community_blocked_phrases from public, anon, authenticated;
grant all on public.community_blocked_phrases to service_role;
alter table public.community_blocked_phrases enable row level security;
insert into public.community_blocked_phrases values ('địt mẹ'), ('đụ má'), ('fuck you'), ('kill yourself');
create function public.check_community_text() returns trigger
language plpgsql security definer set search_path = '' as $$
declare content text;
begin
  if tg_table_name = 'profiles' then content := coalesce(new.full_name, '');
  else content := coalesce(new.title, '') || ' ' || coalesce(new.description, ''); end if;
  content := lower(regexp_replace(content, '\s+', ' ', 'g'));
  if exists (select 1 from public.community_blocked_phrases where strpos(content, phrase) > 0) then
    raise exception 'Nội dung có ngôn từ quấy rối. Hãy chỉnh sửa trước khi lưu.';
  end if;
  return new;
end;
$$;
create trigger check_community_profile_text before insert or update of full_name on public.profiles
  for each row execute function public.check_community_text();
create trigger check_community_challenge_text before insert or update of title, description on public.challenges
  for each row execute function public.check_community_text();

alter table public.app_feedback add column target_type text check (target_type in ('challenge', 'user'));
alter table public.app_feedback add column target_id uuid;
alter table public.app_feedback add constraint feedback_target_pair check ((target_type is null) = (target_id is null));

-- Only backend service role can remove reported content, after checking the admin role.
create function public.remove_reported_content(p_feedback_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare report public.app_feedback%rowtype;
begin
  select * into report from public.app_feedback where id = p_feedback_id for update;
  if not found or report.target_id is null then raise exception 'Báo cáo không có nội dung để gỡ.'; end if;
  if report.target_type = 'challenge' then
    update public.challenges set title = 'Nội dung đã được gỡ', description = null, status = 'cancelled'
      where id = report.target_id;
  elsif report.target_type = 'user' then
    update public.profiles set full_name = 'Thành viên Fitly', avatar_url = null where id = report.target_id;
  end if;
  update public.app_feedback set status = 'resolved' where id = report.id;
end;
$$;
revoke all on function public.remove_reported_content(uuid) from public, anon, authenticated;
grant execute on function public.remove_reported_content(uuid) to service_role;
revoke all on function public.remove_blocked_shared_memberships() from public, anon, authenticated;
revoke all on function public.reject_blocked_challenge_membership() from public, anon, authenticated;
revoke all on function public.check_community_text() from public, anon, authenticated;
