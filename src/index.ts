import { startBot } from './bot/client.js';
import { logger } from './utils/logger.js';
import { sessionManager } from './claude/sessionManager.js';

async function main(): Promise<void> {
  logger.info('Starting Claude Code Discord Bot...');

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  // Periodic session cleanup (every hour)
  setInterval(
    () => {
      sessionManager.cleanupOldSessions();
    },
    60 * 60 * 1000
  );

  try {
    await startBot();
    logger.info('Bot started successfully');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start bot');
    process.exit(1);
  }
}

main();
