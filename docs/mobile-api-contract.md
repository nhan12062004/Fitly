# Fitly Mobile API Contract

**Status:** Baseline contract for Android MVP

**Source of truth:** This document is derived from the active Express routes, their handlers, Zod validation and the web client. `docs/BACKEND_ENDPOINT_INVENTORY.md` remains an audit inventory, not a mobile contract.

**Scope:** Auth, Home, Workout, Meals, Profile and AI Coach. Admin, Challenges and Premium are excluded from Android MVP.

## 1. Transport and error rules

### Base URLs and headers

```text
EXPO_PUBLIC_SUPABASE_URL=<Supabase project URL>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable/anon key>
EXPO_PUBLIC_API_URL=<Express API URL>
```

Every Express endpoint in this document, except `/health` and `/ready`, requires:

```http
Authorization: Bearer <Supabase access token>
Content-Type: application/json
```

The mobile API client obtains the current access token from the Supabase session immediately before a request. It never sends a user ID as an ownership authority; the Backend derives the user from the bearer token.

### Common error response

The preferred error envelope is:

```ts
type ApiError = {
  error: {
    code:
      | 'VALIDATION_ERROR'
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'QUOTA_EXCEEDED'
      | 'EXTERNAL_PROVIDER_ERROR'
      | 'INTERNAL_CONFIGURATION_ERROR'
      | 'INTERNAL_ERROR';
    message: string;
    requestId: string;
  };
};
```

The current Backend has legacy handlers, including `apply-adjustment` and `complete-set`, that return `{ error: string }` directly. Until those handlers are standardized, the Mobile API client must safely parse both shapes; it must not invent `code` or `requestId` when the server did not return them.

`422` is normalized to `400` where the shared error middleware is used. Preserve `requestId` in mobile logs and support tickets when present. On `401`, refresh/reload the Supabase session once; if still unauthorized, sign out. Do not retry `400`, `403` or `409` automatically.

### Conventions

- A date key is `YYYY-MM-DD` in Fitly's Vietnam date convention.
- UUID fields are strings.
- Mutation buttons must disable while a request is pending.
- An uncertain network result for a non-idempotent mutation is reconciled by refetching the affected resource, not by repeating the request.

## 2. Access matrix

| Domain | Channel | Mobile contract |
| --- | --- | --- |
| Auth and password recovery | Supabase Auth | Direct Supabase SDK calls; session stored with SecureStore. |
| Home reads | Supabase PostgREST + RLS | Compose a `MobileHomeSnapshot` from user-owned plans, daily progress and sessions. |
| Workout reads | Supabase PostgREST + RLS | Read plans, catalog and sessions; all workout writes below use Express. |
| Workout writes | Express | Use validated workout mutations only; do not write `daily_exercise_sessions` directly. |
| Meals reads | Supabase PostgREST + RLS | Read food plans, items, daily meal logs and progress. |
| Recipe detail / food validation | Express | `GET /api/recipes/:id` and `POST /api/meal-plans/validate-foods`. |
| Profile identity and avatar | Express | Use `/api/profile` and `/api/profile/avatar`. |
| Profile body/health/lifestyle entries | Supabase PostgREST + RLS | Follow current user-scoped table policies; no other user's ID may be queried or written. |
| AI Coach | Express | AI key, quota, safety checks, proposal creation and apply/reject stay server-side. |

## 3. Supabase direct contract

Use only the authenticated Supabase client. Each query must filter with the current authenticated user's ID where the table is user-owned, even though RLS is also active.

| Mobile read flow | Tables | Required filter / ordering |
| --- | --- | --- |
| Home | `weekly_plan_exercises`, `weekly_food_items`, `daily_progress_logs`, `daily_exercise_sessions`, `daily_workout_sessions` | Current user; current date/week; order sessions/items by `order_index`. |
| Workout read | `weekly_plans`, `weekly_plan_exercises`, `daily_exercise_sessions`, `daily_workout_sessions`, `daily_workout_session_exercises`, `exercises` | Current user for plans/sessions; shared catalog for exercises. |
| Meals read | `weekly_food_plans`, `weekly_food_items`, `daily_meal_logs`, `daily_progress_logs`, `recipes`, `meal_feedback` | Current user for plans/logs/feedback; shared recipe catalog. |
| Profile / progress read | `body_metrics`, `health_conditions`, `lifestyle_settings`, `daily_progress_logs` | Current user; latest metric ordered by `created_at desc`. |

**Direct writes permitted in Android MVP:** body metrics, health conditions and lifestyle settings only after validating the existing RLS policy with a non-admin test account. All daily workout mutations must use Express.

## 4. Auth contract — Supabase Auth

