import type { Server } from 'node:http';
import { config } from './config/index.js';
import { createApp } from './app.js';
import { closeDb, getDb } from './db/index.js';
import { createHoldExpirationScheduler } from './scheduler/index.js';
import { logger } from './utils/logger.js';

const FORCED_EXIT_DELAY_MS = 5000;

function main(): void {
  // Opening the database applies the schema, so a fresh checkout boots cleanly.
  getDb();

  const app = createApp();
  const scheduler = createHoldExpirationScheduler();

  const server: Server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port, env: config.nodeEnv });
  });

  // Starting the sweeper after the schema is ready means any holds that expired
  // while the process was down are released on boot.
  scheduler.start();

  let shuttingDown = false;

  /**
   * Releases the SQLite handle and leaves the process.
   *
   * Closing the database *before* exiting is mandatory, not tidiness:
   * better-sqlite3 registers environment cleanup hooks for its prepared
   * statements. Calling `process.exit()` with the connection still open tears
   * down the V8 environment first, and the native `Statement` destructors then
   * abort the process with `Assertion failed: (env) != nullptr`. A crash on
   * shutdown would also skip any remaining cleanup and return a non-zero code
   * to whatever is supervising the process.
   */
  const exitCleanly = (code: number): void => {
    closeDb();
    process.exit(code);
  };

  const shutdown = (signal: string): void => {
    // A second SIGTERM (or SIGINT while already draining) must not start a
    // second shutdown and race the first one to process.exit().
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('shutting down', { signal });
    scheduler.stop();

    // SSE streams are deliberately long-lived, so `server.close()` alone would
    // never finish: it waits for every open connection to end. Ending idle
    // keep-alives and then destroying what remains lets the close complete.
    server.closeIdleConnections();
    server.closeAllConnections();

    server.close((error) => {
      if (error) {
        logger.error('error while closing the server', { message: error.message });
        exitCleanly(1);
        return;
      }
      exitCleanly(0);
    });

    // Backstop: if something still holds the server open, leave anyway — but
    // never without closing the database first.
    setTimeout(() => {
      logger.warn('forcing shutdown after timeout', { timeoutMs: FORCED_EXIT_DELAY_MS });
      exitCleanly(0);
    }, FORCED_EXIT_DELAY_MS).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // An unexpected failure must still release the database handle, for the same
  // reason as above.
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { message: error.message, stack: error.stack });
    exitCleanly(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { reason: String(reason) });
    exitCleanly(1);
  });
}

main();
