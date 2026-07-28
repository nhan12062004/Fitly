begin;

-- Existing administrators are migrated to immutable Auth app metadata before
-- the API stops trusting the client-readable profiles.role column.
update auth.users as auth_user
set raw_app_meta_data =
  coalesce(auth_user.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'admin')
from public.profiles as profile
where profile.id = auth_user.id
  and profile.role = 'admin';

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  assigned_role text := case
    when lower(coalesce(new.raw_app_meta_data ->> 'role', '')) = 'admin' then 'admin'
    else 'user'
  end;
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    lower(new.email),
    assigned_role
  )
  on conflict (id) do update
  set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = excluded.email,
    role = case
      when excluded.role = 'admin' then 'admin'
      else public.profiles.role
    end,
    updated_at = timezone('utc', now());

  return new;
end;
$function$;

revoke all on function public.handle_new_user_role() from public, anon, authenticated;

-- Browser clients do not need any anonymous table or sequence privileges.
-- Authentication endpoints are in the auth schema and are unaffected.
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

-- Catalog data is available after authentication. Admin writes continue to use
-- the service role and are not affected by these policies.
drop policy if exists public_select_policy on public.exercises;
create policy exercises_authenticated_select
on public.exercises
for select
to authenticated
using (true);

drop policy if exists recipes_active_read on public.recipes;
create policy recipes_authenticated_select
on public.recipes
for select
to authenticated
using (is_active = true);

drop policy if exists recipe_ingredients_active_read on public.recipe_ingredients;
create policy recipe_ingredients_authenticated_select
on public.recipe_ingredients
for select
to authenticated
using (
  exists (
    select 1
    from public.recipes
    where recipes.id = recipe_ingredients.recipe_id
      and recipes.is_active = true
  )
);

drop policy if exists owner_policy on public.daily_exercise_set_logs;
create policy daily_exercise_set_logs_owner
on public.daily_exercise_set_logs
for all
to authenticated
using (
  exists (
    select 1
    from public.daily_exercise_sessions as session
    where session.id = daily_exercise_set_logs.daily_exercise_session_id
      and session.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.daily_exercise_sessions as session
    where session.id = daily_exercise_set_logs.daily_exercise_session_id
      and session.user_id = (select auth.uid())
  )
);

-- These tables are written only by the trusted backend.
revoke all privileges on table
  public.ai_quota_usage_events,
  public.ai_recommendations,
  public.telegram_reminder_dispatches
from authenticated;

-- Replace the broad profiles policy and table-level write grants with explicit
-- row and column permissions. Membership, role, quota and gamification fields
-- can no longer be changed from a browser session.
drop policy if exists owner_policy on public.profiles;

create policy profiles_owner_select
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_owner_insert
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

grant insert (
  id,
  full_name,
  email,
  gender,
  birthday,
  updated_at,
  referred_by,
  avatar_url,
  telegram_chat_id,
  telegram_notify_water,
  telegram_notify_sleep,
  telegram_notify_workout
) on table public.profiles to authenticated;

grant update (
  full_name,
  email,
  gender,
  birthday,
  updated_at,
  referred_by,
  avatar_url,
  telegram_chat_id,
  telegram_notify_water,
  telegram_notify_sleep,
  telegram_notify_workout
) on table public.profiles to authenticated;

create or replace function public.guard_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public, auth
as $function$
begin
  if current_user in ('anon', 'authenticated') and (
    new.id is distinct from old.id
    or new.role is distinct from old.role
    or new.membership_tier is distinct from old.membership_tier
    or new.membership_expires_at is distinct from old.membership_expires_at
    or new.has_purchased_plus is distinct from old.has_purchased_plus
    or new.has_purchased_pro is distinct from old.has_purchased_pro
    or new.ai_coach_free_used_at is distinct from old.ai_coach_free_used_at
    or new.exp is distinct from old.exp
    or new.level is distinct from old.level
    or new.ref_code is distinct from old.ref_code
    or new.referral_count is distinct from old.referral_count
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'Protected profile fields can only be changed by the trusted backend.';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_profile_system_fields on public.profiles;
create trigger guard_profile_system_fields
before update on public.profiles
for each row
execute function public.guard_profile_system_fields();

revoke all on function public.guard_profile_system_fields() from public, anon, authenticated;

-- Trigger-only and helper functions execute with their owner privileges so
-- normal user writes do not require direct UPDATE access to protected columns.
alter function public.add_exp(uuid, integer) security definer;
alter function public.add_exp(uuid, integer)
  set search_path = pg_catalog, public, pg_temp;
alter function public.compute_level(integer)
  set search_path = pg_catalog, public, pg_temp;
alter function public.generate_ref_code()
  set search_path = pg_catalog, public, pg_temp;
alter function public.trg_set_ref_code() security definer;
alter function public.trg_set_ref_code()
  set search_path = pg_catalog, public, pg_temp;
alter function public.trg_exp_on_workout() security definer;
alter function public.trg_exp_on_workout()
  set search_path = pg_catalog, public, pg_temp;
alter function public.trg_exp_on_meal() security definer;
alter function public.trg_exp_on_meal()
  set search_path = pg_catalog, public, pg_temp;
alter function public.trg_exp_on_progress() security definer;
alter function public.trg_exp_on_progress()
  set search_path = pg_catalog, public, pg_temp;
alter function public.trg_on_referral() security definer;
alter function public.trg_on_referral()
  set search_path = pg_catalog, public, pg_temp;
alter function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb)
  set search_path = pg_catalog, public, pg_temp;
