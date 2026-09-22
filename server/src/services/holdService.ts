import { config } from '../config/index.js';
import { withTransaction } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { HoldDto } from '../domain/models.js';
import { sumPaise } from '../domain/money.js';
import { assertTransition } from '../domain/seatState.js';
import * as holdRepository from '../repositories/holdRepository.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showRepository from '../repositories/showRepository.js';
import type { SeatStatusChangedEvent } from '../realtime/events.js';
import { realtimePublisher, seatStatusChanged } from '../realtime/publisher.js';
import { releaseExpiredHoldsWithin, sweepIfNeeded } from './holdExpirationService.js';

export interface HoldRequest {
  userId: string;
  showId: string;
  showSeatIds: string[];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

/**
 * Moves one or more seats AVAILABLE → HELD, atomically.
 *
 * Concurrency design, in order:
 *   1. `withTransaction` opens `BEGIN IMMEDIATE`, taking the write lock up front
 *      so two hold requests for the same show serialise rather than interleave.
 *   2. Expired holds in scope are released first, so a dead hold cannot block a
 *      seat even before the sweeper notices.
 *   3. Each seat moves through a *conditional* UPDATE guarded by
 *      `status = 'AVAILABLE'`. Losing the race means 0 rows changed, not a
 *      corrupted state.
 *   4. The `holds` partial unique index rejects a second ACTIVE hold on a seat
 *      even if steps 1-3 were somehow bypassed.
 *
 * Any failure throws, which rolls the whole transaction back: a multi-seat
 * request never leaves some seats held and others not.
 */
export function holdSeats(request: HoldRequest): HoldDto {
  const seatIds = [...new Set(request.showSeatIds)];
  if (seatIds.length === 0) throw badRequest('Select at least one seat.');
  if (seatIds.length > config.holds.maxSeatsPerHold) {
    throw badRequest(`You can hold at most ${config.holds.maxSeatsPerHold} seats at a time.`);
  }

  const now = Date.now();
  const show = showRepository.findShowById(request.showId);
  if (!show) throw notFound('Show not found.');
  if (show.is_active !== 1) throw conflict('This show is no longer on sale.');
  if (show.starts_at <= now) throw conflict('This show has already started.');

  const groupId = newId();
  const expiresAt = now + config.holds.durationSeconds * 1000;

  // Step 2, part one: expire stale holds in their *own* committed transaction.
  // Doing this first matters — if it ran inside the transaction below and that
  // transaction then rejected the request, the rollback would resurrect the
  // very holds we had just released.
  sweepIfNeeded(now, { showId: request.showId });

  const { events, seats } = withTransaction((db) => {
    // Step 2, part two: catch anything that expired in the sliver of time
    // between the sweep committing and this transaction taking the write lock.
    const expiryEvents = releaseExpiredHoldsWithin(db, now, { showId: request.showId });

    const existingHolds = holdRepository.countActiveHoldsForUserShow(
      request.userId,
      request.showId,
      db,
    );
    if (existingHolds + seatIds.length > config.holds.maxSeatsPerHold) {
      throw conflict(
        `You already hold ${existingHolds} seat(s) for this show. The limit is ${config.holds.maxSeatsPerHold}.`,
      );
    }

    const showSeats = seatRepository.findShowSeatsByIds(request.showId, seatIds, db);
    if (showSeats.length !== seatIds.length) {
      throw notFound('One or more selected seats do not belong to this show.');
    }

    const holdEvents: SeatStatusChangedEvent[] = [];
    for (const seat of showSeats) {
      // Precise, human-readable rejection for the state we just read...
      assertTransition(seat.label, seat.status, 'HOLD');

      // ...and the authoritative check: the row only changes if it is *still*
      // AVAILABLE at write time.
      if (!seatRepository.tryTransition(seat.id, 'HOLD', now, db)) {
        throw conflict(`Seat ${seat.label} is no longer available.`, { seatLabel: seat.label });
      }

      try {
        holdRepository.insertHold(
          {
            id: newId(),
            groupId,
            userId: request.userId,
            showId: request.showId,
            showSeatId: seat.id,
            createdAt: now,
            expiresAt,
          },
          db,
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw conflict(`Seat ${seat.label} is no longer available.`, { seatLabel: seat.label });
        }
        throw error;
      }

      holdEvents.push(
        seatStatusChanged({
          showId: request.showId,
          showSeatId: seat.id,
          seatId: seat.seat_id,
          label: seat.label,
          status: 'HELD',
          reason: 'HELD',
          holdUserId: request.userId,
          holdExpiresAt: expiresAt,
          at: now,
        }),
      );
    }

    return {
      events: [...expiryEvents, ...holdEvents],
      seats: showSeats.map((seat) => ({ showSeatId: seat.id, label: seat.label, price: seat.price })),
    };
  });

  realtimePublisher.publishAll(events);

  return {
    holdGroupId: groupId,
    showId: request.showId,
    userId: request.userId,
    seats,
    totalAmount: sumPaise(seats.map((seat) => seat.price)),
    createdAt: now,
    expiresAt,
    serverTime: now,
  };
}

/**
 * Voluntary release (the user changed their mind, or navigated away).
 * Accepts either a hold group id or the id of a single hold row within a group.
 */
export function releaseHold(userId: string, holdIdOrGroupId: string): { releasedSeats: number } {
  const now = Date.now();

  const { events, released } = withTransaction((db) => {
    let holds = holdRepository.findHoldsByGroup(holdIdOrGroupId, db);
    if (holds.length === 0) {
      const single = holdRepository.findHoldById(holdIdOrGroupId, db);
      if (!single) throw notFound('Hold not found.');
      holds = holdRepository.findHoldsByGroup(single.group_id, db);
    }

    // Ownership is checked against the session user, never a client-supplied id.
    if (holds.some((hold) => hold.user_id !== userId)) {
      throw forbidden('You can only release your own holds.');
    }

    const releaseEvents: SeatStatusChangedEvent[] = [];
    for (const hold of holds) {
      if (hold.status !== 'ACTIVE') continue;
      if (!holdRepository.tryCloseHold(hold.id, 'RELEASED', now, db)) continue;
      if (!seatRepository.tryTransition(hold.show_seat_id, 'RELEASE', now, db)) continue;

      const seat = seatRepository.findShowSeatsByIds(hold.show_id, [hold.show_seat_id], db)[0];
      releaseEvents.push(
        seatStatusChanged({
          showId: hold.show_id,
          showSeatId: hold.show_seat_id,
          seatId: seat?.seat_id ?? '',
          label: hold.label,
          status: 'AVAILABLE',
          reason: 'RELEASED',
          at: now,
        }),
      );
    }
    return { events: releaseEvents, released: releaseEvents.length };
  });

  realtimePublisher.publishAll(events);
  return { releasedSeats: released };
}

/**
 * Lets a returning client (refresh, reconnect, second tab) recover the holds it
 * still owns, with the authoritative expiry time.
 */
export function getActiveHoldForUser(userId: string, showId: string): HoldDto | null {
  const now = Date.now();
  const { events, holds } = withTransaction((db) => ({
    events: releaseExpiredHoldsWithin(db, now, { showId }),
    holds: holdRepository.findActiveHoldsForUserShow(userId, showId, db),
  }));
  realtimePublisher.publishAll(events);
  if (holds.length === 0) return null;

  // All seats held in one request share a group; show the most recent group.
  const groupId = holds[0]!.group_id;
  const group = holds.filter((hold) => hold.group_id === groupId);
  const seats = group.map((hold) => ({
    showSeatId: hold.show_seat_id,
    label: hold.label,
    price: hold.price,
  }));

  return {
    holdGroupId: groupId,
    showId,
    userId,
    seats,
    totalAmount: sumPaise(seats.map((seat) => seat.price)),
    createdAt: group[0]!.created_at,
    expiresAt: group[0]!.expires_at,
    serverTime: now,
  };
}
