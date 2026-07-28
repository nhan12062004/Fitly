import * as Sentry from '@sentry/node';
import { logOperational } from './operationalLogger';

let initialized = false;

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
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
      }
      return event;
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
