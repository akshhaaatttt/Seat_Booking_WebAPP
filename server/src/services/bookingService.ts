import { withTransaction } from '../db/index.js';
import { badRequest, conflict, forbidden, notFound } from '../domain/errors.js';
import { newBookingId, newId } from '../domain/ids.js';
import type { BookingDto } from '../domain/models.js';
import { sumPaise } from '../domain/money.js';
import { assertTransition } from '../domain/seatState.js';
import * as bookingRepository from '../repositories/bookingRepository.js';
import * as holdRepository from '../repositories/holdRepository.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showRepository from '../repositories/showRepository.js';

/** Turns a hold into a confirmed booking. */
export function confirmBooking(input: {
  userId: string;
  showId: string;
  holdGroupId: string;
}): { booking: BookingDto } {
  const now = Date.now();

  const show = showRepository.findShowById(input.showId);
  if (!show) throw notFound('Show not found.');

  const bookingId = withTransaction((db) => {
    const holds = holdRepository.findHoldsByGroup(input.holdGroupId, db);
    if (holds.length === 0) throw notFound('Hold not found.');
    if (holds.some((hold) => hold.user_id !== input.userId)) {
      throw forbidden('This hold belongs to another user.');
    }
    if (holds.some((hold) => hold.show_id !== input.showId)) {
      throw badRequest('This hold does not belong to the requested show.');
    }

    const activeHolds = holds.filter((hold) => hold.status === 'ACTIVE');
    if (activeHolds.length !== holds.length) throw conflict('This hold is no longer active.');
    if (activeHolds.some((hold) => hold.expires_at <= now)) {
      throw conflict('Your seat hold has expired. Please select your seats again.');
    }

    const seatIds = activeHolds.map((hold) => hold.show_seat_id);
    const showSeats = seatRepository.findShowSeatsByIds(input.showId, seatIds, db);
    if (showSeats.length !== seatIds.length) throw notFound('Held seats could not be found.');

    for (const seat of showSeats) {
      assertTransition(seat.label, seat.status, 'BOOK');
      if (!seatRepository.tryTransition(seat.id, 'BOOK', now, db)) {
        throw conflict(`Seat ${seat.label} is no longer available.`);
      }
    }

    const totalAmount = sumPaise(showSeats.map((seat) => seat.price));
    const id = newBookingId(new Date(now));

    bookingRepository.insertBooking(
      {
        id,
        userId: input.userId,
        showId: input.showId,
        holdGroupId: input.holdGroupId,
        totalAmount,
        createdAt: now,
      },
      db,
    );

    bookingRepository.insertBookingSeats(
      showSeats.map((seat) => ({
        id: newId(),
        bookingId: id,
        showSeatId: seat.id,
        price: seat.price,
      })),
      db,
    );

    for (const hold of activeHolds) {
      holdRepository.tryCloseHold(hold.id, 'CONVERTED', now, db);
    }

    return id;
  });

  const row = bookingRepository.findBookingById(bookingId);
  if (!row) throw notFound('Booking not found.');

  const seats = bookingRepository.listBookingSeats([row.id]);
  return {
    booking: bookingRepository.toBookingDto(row, seats, {
      cancellable: false,
      includeUser: false,
    }),
  };
}
