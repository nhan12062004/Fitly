-- Keep all default Challenge copy in Vietnamese, including rows created before
-- the Vietnamese UI update and rows created by older deployed RPC definitions.

update public.challenges
set
  title = case title
    when '7-Day Check-in Challenge' then 'Thử thách điểm danh 7 ngày'
    when '7-Day Crew Check-in' then 'Thử thách nhóm 7 ngày'
    else title
  end,
  description = case description
    when 'Complete at least 1 healthy action per day.'
      then 'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.'
    when 'Keep the habit going together for 7 days.'
      then 'Cùng nhau duy trì thói quen lành mạnh trong 7 ngày.'
    else description
  end,
  updated_at = now()
where title in ('7-Day Check-in Challenge', '7-Day Crew Check-in')
   or description in (
     'Complete at least 1 healthy action per day.',
     'Keep the habit going together for 7 days.'
   );

update public.user_notifications
set
  title = case title
    when 'Your crew completed today’s challenge'
      then 'Cả nhóm đã hoàn thành thử thách hôm nay'
    when 'You completed today’s challenge'
      then 'Bạn đã hoàn thành thử thách hôm nay'
    when 'Keep the habit going'
      then 'Hãy duy trì thói quen'
    else title
  end,
  message = replace(
    replace(
      replace(message, 'Crew của bạn', 'Nhóm của bạn'),
      'Crew đã có',
      'Nhóm đã có'
    ),
    'Your crew is waiting for your check-in.',
    'Nhóm đang chờ bạn điểm danh.'
  ),
  updated_at = now()
where source_type = 'challenge';

create or replace function public.localize_default_challenge_copy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.title = '7-Day Check-in Challenge' then
    new.title := 'Thử thách điểm danh 7 ngày';
  elsif new.title = '7-Day Crew Check-in' then
    new.title := 'Thử thách nhóm 7 ngày';
  end if;

  if new.description = 'Complete at least 1 healthy action per day.' then
    new.description := 'Hoàn thành ít nhất một hành động lành mạnh mỗi ngày.';
  elsif new.description = 'Keep the habit going together for 7 days.' then
    new.description := 'Cùng nhau duy trì thói quen lành mạnh trong 7 ngày.';
  end if;

  return new;
end;
$$;

drop trigger if exists localize_default_challenge_copy on public.challenges;
create trigger localize_default_challenge_copy
  before insert or update of title, description
  on public.challenges
  for each row execute function public.localize_default_challenge_copy();
