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

export interface HoldRequest {
  userId: string;
  showId: string;
  showSeatIds: string[];
}

/** Moves the selected seats from AVAILABLE to HELD. */
export function holdSeats(request: HoldRequest): HoldDto {
  const seatIds = [...new Set(request.showSeatIds)];
  if (seatIds.length === 0) throw badRequest('Select at least one seat.');
  if (seatIds.length > config.holds.maxSeatsPerHold) {
    throw badRequest(`You can hold at most ${config.holds.maxSeatsPerHold} seats at a time.`);
  }

  const now = Date.now();
  const show = showRepository.findShowById(request.showId);
  if (!show) throw notFound('Show not found.');
  if (show.starts_at <= now) throw conflict('This show has already started.');

  const groupId = newId();
  const expiresAt = now + config.holds.durationSeconds * 1000;

  const seats = withTransaction((db) => {
    const showSeats = seatRepository.findShowSeatsByIds(request.showId, seatIds, db);
    if (showSeats.length !== seatIds.length) {
      throw notFound('One or more selected seats do not belong to this show.');
    }

    for (const seat of showSeats) {
      assertTransition(seat.label, seat.status, 'HOLD');
      if (!seatRepository.tryTransition(seat.id, 'HOLD', now, db)) {
        throw conflict(`Seat ${seat.label} is no longer available.`);
      }
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
    }

    return showSeats.map((seat) => ({ showSeatId: seat.id, label: seat.label, price: seat.price }));
  });

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

/** Releases a hold the user no longer wants. */
export function releaseHold(userId: string, holdIdOrGroupId: string): { releasedSeats: number } {
  const now = Date.now();

  return withTransaction((db) => {
    let holds = holdRepository.findHoldsByGroup(holdIdOrGroupId, db);
    if (holds.length === 0) {
      const single = holdRepository.findHoldById(holdIdOrGroupId, db);
      if (!single) throw notFound('Hold not found.');
      holds = holdRepository.findHoldsByGroup(single.group_id, db);
    }

    if (holds.some((hold) => hold.user_id !== userId)) {
      throw forbidden('You can only release your own holds.');
    }

    let released = 0;
    for (const hold of holds) {
      if (hold.status !== 'ACTIVE') continue;
      if (!holdRepository.tryCloseHold(hold.id, 'RELEASED', now, db)) continue;
      if (seatRepository.tryTransition(hold.show_seat_id, 'RELEASE', now, db)) released += 1;
    }
    return { releasedSeats: released };
  });
}

/** Lets a client that refreshed the page pick its hold back up. */
export function getActiveHoldForUser(userId: string, showId: string): HoldDto | null {
  const holds = holdRepository.findActiveHoldsForUserShow(userId, showId);
  if (holds.length === 0) return null;

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
    serverTime: Date.now(),
  };
}
