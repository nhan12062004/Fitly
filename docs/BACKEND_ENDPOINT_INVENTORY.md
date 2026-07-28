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
| POST | `/api/telegram/link-token` | Auth | Current user's Telegram link | Service role | Generates signed link token | Filters profile by authenticated user ID |

## PR 1 operational endpoints

| Method | Path | Authentication | Dependencies checked | Side effect |
| --- | --- | --- | --- | --- |
| GET | `/health` | Public | None | None |
| GET | `/ready` | Public | Required Supabase environment and a head-only `profiles` query | None |
