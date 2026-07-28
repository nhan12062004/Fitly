# Technical debt

## Deferred database baseline and RLS verification

Phase 3A database-baseline work is deferred. The repository does not contain the complete historical migration chain, and this environment has no Docker-compatible local Supabase/Postgres runtime. Production profile/avatar policies were inspected read-only, but they have not been replayed and tested automatically against a clean database.

Do not claim database-level RLS has end-to-end automated verification until a Docker or isolated test-database environment is available. Current backend tests mock Supabase; they validate application client boundaries and ownership handling, not the database policy engine.

The future baseline phase must use schema-only inventory, no production rows or secrets, and must never run a baseline reset against production.
