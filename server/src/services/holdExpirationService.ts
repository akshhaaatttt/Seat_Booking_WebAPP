import type { Db } from '../db/index.js';
import { getDb, withTransaction } from '../db/index.js';
import * as holdRepository from '../repositories/holdRepository.js';
import * as seatRepository from '../repositories/seatRepository.js';
import type { SeatStatusChangedEvent } from '../realtime/events.js';
import { realtimePublisher, seatStatusChanged } from '../realtime/publisher.js';
import { logger } from '../utils/logger.js';

export interface ExpirationScope {
  showId?: string;
  showSeatIds?: readonly string[];
}

/**
 * Releases every hold whose deadline has passed, and returns the realtime
 * events describing what changed. The caller publishes them *after* the
 * surrounding transaction commits.
 *
 * Must be called from inside a transaction. It is invoked from two places:
 *   1. the background sweeper, every `HOLD_SWEEP_INTERVAL_SECONDS`;
 *   2. lazily at the start of every hold/book/read path, so a hold that expired
 *      one millisecond ago never blocks a seat even though the sweeper has not
 *      run yet.
 */
export function releaseExpiredHoldsWithin(
  db: Db,
  now: number,
  scope: ExpirationScope = {},
): SeatStatusChangedEvent[] {
  const expired = holdRepository.findExpiredActiveHolds(now, scope, db);
  if (expired.length === 0) return [];

  const events: SeatStatusChangedEvent[] = [];
  for (const hold of expired) {
    // Conditional close: if a concurrent transaction already converted or
    // released this hold, `changes` is 0 and we leave the seat alone.
    if (!holdRepository.tryCloseHold(hold.id, 'EXPIRED', now, db)) continue;

    // Conditional transition: only moves the seat if it is still HELD. A seat
    // that somehow became BOOKED is deliberately left untouched.
    const released = seatRepository.tryTransition(hold.show_seat_id, 'EXPIRE', now, db);
    if (!released) continue;

    const seat = seatRepository.findShowSeatsByIds(hold.show_id, [hold.show_seat_id], db)[0];
    events.push(
      seatStatusChanged({
        showId: hold.show_id,
        showSeatId: hold.show_seat_id,
        seatId: seat?.seat_id ?? '',
        label: hold.label,
        status: 'AVAILABLE',
        reason: 'EXPIRED',
        at: now,
      }),
    );
  }
  return events;
}

/** True when at least one hold in scope is already past its deadline. */
export function hasExpiredHolds(now: number, scope: ExpirationScope = {}, db: Db = getDb()): boolean {
  return holdRepository.findExpiredActiveHolds(now, scope, db).length > 0;
}

/**
 * Transactional wrapper used by the scheduler and by read paths. Returns the
 * number of seats released.
 */
export function sweepExpiredHolds(now: number = Date.now(), scope: ExpirationScope = {}): number {
  const events = withTransaction((db) => releaseExpiredHoldsWithin(db, now, scope));
  // Published only once the transaction has committed: clients must never be
  // told about state that could still roll back.
  realtimePublisher.publishAll(events);
  if (events.length > 0) {
    logger.info('released expired holds', { seats: events.length, ...scope });
  }
  return events.length;
}

/**
 * Cheap guard for read paths: only opens a write transaction when there is
 * actually something to expire.
 */
export function sweepIfNeeded(now: number, scope: ExpirationScope = {}): number {
  if (!hasExpiredHolds(now, scope)) return 0;
  return sweepExpiredHolds(now, scope);
}
