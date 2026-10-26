begin;
-- Internal helper: the table and key allowlists come only from the public RPC,
-- never from the caller. Typed records retain native DB validation.
create function public.write_survey_row(p_table text, p_allowed text[], p_payload jsonb, p_user_id uuid, p_upsert boolean)
returns void language plpgsql set search_path = '' as $$
declare columns text; selected text; assignments text; keys text[];
begin
  if jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 24000 then raise exception 'Invalid survey data'; end if;
  select array_agg(key order by key) into keys from jsonb_object_keys(p_payload) key;
  if not coalesce(keys,'{}') <@ p_allowed then raise exception using errcode = '42501', message = 'Unexpected survey field'; end if;
  select string_agg(format('%I',key),','),string_agg(format('r.%I',key),','),string_agg(format('%I=excluded.%I',key,key),',')
    into columns,selected,assignments from unnest(keys) key;
  if columns is null then raise exception 'Empty survey'; end if;
  execute format('insert into public.%I(user_id,%s) select $1,%s from jsonb_populate_record(null::public.%I,$2) r %s',
    p_table,columns,selected,p_table,case when p_upsert then 'on conflict(user_id) do update set ' || assignments else '' end)
    using p_user_id,p_payload;
end;
$$;
revoke all on function public.write_survey_row(text,text[],jsonb,uuid,boolean) from public,anon,authenticated;

create function public.save_onboarding_survey(p_profile jsonb, p_body jsonb, p_lifestyle jsonb, p_health jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); verified_email text;
begin
  if uid is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if jsonb_typeof(p_profile) <> 'object' or octet_length(p_profile::text) > 2000
    or exists(select 1 from jsonb_object_keys(p_profile) key where key not in ('full_name','email','gender','birthday','updated_at'))
    or length(p_profile->>'full_name') > 120 then raise exception 'Invalid profile'; end if;
  if coalesce((p_body->>'height')::numeric,0) not between 80 and 250 or coalesce((p_body->>'weight')::numeric,0) not between 20 and 350
    or coalesce((p_body->>'target_weight')::numeric,0) not between 20 and 350 then raise exception 'Invalid body metrics'; end if;
  if coalesce((p_lifestyle->>'weekly_workouts')::integer,0) not between 1 and 7 or coalesce((p_lifestyle->>'meals_per_day')::integer,0) not between 1 and 8
    or coalesce((p_health->>'sleep_hours')::numeric,-1) not between 0 and 24 then raise exception 'Invalid survey values'; end if;
  select email into verified_email from auth.users where id = uid;
  insert into public.profiles(id,full_name,email,gender,birthday)
    values(uid,p_profile->>'full_name',verified_email,p_profile->>'gender',(p_profile->>'birthday')::date)
    on conflict(id) do update set full_name=excluded.full_name,email=excluded.email,gender=excluded.gender,birthday=excluded.birthday;
  perform public.write_survey_row('body_metrics',array['height','weight','target_weight','body_fat','neck','waist','hips'],p_body,uid,false);
  perform public.write_survey_row('lifestyle_settings',array['activity_level','weekly_workouts','fitness_goal','diet_preference','cooking_ability','current_diet',
    'workout_location','workout_time','workout_duration','equipment_available','experience_level','meals_per_day','daily_water_goal','target_calories',
    'motivation','expectations','dietary_restrictions','diet_styles','budget_level','updated_at'],p_lifestyle,uid,true);
  perform public.write_survey_row('health_conditions',array['health_condition','medical_history','allergies','injuries','medications','smoke_drink','stress_level',
    'sleep_quality','sleep_hours','updated_at'],p_health,uid,true);
end;
$$;
revoke all on function public.save_onboarding_survey(jsonb,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_onboarding_survey(jsonb,jsonb,jsonb,jsonb) to authenticated;
commit;
