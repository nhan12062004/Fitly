-- Check-ins for tracked goals must come from activity triggers. The public RPC
-- accepted an arbitrary source type and the table allowed direct client inserts.
revoke execute on function public.sync_challenge_checkin(text, uuid, jsonb)
  from public, anon, authenticated;
revoke insert, update, delete on public.challenges, public.challenge_participants
  from authenticated;
revoke insert, update, delete on public.challenge_checkins from authenticated;
drop policy if exists challenge_checkins_self_insert on public.challenge_checkins;

-- A workout counts after completion, not when the first set or session starts.
create or replace function public.sync_challenge_checkin_from_activity()
returns trigger language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  today_vn date := (timezone('Asia/Ho_Chi_Minh', now()))::date;
begin
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
        and new.sleep_hours is distinct from old.sleep_hours then
        perform public.sync_challenge_checkin_for_user(new.user_id, 'sleep', new.id);
      end if;
    end if;
  elsif tg_table_name = 'daily_meal_logs' then
    if new.is_completed is true
      and (tg_op = 'INSERT' or old.is_completed is distinct from true) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'meal', new.id);
    end if;
  elsif tg_table_name = 'daily_workout_sessions' then
    if (new.status = 'completed' or new.completed_at is not null)
      and (tg_op = 'INSERT' or (old.status is distinct from 'completed'
        and old.completed_at is null)) then
      perform public.sync_challenge_checkin_for_user(new.user_id, 'workout', new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists challenge_checkin_from_exercise on public.daily_exercise_sessions;

-- Other server paths (for example content moderation) can cancel a challenge.
-- Record the final day for every cancellation so streaks stop changing later.
create function public.stamp_cancelled_challenge_date()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.target := coalesce(new.target, '{}'::jsonb)
      || jsonb_build_object('cancelled_date', (timezone('Asia/Ho_Chi_Minh', now()))::date);
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_cancelled_challenge_date() from public, anon, authenticated;
create trigger stamp_cancelled_challenge_date
before update of status on public.challenges
for each row execute function public.stamp_cancelled_challenge_date();

-- Owners need a way to stop a challenge, especially one without an end date.
create function public.cancel_challenge(p_challenge_id uuid)
returns boolean language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để hủy thử thách.';
  end if;
  update public.challenges
  set status = 'cancelled'
  where id = p_challenge_id
    and created_by = auth.uid()
    and status = 'active'
    and (end_date is null or end_date >= (timezone('Asia/Ho_Chi_Minh', now()))::date);
  get diagnostics changed_count = row_count;
  return changed_count > 0;
end;
$$;
revoke all on function public.cancel_challenge(uuid) from public, anon;
grant execute on function public.cancel_challenge(uuid) to authenticated, service_role;

-- Lock the challenge row just like the join RPC so a code change and a join
-- cannot race. An old code stops working as soon as this transaction commits.
create function public.rotate_challenge_invite_code(p_challenge_id uuid)
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để đổi mã mời.';
  end if;
  perform 1 from public.challenges
  where id = p_challenge_id
    and created_by = auth.uid()
    and mode = 'crew'
    and status = 'active'
    and (end_date is null or end_date >= (timezone('Asia/Ho_Chi_Minh', now()))::date)
  for update;
  if not found then
    raise exception 'Bạn không thể đổi mã mời của thử thách này.';
  end if;
  loop
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      update public.challenges set invite_code = new_code where id = p_challenge_id;
      return new_code;
    exception when unique_violation then
      -- The database unique constraint is the final collision guard.
    end;
  end loop;
end;
$$;
revoke all on function public.rotate_challenge_invite_code(uuid) from public, anon;
grant execute on function public.rotate_challenge_invite_code(uuid) to authenticated, service_role;
