import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  app,
  authed,
  createShow,
  createUser,
  resetDatabase,
  seatStatus,
  type TestShow,
  type TestUser,
} from './helpers/fixtures.js';
import { getDb } from '../src/db/index.js';

describe('booking', () => {
  let show: TestShow;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    resetDatabase();
    show = createShow();
    alice = await createUser({ name: 'Alice' });
    bob = await createUser({ name: 'Bob' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const hold = async (user: TestUser, labels: string[]): Promise<string> => {
    const response = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds(...labels) })
      .expect(201);
    return response.body.hold.holdGroupId;
  };

  const book = (user: TestUser, holdGroupId: string) =>
    request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId });

  it('converts a valid hold into a confirmed booking', async () => {
    const group = await hold(alice, ['A1', 'A2', 'A3']);
    const response = await book(alice, group).expect(201);

    const booking = response.body.booking;
    expect(booking.id).toMatch(/^BK-\d{8}-[0-9A-F]{6}$/);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.seats.map((s: { label: string }) => s.label)).toEqual(['A1', 'A2', 'A3']);
    expect(booking.totalAmount).toBe(75000);
    expect(booking.userId).toBe(alice.id);
    expect(booking.createdAt).toBeGreaterThan(0);

    for (const label of ['A1', 'A2', 'A3']) {
      expect(seatStatus(show.showId, label)).toBe('BOOKED');
    }
  });

  it('computes the total from stored prices, ignoring anything the client sends', async () => {
    const group = await hold(alice, ['E1']); // RECLINER, 2.0x of ₹250
    const response = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: group, totalAmount: 1, price: 1, seats: ['A1'] })
      .expect(201);

    expect(response.body.booking.totalAmount).toBe(50000);
    expect(response.body.booking.seats).toHaveLength(1);
    expect(response.body.booking.seats[0].label).toBe('E1');
  });

  it('closes the holds once they are converted', async () => {
    const group = await hold(alice, ['A1']);
    await book(alice, group).expect(201);

    const rows = getDb()
      .prepare<[string], { status: string }>('SELECT status FROM holds WHERE group_id = ?')
      .all(group);
    expect(rows.every((row) => row.status === 'CONVERTED')).toBe(true);
  });

  it('will not let a user book another user\'s hold', async () => {
    const group = await hold(alice, ['A1']);
    const response = await book(bob, group).expect(403);

    expect(response.body.error.message).toBe('This hold belongs to another user.');
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
  });

  it('rejects an unknown hold group', async () => {
    await book(alice, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('rejects a hold that was voluntarily released', async () => {
    const group = await hold(alice, ['A1']);
    await request(app).delete(`/api/holds/${group}`).set(authed(alice.token)).expect(200);

    const response = await book(alice, group).expect(409);
    expect(response.body.error.message).toBe('This hold is no longer active.');
  });

  it('is idempotent when the same confirmation is replayed', async () => {
    const group = await hold(alice, ['A1', 'A2']);
    const first = await book(alice, group).expect(201);
    const second = await book(alice, group).expect(200);

    expect(second.body.booking.id).toBe(first.body.booking.id);
    const count = getDb()
      .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM bookings')
      .get();
    expect(count?.total).toBe(1);
  });

  it('requires the hold to belong to the show in the path', async () => {
    const otherShow = createShow();
    const group = await hold(alice, ['A1']);
    await request(app)
      .post(`/api/shows/${otherShow.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: group })
      .expect(400);
  });

  it('requires authentication and a valid body', async () => {
    const group = await hold(alice, ['A1']);
    await request(app).post(`/api/shows/${show.showId}/book`).send({ holdGroupId: group }).expect(401);
    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({})
      .expect(400);
  });

  it('lists only the caller\'s own bookings', async () => {
    await book(alice, await hold(alice, ['A1'])).expect(201);
    await book(bob, await hold(bob, ['B1'])).expect(201);

    const mine = await request(app).get('/api/bookings').set(authed(alice.token)).expect(200);
    expect(mine.body.bookings).toHaveLength(1);
    expect(mine.body.bookings[0].seats[0].label).toBe('A1');
    expect(mine.body.bookings[0].eventTitle).toBe('Avengers: Secret Wars');
  });

  it('refuses to show one user\'s booking to another', async () => {
    const response = await book(alice, await hold(alice, ['A1'])).expect(201);
    const bookingId = response.body.booking.id;

    await request(app).get(`/api/bookings/${bookingId}`).set(authed(alice.token)).expect(200);
    await request(app).get(`/api/bookings/${bookingId}`).set(authed(bob.token)).expect(403);
    await request(app).get(`/api/bookings/${bookingId}`).expect(401);
  });

  it('lets an admin read any booking, including who made it', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const response = await book(alice, await hold(alice, ['A1'])).expect(201);

    const seen = await request(app)
      .get(`/api/bookings/${response.body.booking.id}`)
      .set(authed(admin.token))
      .expect(200);
    expect(seen.body.booking.userEmail).toBe(alice.email);
  });
});

describe('cancellation', () => {
  let show: TestShow;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    resetDatabase();
    show = createShow({ startsInHours: 48 });
    alice = await createUser({ name: 'Alice' });
    bob = await createUser({ name: 'Bob' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const bookSeats = async (user: TestUser, labels: string[]): Promise<string> => {
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds(...labels) })
      .expect(201);
    const booked = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);
    return booked.body.booking.id;
  };

  it('returns every seat to AVAILABLE when the owner cancels', async () => {
    const bookingId = await bookSeats(alice, ['A1', 'A2']);

    const response = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set(authed(alice.token))
      .expect(200);

    expect(response.body.booking.status).toBe('CANCELLED');
    expect(response.body.booking.cancelledAt).toBeGreaterThan(0);
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('AVAILABLE');
  });

  it('lets the freed seats be sold again', async () => {
    const bookingId = await bookSeats(alice, ['A1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(alice.token)).expect(200);

    const newBooking = await bookSeats(bob, ['A1']);
    expect(newBooking).not.toBe(bookingId);
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('will not let a non-owner cancel', async () => {
    const bookingId = await bookSeats(alice, ['A1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(bob.token)).expect(403);
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('will not let an admin cancel someone else\'s booking either', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const bookingId = await bookSeats(alice, ['A1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(admin.token)).expect(403);
  });

  it('rejects a second cancellation', async () => {
    const bookingId = await bookSeats(alice, ['A1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(alice.token)).expect(200);
    const response = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set(authed(alice.token))
      .expect(409);
    expect(response.body.error.message).toBe('This booking has already been cancelled.');
  });

  it('refuses cancellation inside the cutoff window before showtime', async () => {
    const bookingId = await bookSeats(alice, ['A1']);

    // 30 minutes before the show, inside the 60 minute cutoff.
    const startsAt = getDb()
      .prepare<[string], { starts_at: number }>('SELECT starts_at FROM shows WHERE id = ?')
      .get(show.showId)!.starts_at;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(startsAt - 30 * 60 * 1000);

    const response = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set(authed(alice.token))
      .expect(409);
    expect(response.body.error.message).toContain('60 minutes of showtime');
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('marks a booking as not cancellable once inside the cutoff', async () => {
    const bookingId = await bookSeats(alice, ['A1']);
    const before = await request(app).get(`/api/bookings/${bookingId}`).set(authed(alice.token)).expect(200);
    expect(before.body.booking.cancellable).toBe(true);

    const startsAt = getDb()
      .prepare<[string], { starts_at: number }>('SELECT starts_at FROM shows WHERE id = ?')
      .get(show.showId)!.starts_at;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(startsAt - 10 * 60 * 1000);

    const after = await request(app).get(`/api/bookings/${bookingId}`).set(authed(alice.token)).expect(200);
    expect(after.body.booking.cancellable).toBe(false);
  });

  it('keeps the historical seat rows but deactivates them', async () => {
    const bookingId = await bookSeats(alice, ['A1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(alice.token)).expect(200);

    const rows = getDb()
      .prepare<[string], { is_active: number }>('SELECT is_active FROM booking_seats WHERE booking_id = ?')
      .all(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(0);
  });
});
