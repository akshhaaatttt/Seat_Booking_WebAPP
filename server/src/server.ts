import { config } from './config/index.js';
import { createApp } from './app.js';
import { closeDb, getDb } from './db/index.js';
import { logger } from './utils/logger.js';

function main(): void {
  getDb();

  const app = createApp();

  const server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port, env: config.nodeEnv });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
