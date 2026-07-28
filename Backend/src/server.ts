import type { Server } from 'node:http';
import {
  app,
  schedulePremiumMondayAutoPlanner,
  stopPremiumMondayAutoPlanner,
} from './app';
import { initTelegramBot, stopTelegramBot } from './TelegramBot';

const PORT = Number(process.env.PORT || 5001);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SHUTDOWN_TIMEOUT_MS = Math.max(1_000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000);

const shouldInitTelegramBot = () => (
  process.env.TELEGRAM_BOT_ENABLED !== 'false' && (
    IS_PRODUCTION ||
    process.env.TELEGRAM_FORCE_ENABLE === 'true' ||
    process.env.TELEGRAM_ENABLE_POLLING === 'true'
  )
);

const stopRuntimeServices = async () => {
  stopPremiumMondayAutoPlanner();
  await stopTelegramBot();
};

export const startServer = (): Server => {
  const telegramBot = shouldInitTelegramBot() ? initTelegramBot() : null;
  schedulePremiumMondayAutoPlanner();

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    if (IS_PRODUCTION && !telegramBot && process.env.TELEGRAM_BOT_ENABLED !== 'false') {
      console.warn('Telegram bot chua khoi dong; vui long kiem tra TELEGRAM_BOT_TOKEN.');
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] Received ${signal}; stopping new HTTP requests.`);

    const forceExitTimer = setTimeout(() => {
      console.error(`[shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing process exit.`);
      void stopRuntimeServices().finally(() => process.exit(1));
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    server.close(async (closeError) => {
      try {
        await stopRuntimeServices();
      } catch (error: any) {
        console.error('[shutdown] Failed to stop runtime services:', error?.message || error);
      } finally {
        clearTimeout(forceExitTimer);
        process.exit(closeError ? 1 : 0);
      }
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  return server;
};

if (require.main === module) {
  startServer();
}
