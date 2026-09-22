import { config } from '../config/index.js';
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
import type { SeatStatusChangedEvent } from '../realtime/events.js';
import { realtimePublisher, seatStatusChanged } from '../realtime/publisher.js';
import { sweepIfNeeded } from './holdExpirationService.js';

const BOOKING_ID_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

function cancellationDeadline(showStartsAt: number): number {
  return showStartsAt - config.bookings.cancellationCutoffMinutes * 60 * 1000;
}

export function isCancellable(
  booking: { status: string; show_starts_at: number },
  now: number,
): boolean {
  return booking.status === 'CONFIRMED' && now < cancellationDeadline(booking.show_starts_at);
}

function detailToDto(
  row: bookingRepository.BookingDetailRow,
  now: number,
  options: { includeUser: boolean },
): BookingDto {
  const seats = bookingRepository.listBookingSeats([row.id]);
  return bookingRepository.toBookingDto(row, seats, {
    cancellable: isCancellable(row, now),
    includeUser: options.includeUser,
  });
}

/**
 * Converts a hold group into a booking: HELD → BOOKED for every seat, or
 * nothing at all.
 *
 * The guarantees enforced here, all inside one `BEGIN IMMEDIATE` transaction:
 *   - the hold exists and belongs to the authenticated user (Rule 3);
 *   - the hold has not expired according to the *server* clock (Rule 4) — the
 *     lazy sweep runs first, so an expired hold is already gone by the time we
 *     look for it;
 *   - each seat is still HELD, checked by a conditional UPDATE (Rule 9);
 *   - the total is computed from `show_seats.price`, never from the request
 *     body (Rule 11);
 *   - a replay of the same request returns the original booking instead of
 *     creating a second one, backed by a unique index on `hold_group_id`.
 */
export function confirmBooking(input: {
  userId: string;
  showId: string;
  holdGroupId: string;
}): { booking: BookingDto; alreadyExisted: boolean } {
  const now = Date.now();

  const show = showRepository.findShowById(input.showId);
  if (!show) throw notFound('Show not found.');
  if (show.starts_at <= now) throw conflict('This show has already started.');

  // Expire stale holds in a separate, committed transaction *before* opening
  // the booking transaction. A booking that then rejects an expired hold rolls
  // back only its own work, leaving the seat correctly released.
  sweepIfNeeded(now, { showId: input.showId });

  const outcome = withTransaction((db) => {
    // Idempotency: a duplicate confirm for the same hold group returns the
    // booking that already exists rather than erroring or double-charging.
    const existing = bookingRepository.findBookingByHoldGroup(input.holdGroupId, db);
    if (existing) {
      if (existing.user_id !== input.userId) throw forbidden('This hold belongs to another user.');
      return { bookingId: existing.id, events: [] as SeatStatusChangedEvent[], alreadyExisted: true };
    }

    const allHolds = holdRepository.findHoldsByGroup(input.holdGroupId, db);
    if (allHolds.length === 0) throw notFound('Hold not found.');
    if (allHolds.some((hold) => hold.user_id !== input.userId)) {
      throw forbidden('This hold belongs to another user.');
    }
    if (allHolds.some((hold) => hold.show_id !== input.showId)) {
      throw badRequest('This hold does not belong to the requested show.');
    }

    const activeHolds = allHolds.filter((hold) => hold.status === 'ACTIVE');
    if (activeHolds.length !== allHolds.length) {
      const reason = allHolds.find((hold) => hold.status === 'EXPIRED')
        ? 'Your seat hold has expired. Please select your seats again.'
        : 'This hold is no longer active.';
      throw conflict(reason, { code: 'HOLD_EXPIRED' });
    }
    // Belt and braces: the sweep above should have caught this, but the booking
    // path re-checks the deadline itself so it never depends on another step.
    if (activeHolds.some((hold) => hold.expires_at <= now)) {
      throw conflict('Your seat hold has expired. Please select your seats again.', {
        code: 'HOLD_EXPIRED',
      });
    }

    const seatIds = activeHolds.map((hold) => hold.show_seat_id);
    const showSeats = seatRepository.findShowSeatsByIds(input.showId, seatIds, db);
    if (showSeats.length !== seatIds.length) throw notFound('Held seats could not be found.');

    const events: SeatStatusChangedEvent[] = [];
    for (const seat of showSeats) {
      assertTransition(seat.label, seat.status, 'BOOK');
      if (!seatRepository.tryTransition(seat.id, 'BOOK', now, db)) {
        throw conflict(`Seat ${seat.label} is no longer available.`, { seatLabel: seat.label });
      }
      events.push(
        seatStatusChanged({
          showId: input.showId,
          showSeatId: seat.id,
          seatId: seat.seat_id,
          label: seat.label,
          status: 'BOOKED',
          reason: 'BOOKED',
          at: now,
        }),
      );
    }

    // Prices come from the inventory row, so a tampered request body cannot
    // change what the user pays.
    const totalAmount = sumPaise(showSeats.map((seat) => seat.price));

    const bookingId = insertBookingWithUniqueId(db, {
      userId: input.userId,
      showId: input.showId,
      holdGroupId: input.holdGroupId,
      totalAmount,
      createdAt: now,
    });

    bookingRepository.insertBookingSeats(
      showSeats.map((seat) => ({
        id: newId(),
        bookingId,
        showSeatId: seat.id,
        price: seat.price,
      })),
      db,
    );

    for (const hold of activeHolds) {
      holdRepository.tryCloseHold(hold.id, 'CONVERTED', now, db);
    }

    return { bookingId, events, alreadyExisted: false };
  });

  realtimePublisher.publishAll(outcome.events);

  const row = bookingRepository.findBookingById(outcome.bookingId);
  if (!row) throw notFound('Booking not found.');
  return {
    booking: detailToDto(row, now, { includeUser: false }),
    alreadyExisted: outcome.alreadyExisted,
  };
}