| Flow | SDK call | Input | Expected output |
| --- | --- | --- | --- |
| Sign in | `signInWithPassword` | `email`, `password` | `session`, `user` or Supabase auth error. |
| Sign up | `signUp` | `email`, `password`, optional safe user metadata | `user`, optional `session`; handle email confirmation state. |
| Restore session | `getSession` + auth state listener | None | Session restored from SecureStore or unauthenticated state. |
| Reset request | `resetPasswordForEmail` | `email`, `redirectTo: fitly://reset-password` | Success response regardless of account discovery policy. |
| Reset completion | `updateUser` | `password` after recovery deep link | Updated user or auth error. |
| Sign out | `signOut` | None | Local session cleared. |

The Expo app must register the `fitly://reset-password` deep link and route the `PASSWORD_RECOVERY` event to the reset-password screen.

## 5. Express profile and meal contract

### `GET /api/profile`

- **Auth:** required.
- **Success `200`:** `{ data: Profile }`.
- **Ownership:** profile is always the bearer-token user; no user ID parameter exists.

### `PATCH /api/profile`

- **Auth:** required.
- **Request:** safe profile fields only. Current callers use `full_name`, `email`, `gender` and `birthday`.
- **Success `200`:** `{ data: Profile }`.
- **Contract rule:** ignore/reject client `id`, `user_id`, role and ownership fields. Mobile must not send them.

### `PUT /api/profile/avatar`

- **Auth:** required.
- **Request:** raw image body, `Content-Type` one of JPEG/PNG/WebP/GIF, maximum 5 MB.
- **Success `200`:** `{ avatarUrl: string }`.
- **Ownership:** Backend builds the storage path from the authenticated user; mobile never supplies a storage path.

### `GET /api/recipes/:id`

- **Auth:** required.
- **Success `200`:** recipe detail object for the requested shared catalog ID.
- **Errors:** `400` invalid ID, `404` unavailable/missing recipe.

### `POST /api/meal-plans/validate-foods`

- **Auth:** required.
- **Purpose:** server-side food eligibility validation using current user profile/health data.
- **Mobile status:** call only after payload fields are captured in a fixture test; do not infer its request schema from the web UI.

## 6. Workout mutation contract

All endpoints require bearer auth and operate only on the caller's sessions/plans.

### Materialize a daily workout from the active plan

```http
POST /api/workout/daily-exercises/from-plan

{ "logDate": "YYYY-MM-DD" }
```

Success `200`:

```ts
{
  exercises: DailyExerciseSession[];
  workoutSessionId: string | null;
  weeklyPlanId?: string | null;
  source: 'existing' | 'weekly_plan' | 'no_plan' | 'rest_day';
}
```

- **Idempotency:** semantically idempotent. Repeating the same date returns existing materialized sessions.
- **Errors:** `400` invalid date; `409` plan/session state conflict; `400` when the current profile makes a planned exercise ineligible.

### Create a manual daily exercise

```http
POST /api/workout/daily-exercises

{
  "logDate": "YYYY-MM-DD",
  "exerciseId": "uuid",
  "sets": 3,
  "reps": "10-12",
  "weightKg": 20,
  "restSeconds": 60,
  "orderIndex": 0,
  "targetRpe": 7
}
```

`sets`, `reps`, `weightKg`, `restSeconds`, `orderIndex` and `targetRpe` are optional, but mobile should send explicit values. Success `200`: `{ exercise: DailyExerciseSession }`.

- **Idempotency:** not supported. Do not automatically retry after a timeout; refetch the date/session first because a duplicate exercise could be created.
- **Errors:** `400` missing/invalid `logDate` or `exerciseId`; `400` normalized from safety validation when the exercise is not eligible.

### Update session configuration

```http
POST /api/workout/daily-exercises/:exerciseSessionId/config

{ "sets": 3, "reps": "10-12", "weightKg": 20, "restSeconds": 60 }
```

Success `200`: `{ exercise: DailyExerciseSession }`.

- **Idempotency:** idempotent by value; retry only with the identical payload.
- **Effect:** recalculates estimated calories, clamps completed set count and synchronizes the workout snapshot/progress.

### Mark all sets complete or incomplete

```http
POST /api/workout/daily-exercises/:exerciseSessionId/completion

{ "isCompleted": true }
```

Success `200`: `{ exercise: DailyExerciseSession }`.

- **Idempotency:** idempotent by value; retry only with the identical payload.
- **Effect:** upserts/deletes set logs and synchronizes workout calories.

### Complete one set

```http
POST /api/workout/daily-exercises/:exerciseSessionId/complete-set

{ "restSeconds": 60 }
```

Success `200`: `{ exercise: DailyExerciseSession }`.

- **Idempotency:** **not supported**. Every successful call increments `completed_sets`; mobile must use a pending lock and must never automatically retry this request.
- **Reconciliation:** after timeout/network loss, refetch the exercise session and use `completed_sets` from the server.

### Replace an exercise with the server-selected eligible alternative

```http
POST /api/workout/daily-exercises/:exerciseSessionId/replace

{}
```

Success `200`:

```ts
{
  success: true;
  exercise: DailyExerciseSession;
  replacedExerciseName: string;
  aiQuota: AiQuotaSnapshot;
}
```