alter function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb)
  set search_path = pg_catalog, public, pg_temp;

revoke all on function public.add_exp(uuid, integer) from public, anon, authenticated;
revoke all on function public.compute_level(integer) from public, anon, authenticated;
revoke all on function public.generate_ref_code() from public, anon, authenticated;
revoke all on function public.trg_set_ref_code() from public, anon, authenticated;
revoke all on function public.trg_exp_on_workout() from public, anon, authenticated;
revoke all on function public.trg_exp_on_meal() from public, anon, authenticated;
revoke all on function public.trg_exp_on_progress() from public, anon, authenticated;
revoke all on function public.trg_on_referral() from public, anon, authenticated;
revoke all on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb)
  from public, anon, authenticated;
revoke all on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb)
  from public, anon, authenticated;

grant execute on function public.add_exp(uuid, integer) to service_role;
grant execute on function public.compute_level(integer) to service_role;
grant execute on function public.generate_ref_code() to service_role;
grant execute on function public.apply_workout_adjustment_atomically(uuid, uuid, text, uuid, integer, date, jsonb)
  to service_role;
grant execute on function public.materialize_daily_workout_from_plan_atomically(uuid, uuid, date, jsonb)
  to service_role;

-- Remove two unused database-export RPCs that exposed schema/data through the
-- public API.
drop function if exists public.export_all_public_tables_as_sql();
drop function if exists public.export_public_tables_structure();

-- SECURITY DEFINER RPCs intended for signed-in users have explicit grants.
-- Internal helpers and trigger functions are not callable through PostgREST.
revoke all on function public.ensure_default_solo_challenge_for_user(uuid)
  from public, anon, authenticated;
revoke all on function public.is_challenge_participant(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sync_challenge_checkin_for_user(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_default_solo_after_onboarding()
  from public, anon, authenticated;
revoke all on function public.sync_challenge_checkin_from_activity()
  from public, anon, authenticated;

grant execute on function public.ensure_default_solo_challenge_for_user(uuid) to service_role;
grant execute on function public.is_challenge_participant(uuid, uuid) to service_role;
grant execute on function public.sync_challenge_checkin_for_user(uuid, text, uuid, jsonb) to service_role;

revoke all on function public.create_crew_challenge(text) from public, anon;
revoke all on function public.create_custom_challenge(text, text, text, integer) from public, anon;
revoke all on function public.create_solo_challenge(text) from public, anon;
revoke all on function public.ensure_active_solo_challenge() from public, anon;
revoke all on function public.get_challenge_participant_progress(uuid) from public, anon;
revoke all on function public.get_user_challenge_summaries() from public, anon;
revoke all on function public.join_challenge_by_invite_code(text) from public, anon;
revoke all on function public.leave_challenge(uuid) from public, anon;
revoke all on function public.manual_challenge_checkin(uuid) from public, anon;
revoke all on function public.start_challenge_template(uuid) from public, anon;
revoke all on function public.sync_challenge_checkin(text, uuid, jsonb) from public, anon;

grant execute on function public.create_crew_challenge(text) to authenticated, service_role;
grant execute on function public.create_custom_challenge(text, text, text, integer) to authenticated, service_role;
grant execute on function public.create_solo_challenge(text) to authenticated, service_role;
grant execute on function public.ensure_active_solo_challenge() to authenticated, service_role;
grant execute on function public.get_challenge_participant_progress(uuid) to authenticated, service_role;
grant execute on function public.get_user_challenge_summaries() to authenticated, service_role;
grant execute on function public.join_challenge_by_invite_code(text) to authenticated, service_role;
grant execute on function public.leave_challenge(uuid) to authenticated, service_role;
grant execute on function public.manual_challenge_checkin(uuid) to authenticated, service_role;
grant execute on function public.start_challenge_template(uuid) to authenticated, service_role;
grant execute on function public.sync_challenge_checkin(text, uuid, jsonb) to authenticated, service_role;

-- Public object URLs keep working for this public bucket. Listing and upsert
-- operations are limited to the signed-in user's UUID folder.
drop policy if exists "Public read avatars" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can upload their own avatar" on storage.objects;

create policy "Users can read their own avatar metadata"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload their own avatar"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can update their own avatar"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own avatar"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

update storage.buckets
set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
where id = 'avatars';

commit;
