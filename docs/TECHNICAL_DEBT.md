# Technical debt

## Deferred database baseline and RLS verification

Phase 3A database-baseline work is deferred. The repository does not contain the complete historical migration chain, and this environment has no Docker-compatible local Supabase/Postgres runtime. Production profile/avatar policies were inspected read-only, but they have not been replayed and tested automatically against a clean database.

Do not claim database-level RLS has end-to-end automated verification until a Docker or isolated test-database environment is available. Current backend tests mock Supabase; they validate application client boundaries and ownership handling, not the database policy engine.

The future baseline phase must use schema-only inventory, no production rows or secrets, and must never run a baseline reset against production.

## Multi-instance operational scheduling

The current premium auto-planner and Telegram reminders are isolated from the HTTP app and opt-in through `ENABLE_JOBS`, but remain in-process work. This is suitable only while a single Render web instance owns scheduling. It is not an exactly-once guarantee across horizontally scaled instances or deployment overlap.

When scaling, move each schedule to a Render Cron Job or dedicated worker and leave `ENABLE_JOBS=false` on web instances. Telegram polling must also have one explicit process owner.
