# PR 4–6 completion checklist

## PR 4 — Validation and standardized errors

- [x] Request ID and a stable `AppError` response contract.
- [x] Sanitized provider failures for routes using the central error handler.
- [x] Zod request boundaries for account deletion, profile, membership, Telegram link, workout plan instantiation, AI chat, and admin mutation payloads.
- [x] Regression tests reject invalid account/workout/AI input before a provider call.
- [ ] Migrate remaining legacy routes that return route-local raw provider errors to the central error handler. This is deliberately tracked as refactor work, not silently claimed complete.

## PR 5 — Jobs and monitoring beta

- [x] Premium planner and Telegram reminder schedules have explicit start/stop lifecycles.
- [x] Telegram reminders are registered by `jobs/telegramReminders.ts`, are idempotent through the existing dispatch lock, and clear all handles on shutdown.
- [x] Structured, sanitized operational logs include job correlation IDs.
- [x] Optional Sentry reporting is runtime-only (`SENTRY_DSN`); it is disabled in tests and removes request headers, cookies, and bodies before sending.
- [x] Operational error events serve as alerting input without requiring a paid monitoring plan.

## PR 6 — CI and regression tests

- [x] CI runs install, typecheck, build, backend tests, and high-severity dependency audits.
- [x] Supertest API regression tests cover bootstrap, auth boundaries, validation, readiness, jobs, Telegram lifecycle, and shutdown.
- [x] Playwright Chromium smoke test loads the public landing page.

## Local verification

- [x] Backend: typecheck, build, 39 tests, `npm audit --audit-level=high`.
- [x] Frontend: lint, build, Playwright smoke, `npm audit --audit-level=high`.
