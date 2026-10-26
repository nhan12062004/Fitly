-- A schema dump's GRANT statements add privileges; they do not replace grants
-- inherited from the Supabase stack's pre-existing default privileges. Repair
-- both fresh restores and databases which already applied the baseline.
begin;

revoke all on all tables in schema public from public, anon;
revoke all on all sequences in schema public from public, anon;
alter default privileges for role postgres revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres revoke all on sequences from public, anon, authenticated;
-- PostgreSQL's global PUBLIC EXECUTE default cannot be removed per-schema.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke all on public.profiles from authenticated;
-- Table-level REVOKE does not remove old column-level grants.
do $$
declare columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns
  from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke all (%s) on public.profiles from public, anon, authenticated', columns);
end;
$$;
grant select on public.profiles to authenticated;
grant insert(id, full_name, email, gender, birthday, updated_at, avatar_url),
  update(full_name, email, gender, birthday, updated_at, avatar_url)
  on public.profiles to authenticated;

revoke all on public.ai_quota_usage_events, public.ai_recommendations from authenticated;
grant all on public.ai_quota_usage_events, public.ai_recommendations, public.profiles to service_role;
revoke insert, update, delete on public.exercises from authenticated;

-- The baseline's service-only RPCs can also inherit API-role EXECUTE grants.
-- Scope this reset to the known legacy app functions, leaving platform and
-- extension functions alone. Restore the original signed-in client RPC list.
do $$
declare target record;
begin
  for target in
    select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'add_exp', 'apply_workout_adjustment_atomically', 'compute_level',
      'create_crew_challenge', 'create_custom_challenge', 'create_default_solo_after_onboarding',
      'create_solo_challenge', 'ensure_active_solo_challenge', 'ensure_default_solo_challenge_for_user',
      'generate_ref_code', 'get_challenge_participant_progress', 'get_user_challenge_summaries',
      'guard_profile_system_fields', 'handle_new_user_role', 'is_challenge_participant',
      'join_challenge_by_invite_code', 'leave_challenge', 'localize_default_challenge_copy',
      'manual_challenge_checkin', 'materialize_daily_workout_from_plan_atomically',
      'start_challenge_template', 'sync_challenge_checkin', 'sync_challenge_checkin_for_user',
      'sync_challenge_checkin_from_activity', 'trg_exp_on_meal', 'trg_exp_on_progress',
      'trg_exp_on_workout', 'trg_on_referral', 'trg_set_ref_code'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', target.signature);
    execute format('grant execute on function %s to service_role', target.signature);
  end loop;
end;
$$;
grant execute on function public.create_crew_challenge(text),
  public.create_custom_challenge(text,text,text,integer),
  public.create_solo_challenge(text), public.ensure_active_solo_challenge(),
  public.get_challenge_participant_progress(uuid), public.get_user_challenge_summaries(),
  public.is_challenge_participant(uuid,uuid), public.join_challenge_by_invite_code(text),
  public.leave_challenge(uuid), public.manual_challenge_checkin(uuid),
  public.start_challenge_template(uuid), public.sync_challenge_checkin(text,uuid,jsonb)
  to authenticated;

-- Readiness must reject a database where the application migrations ran but
-- this inherited-ACL repair was omitted.
create function public.production_security_patch_version() returns integer
language sql immutable set search_path = '' as $$ select 1 $$;
revoke all on function public.production_security_patch_version() from public, anon, authenticated;
grant execute on function public.production_security_patch_version() to service_role;

commit;
