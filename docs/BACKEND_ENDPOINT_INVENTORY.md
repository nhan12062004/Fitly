# Backend endpoint inventory

Snapshot taken before PR 1. The API had 38 endpoints; PR 1 adds only `GET /health` and `GET /ready`.

`Service role` means that any Supabase query made by the endpoint uses the current backend singleton configured with `SUPABASE_SERVICE_ROLE_KEY`. There is no request-scoped user Supabase client yet; that is explicitly deferred to PR 2.

| Method | Path | Authentication / admin | User-owned or shared data | Current context | Side effect | Ownership review |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/` | Public | None | None | No | None |
| GET | `/api/profiles` | Auth + admin | All profiles | Service role | No | Admin gate is manual; review when middleware is introduced |
| POST | `/api/membership/renew` | Auth | Current user | None | No; returns 503 | None |
| DELETE | `/api/account` | Auth | Current user account and avatar | Service role | Deletes storage and Auth user | Uses authenticated user ID; destructive path needs integration test |
| GET | `/api/admin/overview` | Auth + admin | Global aggregates | Service role | No | Admin-only |
| GET | `/api/admin/users` | Auth + admin | All profiles | Service role | No | Admin-only |
| GET | `/api/admin/exercises` | Auth + admin | Shared catalog | Service role | No | Admin-only |
| POST | `/api/admin/exercises` | Auth + admin | Shared catalog | Service role | Creates catalog item | Admin-only |
| PUT | `/api/admin/exercises/:id` | Auth + admin | Shared catalog | Service role | Updates catalog item | Admin-only |
| DELETE | `/api/admin/exercises/:id` | Auth + admin | Shared catalog | Service role | Deletes catalog item | Admin-only |
| POST | `/api/meal-plans/validate-foods` | Auth | Current profile/health plus shared catalog | Service role | No | User filters present; convert to user context in PR 2 |
| GET | `/api/recipes/:id` | Auth | Shared recipe catalog | Service role | No | Shared read is intentional |
| GET | `/api/admin/recipes` | Auth + admin | Shared catalog | Service role | No | Admin-only |
| POST | `/api/admin/recipes` | Auth + admin | Shared catalog | Service role | Creates recipe and ingredients | Admin-only |
| PUT | `/api/admin/recipes/:id` | Auth + admin | Shared catalog | Service role | Updates recipe and ingredients | Admin-only |
| GET | `/api/admin/foods` | Auth + admin | Shared recipe catalog | Service role | No | Admin-only |
| POST | `/api/admin/foods` | Public | None | None | No; returns 400 legacy response | Protect or remove in PR 2 |
| PUT | `/api/admin/foods/:id` | Public | None | None | No; returns 400 legacy response | Protect or remove in PR 2 |
| DELETE | `/api/admin/foods/:id` | Public | None | None | No; returns 400 legacy response | Protect or remove in PR 2 |
| POST | `/api/workout/daily-exercises/from-plan` | Auth | Current user's plans and sessions | Service role | Materializes workout rows | Filters by authenticated user ID |
| POST | `/api/workout/daily-exercises/:exerciseSessionId/replace` | Auth | Current session plus shared catalog | Service role | AI call, updates session, writes adjustment/quota | Filters session by authenticated user ID |
| POST | `/api/workout/daily-exercises` | Auth | Current user's sessions | Service role | Creates workout rows | Filters/inserts with authenticated user ID |
| POST | `/api/workout/daily-exercises/:exerciseSessionId/config` | Auth | Current user's session | Service role | Updates session | Filters by authenticated user ID |
| POST | `/api/workout/daily-exercises/:exerciseSessionId/completion` | Auth | Current user's session and set logs | Service role | Updates/inserts/deletes logs | Filters parent session by authenticated user ID |
| POST | `/api/workout/daily-exercises/:exerciseSessionId/complete-set` | Auth | Current user's session and set log | Service role | Updates set completion | Filters parent session by authenticated user ID |
| GET | `/api/ai/quota` | Auth | Current user's quota | Service role | No | Filters by authenticated user ID |
| POST | `/api/ai/chat` | Auth | Current user's plans, logs and chat | Service role | Calls AI and writes chat/quota | User filters present; requires cross-user test |
| POST | `/api/ai/coach-command` | Auth | Current user's tracking and chat | Service role | Writes tracking/chat | User ID comes from authentication |
| POST | `/api/ai/chat/clear` | Auth | Current user's chat | Service role | Deletes chat | Filters by authenticated user ID |
| POST | `/api/ai/apply-adjustment` | Auth | Current user's adjustment and plans | Service role | Updates plans and adjustment | Filters adjustments/plans by authenticated user ID |
| POST | `/api/ai/reject-adjustment` | Auth | Current user's adjustment | Service role | Updates adjustment | Filters by authenticated user ID |
| GET | `/api/ai/metrics` | Auth + admin | Global AI metrics | Service role indirectly | No | Admin gate is manual |
| POST | `/api/ai-coach/generate-daily-workout` | Auth | Current user's workout data | Service role | AI call and writes workout data | User ID comes from authentication |
| POST | `/api/ai-coach/generate-weekly-plan` | Auth | Current user's plans and health profile | Service role | AI call and writes plans | User ID comes from authentication |
| POST | `/api/ai-coach/generate-meal-plan` | Auth | Current user's meal adjustment | Service role | AI call and writes adjustment/quota | User ID comes from authentication |
| POST | `/api/ai-coach/record-meal-swap` | Auth | Current user's adjustment | Service role | Writes adjustment/quota | User ID comes from authentication |
| POST | `/api/ai-coach/generate-onboarding-meal-plan` | Auth | Current user's food/workout plans | Service role | AI call and writes food plan | User ID comes from authentication |

## PR 1 operational endpoints

| Method | Path | Authentication | Dependencies checked | Side effect |
| --- | --- | --- | --- | --- |
| GET | `/health` | Public | None | None |
| GET | `/ready` | Public | Required Supabase environment and a head-only `profiles` query | None |

## Phase 2 endpoint classification and first migration slice

| Classification | Endpoints | Current client | Phase 2 decision |
| --- | --- | --- | --- |
| Public | `/`, `/health`, `/ready`, legacy `POST/PUT/DELETE /api/admin/foods*` | None | No change |
| Authenticated user | Membership, meal validation, recipe, workout, AI and AI Coach routes | Service role (except membership, which has no query) | Migrate routes to request-scoped clients where applicable |
| Admin | `/api/profiles`, `/api/admin/*`, `/api/ai/metrics` | Service role | Keep service role; `/api/profiles` now uses shared middleware |
| Mixed user + system operation | `DELETE /api/account` | Service role | Deferred: Auth-user deletion still needs an admin operation |
| System/cron | None | Service role in runtime jobs | No HTTP endpoint to migrate |
| Trusted webhook | None | N/A | No endpoint to migrate |

## Phase 2B profile and avatar slice

| Method | Path | Previous client | Current client | Ownership source | RLS / policy confirmation |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/profile` | Frontend direct user Supabase query; no backend endpoint | `req.supabase` after `requireAuth` | `req.auth.user.id` | `profiles_owner_select` requires `auth.uid() = id` |
| PATCH | `/api/profile` | Frontend direct user Supabase upsert/update; no backend endpoint | `req.supabase` after `requireAuth` | `req.auth.user.id`; request `id`, `user_id`, role and ownership query values are ignored | `profiles_owner_update` has matching `using` and `with check` clauses; authenticated column grants are restricted to safe profile fields |
| PUT | `/api/profile/avatar` | Frontend direct Storage upload and profile upsert; no backend endpoint | `req.supabase.storage` and `req.supabase` after `requireAuth` | `req.auth.user.id`; path is server-built as `<authenticated-user-id>/avatar.<allowed-extension>` | `avatars` Storage INSERT/UPDATE policies require the UUID first folder to equal `auth.uid()`; bucket allows JPEG, PNG, WebP and GIF up to 5 MB |
| DELETE | `/api/profile/avatar` | No backend endpoint | `req.supabase.storage` and `req.supabase` after `requireAuth` | `req.auth.user.id`; server lists and removes only names returned from that user's top-level folder | `avatars` Storage SELECT/DELETE policies require the UUID first folder to equal `auth.uid()` |

RLS was verified twice before this slice: from `supabase/migrations/20260728053215_harden_auth_profiles_and_rpc.sql`, and against the linked production schema by read-only catalog queries on 2026-07-28. The live checks confirmed RLS is enabled on `public.profiles`, the owner SELECT/INSERT/UPDATE policies target `authenticated` and use `auth.uid() = id`, the `avatars` bucket is public for object delivery, and its metadata/upload/update/delete policies restrict the first storage path segment to the authenticated UUID. No production data, schema, policy, or migration was changed.

`GET /api/profiles` remains an admin endpoint and deliberately uses `adminSupabase` after `requireAdmin`. `DELETE /api/account` remains a mixed operation using the admin client because Auth-user deletion is a system action. Admin routes, runtime cron work, AI, workout, nutrition, and all other unmigrated user routes continue to use their existing client boundaries; they are outside this small slice.

The API tests mock Supabase and do not contact production. They validate application-level ownership and client selection, but they do not prove database-level RLS behavior end-to-end; a baseline-migration/RLS test phase is still required before making an audit-complete claim.
