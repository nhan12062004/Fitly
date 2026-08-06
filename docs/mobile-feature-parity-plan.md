# Fitly Mobile — Web Feature Parity Plan

## Goal

Mobile will preserve the business capabilities already available on the web while using native navigation, touch targets, bottom sheets and mobile-first information density. We will reuse the existing Express/Supabase contracts; no web components will be embedded and no new database migration is planned for this parity pass.

## Web → Mobile mapping

| Web capability | Mobile destination | Mobile adaptation | Data channel |
| --- | --- | --- | --- |
| Dashboard / Overview | Home | Today hero metric, progress cards, quick actions and pull-to-refresh | Supabase RLS + `/api/profile` |
| Exercises / Exercise details | Workout → Exercise detail | Search/filter catalog, compact exercise card, media and add-to-today action | Supabase RLS; Express mutation |
| Workout session | Workout → Active session | Full-screen focus mode, rest timer, one-tap set completion, server reconciliation | Express |
| Diet plan | Meals | Day selector, meal cards, macro summary and recipe bottom sheet | Supabase RLS + recipe API |
| AI Coach | Coach | Chat, quota, structured proposal preview and explicit Apply/Reject | Express |
| Profile | Profile | Editable profile sections, body metrics, goals and settings | `/api/profile` + Supabase RLS |
| Progress | Profile → Progress | Streak, weekly training, calories and body-metric trends | Supabase RLS |
| Notifications | Profile → Notifications | Filtered list, actionable water/sleep/workout cards | Supabase/Realtime where available |
| Challenges | Profile → Challenges | Vertical challenge cards, progress and join/leave actions | Add contract audit before implementation |
| Reset password | Auth deep link | `fitly://reset-password` recovery route | Supabase Auth |
| Admin, checkout | Not in Android MVP | Keep web-only until separately approved | — |

## Delivery order

1. **Navigation parity shell:** add stack routes for exercise detail, active workout, recipe detail, progress, notifications and challenges; add entry points from existing tabs.
2. **Workout parity:** calendar/date selection, exercise detail, active session and complete-set recovery. Keep mutation lock/no retry rules unchanged.
3. **Meals parity:** day selector, macro summary, recipe detail and safe read-only meal logging surface where the current contract permits it.
4. **Profile and progress parity:** editable profile sections, body metrics, goals, progress trends and sign-out/settings.
5. **Engagement parity:** notifications and challenges after endpoint/ownership audit.
6. **Auth completion:** reset-password deep link end-to-end when a development build test slot is available.
7. **QA:** verify each screen on emulator and Redmi with loading, empty, error, retry and session-expiry states.

## Guardrails

- The web implementation is the behavior reference, not a component source.
- Every new endpoint or direct Supabase query must be documented in `docs/mobile-api-contract.md` before coding.
- Mobile never sends `user_id` as an ownership authority and never includes service-role or Groq secrets.
- Non-idempotent workout and AI mutations remain locked while pending; uncertain results reconcile by refetching.
- Health Connect and HealthKit remain outside this parity pass until Android core navigation and mutation QA are closed.

## Current status

- Foundation, auth/session, core read flows and AI Coach UI are implemented.
- Navigation parity shell is implemented with protected Stack routes.
- Meals now opens native recipe detail through the existing authenticated recipe endpoint.
- Profile now opens native Progress, built from body metrics, daily workout sessions and daily progress logs through user-scoped RLS queries; it is verified on the Redmi with real data.
- Workout mutation physical QA is waiting for an existing incomplete workout set; no production data will be created solely for testing.
- Workout detail and active-session screens are implemented: each workout opens a focused session view with a rest timer, a pending lock and server-state reconciliation. Android bundling and launch on the connected Redmi succeed; live mutation QA remains blocked until an existing incomplete workout set is available.
- Next slice: enrich Workout with date/exercise browsing, then extend Meals with a day selector and macro summary where the existing contract supports it.
