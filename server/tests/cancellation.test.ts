import { beforeEach, describe, expect, it } from 'vitest';
import type { AppError } from '../src/domain/errors.js';
import * as bookingService from '../src/services/bookingService.js';
import * as holdService from '../src/services/holdService.js';
import {
  bookingStatus,
  createShow,
  createUser,
  resetDatabase,
  seatStatus,
  type TestShow,
  type TestUser,
} from './helpers/fixtures.js';
import { getDb } from '../src/db/index.js';

let show: TestShow;
let alice: TestUser;
let bob: TestUser;

beforeEach(async () => {
  resetDatabase();
  alice = await createUser({ name: 'Alice' });
  bob = await createUser({ name: 'Bob' });
  show = createShow({ startsInHours: 48 });
});

function bookSeats(user: TestUser, labels: string[], target: TestShow = show) {
  const held = holdService.holdSeats({
    userId: user.id,
    showId: target.showId,
    showSeatIds: target.seatIds(...labels),
  });
  return bookingService.confirmBooking({
    userId: user.id,
    showId: target.showId,
    holdGroupId: held.holdGroupId,
  }).booking;
}

describe('cancelling a booking', () => {
  it('lets the owner cancel and returns every seat to AVAILABLE', () => {
    const booking = bookSeats(alice, ['A1', 'A2']);

    const cancelled = bookingService.cancelBooking(booking.id, alice.id);

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeTypeOf('number');
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('AVAILABLE');
  });

  it('refuses to let a non-owner cancel', () => {
    const booking = bookSeats(alice, ['A1']);

    expect(() => bookingService.cancelBooking(booking.id, bob.id)).toThrowError(
      /only cancel your own/i,
    );
    expect(bookingStatus(booking.id)).toBe('CONFIRMED');
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('refuses a second cancellation of the same booking', () => {
    const booking = bookSeats(alice, ['A1']);
    bookingService.cancelBooking(booking.id, alice.id);

    expect(() => bookingService.cancelBooking(booking.id, alice.id)).toThrowError(
      /already been cancelled/i,
    );
  });

  it('frees the seat for another user to book afterwards', () => {
    const booking = bookSeats(alice, ['A1']);
    bookingService.cancelBooking(booking.id, alice.id);

    const rebooked = bookSeats(bob, ['A1']);

    expect(rebooked.userId).toBe(bob.id);
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('keeps the cancelled booking in history with its seats', () => {
    const booking = bookSeats(alice, ['A1', 'A2']);
    bookingService.cancelBooking(booking.id, alice.id);

    const history = bookingService.listMyBookings(alice.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('CANCELLED');
    expect(history[0]!.seats.map((seat) => seat.label)).toEqual(['A1', 'A2']);
    expect(history[0]!.cancellable).toBe(false);
  });

  it('releases the unique-seat reservation so the seat can be booked again', () => {
    const booking = bookSeats(alice, ['A1']);
    bookingService.cancelBooking(booking.id, alice.id);
    bookSeats(bob, ['A1']);

    // Exactly one active booking_seats row for the seat, plus the historic one.
    const rows = getDb()
      .prepare<[], { is_active: number }>('SELECT is_active FROM booking_seats')
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.is_active === 1)).toHaveLength(1);
  });
});

describe('cancellation rules', () => {
  it('refuses cancellation inside the cutoff window before showtime', () => {
    // The cutoff is 60 minutes; this show starts in 30.
    const soon = createShow({ startsInHours: 0.5 });
    const booking = bookSeats(alice, ['A1'], soon);

    try {
      bookingService.cancelBooking(booking.id, alice.id);
      expect.unreachable('cancellation should have been refused');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(409);
      expect((error as AppError).message).toMatch(/within 60 minutes/i);
    }
    expect(seatStatus(soon.showId, 'A1')).toBe('BOOKED');
  });

  it('marks a booking inside the cutoff window as not cancellable', () => {
    const soon = createShow({ startsInHours: 0.5 });
    const booking = bookSeats(alice, ['A1'], soon);

    const detail = bookingService.getBookingForUser(booking.id, { id: alice.id, role: 'USER' });
    expect(detail.cancellable).toBe(false);
  });

  it('marks a booking well before showtime as cancellable', () => {
    const booking = bookSeats(alice, ['A1']);
    const detail = bookingService.getBookingForUser(booking.id, { id: alice.id, role: 'USER' });
    expect(detail.cancellable).toBe(true);
  });
});
