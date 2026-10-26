# Operations

Current release procedure, production gates and incident queries are in
[the 2026-10-26 hardening release](hardening-release-2026-10-26.md).

## Runtime ownership

`Backend/src/app.ts` only constructs the Express application. Importing it does not open a port, start cron work, register signal handlers, or make a provider call.

`Backend/src/server.ts` invokes `startRuntime()` only when it is the process entrypoint. The runtime then starts HTTP, optional jobs, and SIGINT/SIGTERM handlers.

## Environment flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_JOBS` | `false` | Enables the premium auto-planner schedules. |
| `READY_TIMEOUT_MS` | `3000` | Bounded timeout for the lightweight Supabase readiness check. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Bounded maximum wait for graceful shutdown. |
| `SENTRY_DSN` | unset | Enables optional sanitized Sentry exception reporting at runtime. |
| `PREMIUM_AUTO_PLAN_CRON` | `5 0 * * *` | Premium planner schedule in `Asia/Ho_Chi_Minh`. |

Only `true`, `1`, `yes`, and `on` enable Boolean flags. Invalid values fall back safely. Tests and CI force jobs off even if flags are present.

For the current Render web service, set `ENABLE_JOBS=true` only when scheduled planning is intended. Never put tokens or keys in logs, documentation, or test fixtures.

## Scheduling and scaling

The scheduler now claims each premium daily run and privacy hourly run through a unique database job key. Duplicate schedules/deploys cannot claim the same run. An interrupted run requires inspection; this does not promise exactly-once completion or automatically retry an unknown result.

Run `npm run jobs:premium` daily and `npm run jobs:privacy` hourly from a dedicated cron/worker before scaling web instances. Keep HTTP instances with `ENABLE_JOBS=false` when using that model. Privacy maintenance removes expired replay bodies and retries account deletions.

## Health and readiness

- `GET /health` is liveness only and never queries Supabase or another provider.
- `GET /ready` checks the required configuration then performs a head-only `profiles` query with a timeout. It returns a stable sanitized contract and never includes provider URLs, keys, or stack traces.

## Shutdown sequence

On SIGINT or SIGTERM the runtime accepts the first signal only:

1. Stops accepting new HTTP requests.
2. Stops job schedules and timers.
3. Completes shutdown or force-exits at `SHUTDOWN_TIMEOUT_MS`.

## Operational logs

Operational logs are JSON objects containing `level`, `event`, `timestamp`, plus applicable `status`, `errorCode`, `jobName`, and request/correlation IDs. Events include `server_started`, `server_shutdown_started`, `server_shutdown_completed`, `job_started`, `job_completed`, `job_failed`, and `readiness_failed`.

`requestId` comes from the incoming `X-Request-ID`; job executions use a generated `correlationId`. Messages are sanitized to avoid tokens, URLs, provider credentials, and request data.

When `SENTRY_DSN` is configured, Sentry starts only in the runtime entrypoint (never while importing `app` or in tests). Request headers, cookies, and bodies are removed before events are sent.

## Deliberately deferred

- No distributed scheduler/leader election is implemented.
- No paid monitoring platform or queue has been added.
- No production database schema, RLS policy, frontend, Capacitor, IAP, workout, nutrition, AI, or membership logic changed.
