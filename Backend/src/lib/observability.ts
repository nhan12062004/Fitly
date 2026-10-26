import * as Sentry from '@sentry/node';
import { logOperational } from './operationalLogger';

let initialized = false;

export const sanitizeSentryEvent = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => ({
  type: event.type,
  event_id: event.event_id,
  timestamp: event.timestamp,
  platform: event.platform,
  level: event.level,
  release: event.release,
  environment: event.environment,
  tags: Object.fromEntries(Object.entries(event.tags || {}).filter(([key]) => ['requestId','method','path','status','code','errorCode'].includes(key)).map(([key,value]) => [key,String(value)])),
  exception: event.exception ? { values: (event.exception.values || []).map((entry: any) => ({
    type: 'Error', value: 'Fitly service error',
    stacktrace: entry.stacktrace ? { frames: (entry.stacktrace.frames || []).map((frame: any) => ({
      filename: frame.filename, function: frame.function, module: frame.module, lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
    })) } : undefined,
  })) } : undefined,
});

export const initializeObservability = (): void => {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || process.env.NODE_ENV === 'test') return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    beforeSend(event) {
      // Allowlist the error envelope. Free-text exceptions, breadcrumbs, URLs,
      // user details and arbitrary SDK contexts can contain health information.
      return sanitizeSentryEvent(event);
    },
  });
  logOperational({ level: 'info', event: 'observability_started', status: 'sentry_enabled' });
};

export const reportException = (error: unknown, context: Record<string, string | number | boolean | undefined> = {}): void => {
  logOperational({
    level: 'error',
    event: 'operational_alert',
    status: 'error',
    errorCode: String(context.errorCode || 'UNHANDLED_ERROR'),
    message: error,
  });
  if (initialized && process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
    Sentry.withScope((scope) => {
      scope.setTags(context);
      Sentry.captureException(error);
    });
  }
};
