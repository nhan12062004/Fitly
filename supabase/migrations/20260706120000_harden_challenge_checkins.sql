-- Keep one scored check-in per participant and challenge day.
-- Challenge RPCs must handle unique-violation retries as an existing check-in.
create unique index if not exists challenge_checkins_unique_daily
  on public.challenge_checkins (challenge_id, user_id, checkin_date);

-- A measurable source (for example one workout session) must not be reused.
-- Manual check-ins have no source id, so PostgreSQL still permits them.
create unique index if not exists challenge_checkins_unique_source
  on public.challenge_checkins (challenge_id, user_id, source_type, source_id)
  where source_id is not null;