function insertBookingWithUniqueId(
  db: Parameters<typeof bookingRepository.insertBooking>[1],
  booking: {
    userId: string;
    showId: string;
    holdGroupId: string;
    totalAmount: number;
    createdAt: number;
  },
): string {
  for (let attempt = 0; attempt < BOOKING_ID_ATTEMPTS; attempt += 1) {
    const id = newBookingId(new Date(booking.createdAt));
    try {
      bookingRepository.insertBooking({ id, ...booking }, db);
      return id;
    } catch (error) {
      // A collision on the random reference is retried; a collision on
      // hold_group_id means a concurrent duplicate confirm won the race.
      if (isUniqueViolation(error) && attempt < BOOKING_ID_ATTEMPTS - 1) {
        const clash = bookingRepository.findBookingByHoldGroup(booking.holdGroupId, db);
        if (clash) throw conflict('This hold has already been booked.');
        continue;
      }
      throw error;
    }
  }
  throw conflict('Could not generate a unique booking reference. Please try again.');
}

export function listMyBookings(userId: string): BookingDto[] {
  const now = Date.now();
  const rows = bookingRepository.listBookingsForUser(userId);
  const seats = bookingRepository.listBookingSeats(rows.map((row) => row.id));
  return rows.map((row) =>
    bookingRepository.toBookingDto(
      row,
      seats.filter((seat) => seat.booking_id === row.id),
      { cancellable: isCancellable(row, now), includeUser: false },
    ),
  );
}

/** Ownership is enforced here, not in the route, and not on the client. */
export function getBookingForUser(
  bookingId: string,
  viewer: { id: string; role: string },
): BookingDto {
  const row = bookingRepository.findBookingById(bookingId);
  if (!row) throw notFound('Booking not found.');
  const isOwner = row.user_id === viewer.id;
  if (!isOwner && viewer.role !== 'ADMIN') {
    throw forbidden('You can only view your own bookings.');
  }
  return detailToDto(row, Date.now(), { includeUser: viewer.role === 'ADMIN' });
}

/**
 * Cancels a booking and returns every seat to AVAILABLE.
 * Only the owner may cancel (Rule 6) — admins deliberately have no override.
 */
/** Admin read access: full detail including who made the booking. */
export function getBookingAsAdmin(bookingId: string): BookingDto {
  const row = bookingRepository.findBookingById(bookingId);
  if (!row) throw notFound('Booking not found.');
  return detailToDto(row, Date.now(), { includeUser: true });
}

export function cancelBooking(bookingId: string, userId: string): BookingDto {
  const now = Date.now();

  const events = withTransaction((db) => {
    const row = bookingRepository.findBookingById(bookingId, db);
    if (!row) throw notFound('Booking not found.');
    if (row.user_id !== userId) throw forbidden('You can only cancel your own bookings.');
    if (row.status !== 'CONFIRMED') throw conflict('This booking has already been cancelled.');
    if (now >= cancellationDeadline(row.show_starts_at)) {
      throw conflict(
        `Bookings can no longer be cancelled within ${config.bookings.cancellationCutoffMinutes} minutes of showtime.`,
      );
    }

    const seatIds = bookingRepository.activeBookingSeatIds(bookingId, db);

    // Conditional: only a CONFIRMED booking flips, so two concurrent cancels
    // cannot both release the seats.
    if (!bookingRepository.tryCancelBooking(bookingId, now, db)) {
      throw conflict('This booking has already been cancelled.');
    }
    bookingRepository.deactivateBookingSeats(bookingId, db);

    const cancelEvents: SeatStatusChangedEvent[] = [];
    const seats = seatRepository.findShowSeatsByIds(row.show_id, seatIds, db);
    for (const seat of seats) {
      if (!seatRepository.tryTransition(seat.id, 'CANCEL', now, db)) continue;
      cancelEvents.push(
        seatStatusChanged({
          showId: row.show_id,
          showSeatId: seat.id,
          seatId: seat.seat_id,
          label: seat.label,
          status: 'AVAILABLE',
          reason: 'CANCELLED',
          at: now,
        }),
      );
    }
    return cancelEvents;
  });

  realtimePublisher.publishAll(events);

  const row = bookingRepository.findBookingById(bookingId)!;
  return detailToDto(row, now, { includeUser: false });
}

export function listAllBookings(filters: bookingRepository.AdminBookingFilters): {
  bookings: BookingDto[];
  total: number;
} {
  const now = Date.now();
  const { rows, total } = bookingRepository.listAllBookings(filters);
  const seats = bookingRepository.listBookingSeats(rows.map((row) => row.id));
  return {
    bookings: rows.map((row) =>
      bookingRepository.toBookingDto(
        row,
        seats.filter((seat) => seat.booking_id === row.id),
        { cancellable: isCancellable(row, now), includeUser: true },
      ),
    ),
    total,
  };
}
