import { config } from '../config/index.js';
import { sweepExpiredHolds } from '../services/holdExpirationService.js';
import { logger } from '../utils/logger.js';

/**
 * The scheduler is intentionally dumb: it owns timing and nothing else. All
 * expiry logic lives in holdExpirationService, which is also called inline by
 * the hold/book/read paths — so correctness never depends on this timer having
 * fired recently.
 */
export interface Scheduler {
  start(): void;
  stop(): void;
  runOnce(): number;
}

export function createHoldExpirationScheduler(
  intervalSeconds: number = config.holds.sweepIntervalSeconds,
): Scheduler {
  let timer: NodeJS.Timeout | null = null;

  const runOnce = (): number => {
    try {
      return sweepExpiredHolds(Date.now());
    } catch (error) {
      // A failed sweep must never take the process down; the next tick retries,
      // and the lazy expiry on the request path keeps the data correct anyway.
      logger.error('hold expiration sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  };

  return {
    start() {
      if (timer) return;
      // Run immediately on boot: holds that expired while the server was down
      // are cleaned up before the first request is served.
      runOnce();
      timer = setInterval(runOnce, intervalSeconds * 1000);
      // Do not keep the event loop alive just for the sweeper.
      timer.unref();
      logger.info('hold expiration scheduler started', { intervalSeconds });
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger.info('hold expiration scheduler stopped');
    },
    runOnce,
  };
}