- **Idempotency:** not supported; do not retry automatically. This route consumes AI adjustment quota.
- **Errors:** `404` missing session/catalog exercise; `409` session already started/completed; `403` quota/premium restriction; `422` no safe replacement candidate.

## 7. AI Coach contract

### `GET /api/ai/quota`

- **Auth:** required; rate limited.
- **Success `200`:**

```ts
{
  membershipTier: string;
  canChat: boolean;
  trialExpired: boolean;
  aiQuota: AiQuotaSnapshot;
}
```

### `POST /api/ai/chat`

```http
POST /api/ai/chat

{
  "message": "Tôi đau vai, đổi bài hôm nay giúp tôi",
  "selectedDayIndex": 0,
  "weekStartDate": "YYYY-MM-DD",
  "clientHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

- `message`: required, trimmed, 1–1000 characters.
- `selectedDayIndex`: optional integer `0..6`.
- `weekStartDate`: optional date key or empty string.
- `clientHistory`: optional, maximum 10 messages; roles only `user`/`assistant`; each content 1–1200 characters.

Success `200` is an `AIChatResponse`:

```ts
{
  reply: string;
  intent: string;
  responseMode: string;
  confidence: number;
  actionRequired?: boolean;
  actionType?: string | null;
  actionPayload?: Record<string, unknown> | null;
  adjustmentId: string | null;
  aiQuota: AiQuotaSnapshot;
}
```

- **Idempotency:** not supported. The request may write chat history and consume quota; never auto-retry after an uncertain result.
- **UI guard:** when `actionRequired` and `adjustmentId` are present, render proposal details and explicit Apply/Reject controls. Never apply from the chat response itself.
- **Errors:** `400` validation; `429` rate/quota; `403` membership restriction; `502/503` AI/provider dependency.

### `POST /api/ai/apply-adjustment`

```http
POST /api/ai/apply-adjustment
Idempotency-Key: fitly-mobile-apply-<adjustmentId>-<uuid>

{ "adjustmentId": "uuid" }
```

Success `200`:

```ts
{
  success: true;
  adjustmentId: string;
  alreadyApplied?: boolean;
  aiQuota?: AiQuotaSnapshot;
}
```

- **Idempotency:** required. Generate one stable key per user confirmation and persist it until the request resolves. Reuse the same key for manual retry. A different key for an already-applied adjustment returns `409`.
- **Safety:** Backend re-validates proposal payload, exercise/food eligibility, plan state and ownership before mutation. Mobile must display the proposal but must not bypass these checks.
- **Errors:** `400` missing adjustment/key/invalid payload; `404` missing owned adjustment/plan; `409` proposal is no longer `proposed`, plan started/completed or idempotency conflict; `403/429` quota/premium restriction.

### `POST /api/ai/reject-adjustment`

```http
POST /api/ai/reject-adjustment

{ "adjustmentId": "uuid" }
```

Success `200`: `{ success: true, adjustmentId: string }`.

- **Idempotency:** not supported by the current endpoint. Lock the Reject button; on uncertain result, refetch the adjustment/chat state instead of retrying blindly.
- **Errors:** `400` missing ID; `404`/`409` adjustment is missing, not owned or no longer proposed.

### `POST /api/ai/chat/clear`

- **Request:** `{}`.
- **Success `200`:** `{ success: true }`.
- **Idempotency:** safe to repeat.

## 8. Verification status and fixture tests

### Verified by source inspection

- `POST /api/ai/apply-adjustment` reads the `Idempotency-Key` header, loads the owned adjustment, compares it with `apply_idempotency_key`, passes it to the atomic workout RPC when applicable, and persists it on successful apply.
- Repeating a completed apply with the same key returns `{ success: true, alreadyApplied: true }`; a different key conflicts.
- `POST /api/workout/daily-exercises/:exerciseSessionId/complete-set` increments `completed_sets` once for every accepted request. It deliberately has no idempotency key.

### Passed Milestone 0 gate

`Backend/test/mobile-contract-milestone0.test.ts` runs the required contract gate locally and in CI through `npm test`:

1. First AI apply persists the supplied key, mutates the meal plan exactly once, and records exactly one quota event.
2. A replay with the same key returns `alreadyApplied: true`, with no further plan mutation or quota event.
3. A different key after apply returns `409`, with no further mutation or quota event.
4. A missing `Idempotency-Key` returns `400` before any database call or mutation.
5. Two accepted `complete-set` requests advance `completed_sets` from `0` to `2`; this is an intentional protocol warning, not idempotency.

Run locally:

```bash
cd Backend
npm test -- --run test/mobile-contract-milestone0.test.ts
```

The future Workout mobile implementation must add its own test proving a single tap sends exactly one request. It needs a per-session pending lock; after success it renders server `completed_sets`, disables the completed-set control, and on any uncertain result only refetches the session.

Any new Mobile API usage must be added here before implementation; a UI component is not the contract source.
