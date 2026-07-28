# Operations

## Runtime ownership

`Backend/src/app.ts` only constructs the Express application. Importing it does not open a port, start cron work, start Telegram, register signal handlers, or make a provider call.

`Backend/src/server.ts` invokes `startRuntime()` only when it is the process entrypoint. The runtime then starts HTTP, optional Telegram, optional jobs, and SIGINT/SIGTERM handlers.

## Environment flags

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_JOBS` | `false` | Enables the premium auto-planner and Telegram reminder schedules. |
| `ENABLE_TELEGRAM` | `false` | Enables Telegram lifecycle startup. |
| `TELEGRAM_REQUIRED` | `false` | Fails runtime startup when Telegram is enabled but has no token. |
| `TELEGRAM_ENABLE_POLLING` | enabled unless explicitly `false` | Controls Telegram long-polling after Telegram starts. |
| `TELEGRAM_ENABLE_REMINDERS` | enabled unless explicitly `false` | Controls Telegram reminder schedules; `ENABLE_JOBS` must also be enabled. |
| `READY_TIMEOUT_MS` | `3000` | Bounded timeout for the lightweight Supabase readiness check. |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Bounded maximum wait for graceful shutdown. |
| `PREMIUM_AUTO_PLAN_CRON` | `5 0 * * *` | Premium planner schedule in `Asia/Ho_Chi_Minh`. |

Only `true`, `1`, `yes`, and `on` enable Boolean flags. Invalid values fall back safely. Tests and CI force jobs and Telegram off even if flags are present.

For the current Render web service, set `ENABLE_JOBS=true` and/or `ENABLE_TELEGRAM=true` only when those functions are intended. Never put tokens or keys in logs, documentation, or test fixtures.

Telegram is optional by default. If enabled without `TELEGRAM_BOT_TOKEN`, startup logs a sanitized `telegram_start_failed` event and the HTTP process continues; set `TELEGRAM_REQUIRED=true` to make that misconfiguration fatal. Polling errors after startup are logged and do not terminate HTTP.

## Scheduling and scaling

The current in-process scheduler is a beta, single-web-instance assumption. It prevents duplicate registration inside one Node process, but cannot provide exactly-once execution across multiple Render instances or during overlapping deploys.

Telegram reminder dispatches retain their existing database dedupe key, but this is not a general distributed scheduler lock. Before scaling web instances, move premium scheduling and reminder dispatch to a Render Cron Job or dedicated worker. Keep web HTTP instances with `ENABLE_JOBS=false`; Telegram polling should likewise have one explicit owner to avoid conflicts.

## Health and readiness

- `GET /health` is liveness only and never queries Supabase or another provider.
- `GET /ready` checks the required configuration then performs a head-only `profiles` query with a timeout. It returns a stable sanitized contract and never includes provider URLs, keys, or stack traces.

## Shutdown sequence

On SIGINT or SIGTERM the runtime accepts the first signal only:

1. Stops accepting new HTTP requests.
2. Stops job schedules and timers.
3. Stops Telegram polling and reminder schedules.
4. Completes shutdown or force-exits at `SHUTDOWN_TIMEOUT_MS`.

## Operational logs

Operational logs are JSON objects containing `level`, `event`, `timestamp`, plus applicable `status`, `errorCode`, `jobName`, and request/correlation IDs. Events include `server_started`, `server_shutdown_started`, `server_shutdown_completed`, `job_started`, `job_completed`, `job_failed`, `telegram_started`, `telegram_start_failed`, `telegram_stopped`, and `readiness_failed`.

`requestId` comes from the incoming `X-Request-ID`; job executions use a generated `correlationId`. Messages are sanitized to avoid tokens, URLs, provider credentials, and request data.

## Deliberately deferred

- No distributed scheduler/leader election is implemented.
- No paid monitoring platform or queue has been added.
- No production database schema, RLS policy, frontend, Capacitor, IAP, workout, nutrition, AI, or membership logic changed.
