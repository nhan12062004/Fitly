# Technical debt

## Database baseline and RLS verification

A schema-only public-schema baseline now exists at
`supabase/migrations/20260728000000_schema_baseline.sql`. It was generated from a
read-only schema inventory of the linked project, with no production rows,
credentials, API keys, or auth records. A clean local Supabase database has been
reset repeatedly with this migration set, and the transactional pgTAP ownership
suite passes all 16 assertions.

The baseline is a reviewed state snapshot rather than a reconstruction of the
unavailable historical migration chain. Any future production schema drift must
be captured in a reviewed migration (or a carefully regenerated schema-only
baseline) and verified locally before deployment. Storage objects remain managed
by the dedicated migration because the local Supabase platform owns the `storage`
schema.

## RLS policy performance follow-up

The local performance advisor still reports repeated `auth.uid()` evaluations in
several RLS policies and two pairs of duplicate indexes (`ai_plan_adjustments` and
`challenge_checkins`). These are performance improvements outside PR 3's
ownership-correctness scope and should be handled in a separately benchmarked
migration.

## Multi-instance operational scheduling

Update 2026-10-26: database job claims and standalone cron entrypoints have been added. See [the hardening release](hardening-release-2026-10-26.md) for current deployment requirements; the original note below describes the earlier implementation.

The current premium auto-planner is isolated from the HTTP app and opt-in through `ENABLE_JOBS`, but remains in-process work. This is suitable only while a single Render web instance owns scheduling. It is not an exactly-once guarantee across horizontally scaled instances or deployment overlap.

When scaling, move each schedule to a Render Cron Job or dedicated worker and leave `ENABLE_JOBS=false` on web instances.
