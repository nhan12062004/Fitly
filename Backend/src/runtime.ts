import type { Server } from 'node:http';
import { app } from './app';
import { getBoundedTimeoutMs, isTelegramEnabled, isTelegramRequired } from './config/runtime';
import { startJobs, stopJobs } from './jobs';
import { logOperational } from './lib/operationalLogger';
import { initializeObservability } from './lib/observability';
import { startTelegramBot, stopTelegramBot } from './TelegramBot';

const PORT = Number(process.env.PORT || 5001);
const SHUTDOWN_TIMEOUT_MS = getBoundedTimeoutMs(process.env.SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 60_000);

export type RuntimeDependencies = {
  listen?: (port: number, callback: () => void) => Server;
  startJobs?: () => void;
  stopJobs?: () => void;
  startTelegram?: () => unknown;
  stopTelegram?: () => Promise<void>;
  exit?: (code: number) => never;
};

export const startRuntime = (dependencies: RuntimeDependencies = {}): Server => {
  initializeObservability();
  const listen = dependencies.listen || ((port, callback) => app.listen(port, callback));
  const startRuntimeJobs = dependencies.startJobs || startJobs;
  const stopRuntimeJobs = dependencies.stopJobs || stopJobs;
  const startTelegram = dependencies.startTelegram || startTelegramBot;
  const stopTelegram = dependencies.stopTelegram || stopTelegramBot;
  const exit = dependencies.exit || process.exit;

  if (isTelegramEnabled()) startTelegram();
  else logOperational({ level: 'info', event: 'telegram_disabled', status: 'disabled', message: 'ENABLE_TELEGRAM is not enabled' });
  startRuntimeJobs();

  const server = listen(PORT, () => {
    logOperational({ level: 'info', event: 'server_started', status: 'listening', message: `port=${PORT}` });
  });
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logOperational({ level: 'info', event: 'server_shutdown_started', status: signal });
    const forceExitTimer = setTimeout(() => {
      logOperational({ level: 'error', event: 'server_shutdown_forced', status: 'timeout', errorCode: 'SHUTDOWN_TIMEOUT' });
      void Promise.resolve(stopTelegram()).finally(() => exit(1));
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close((closeError) => {
      void (async () => {
        try {
          stopRuntimeJobs();
          await stopTelegram();
          logOperational({ level: 'info', event: 'server_shutdown_completed', status: closeError ? 'error' : 'ok' });
        } catch (error) {
          logOperational({ level: 'error', event: 'server_shutdown_failed', status: 'error', errorCode: 'SHUTDOWN_FAILED', message: error });
        } finally {
          clearTimeout(forceExitTimer);
          exit(closeError ? 1 : 0);
        }
      })();
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
};
