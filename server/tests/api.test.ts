import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  app,
  authed,
  createShow,
  createUser,
  resetDatabase,
  type TestShow,
  type TestUser,
} from './helpers/fixtures.js';

let show: TestShow;
let user: TestUser;
let admin: TestUser;

beforeEach(async () => {
  resetDatabase();
  user = await createUser({ name: 'Aria' });
  admin = await createUser({ name: 'Admin', role: 'ADMIN' });
  show = createShow();
});

describe('events and shows', () => {
  it('lists events with their next showtime', async () => {
    const response = await request(app).get('/api/events').expect(200);

    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({ title: 'Avengers: Secret Wars', isActive: true });
    expect(response.body.events[0].showCount).toBe(1);
  });

  it('lists the shows for an event with live seat counts', async () => {
    const response = await request(app).get(`/api/events/${show.eventId}/shows`).expect(200);

    expect(response.body.shows).toHaveLength(1);
    expect(response.body.shows[0]).toMatchObject({
      id: show.showId,
      totalSeats: 50,
      availableSeats: 50,
      heldSeats: 0,
      bookedSeats: 0,
    });
  });

  it('returns 404 for an unknown event', async () => {
    await request(app).get('/api/events/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('refuses event creation to non-admins', async () => {
    const payload = { title: 'X', description: 'Y', category: 'Movie', venue: 'Z' };
    await request(app).post('/api/events').send(payload).expect(401);
    await request(app).post('/api/events').set(authed(user.token)).send(payload).expect(403);
    await request(app).post('/api/events').set(authed(admin.token)).send(payload).expect(201);
  });

  it('validates the show payload and refuses a past showtime', async () => {
    await request(app)
      .post(`/api/events/${show.eventId}/shows`)
      .set(authed(admin.token))
      .send({ startsAt: Date.now() - 1000, layoutKey: 'cinema-50', basePrice: 250 })
      .expect(400);

    await request(app)
      .post(`/api/events/${show.eventId}/shows`)
      .set(authed(admin.token))
      .send({ startsAt: Date.now() + 86_400_000, layoutKey: 'no-such-layout', basePrice: 250 })
      .expect(400);
  });

  it('creates a show with its own seat inventory', async () => {
    const response = await request(app)
      .post(`/api/events/${show.eventId}/shows`)
      .set(authed(admin.token))
      .send({
        startsAt: Date.now() + 86_400_000,
        screen: 'Lounge',
        layoutKey: 'lounge-24',
        basePrice: 400,
      })
      .expect(201);

    expect(response.body.show.totalSeats).toBe(24);
    expect(response.body.show.availableSeats).toBe(24);
    // Inventory is independent per show.
    expect(response.body.show.id).not.toBe(show.showId);
  });
});

describe('seat map', () => {
  it('returns rows, prices, legend counts and the server clock', async () => {
    const response = await request(app).get(`/api/shows/${show.showId}/seats`).expect(200);

    expect(response.body.rows.map((row: { rowLabel: string }) => row.rowLabel)).toEqual([
      'A', 'B', 'C', 'D', 'E',
    ]);
    expect(response.body.legendCounts).toEqual({ AVAILABLE: 50, HELD: 0, BOOKED: 0 });
    expect(response.body.serverTime).toBeTypeOf('number');

    const a1 = response.body.rows[0].seats[0];
    expect(a1).toMatchObject({ label: 'A1', status: 'AVAILABLE', price: 25000, heldByMe: false });
  });

  it('marks the viewer\'s own held seats and hides other users\' ownership', async () => {
    const other = await createUser();
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(other.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);

    const asOther = await request(app)
      .get(`/api/shows/${show.showId}/seats`)
      .set(authed(other.token))
      .expect(200);
    const asUser = await request(app)
      .get(`/api/shows/${show.showId}/seats`)
      .set(authed(user.token))
      .expect(200);

    const pick = (body: { rows: { seats: { label: string; heldByMe: boolean }[] }[] }) =>
      body.rows.flatMap((row) => row.seats).find((seat) => seat.label === 'A1')!;

    expect(pick(asOther.body).heldByMe).toBe(true);
    expect(pick(asUser.body).heldByMe).toBe(false);
  });
});

describe('hold and booking endpoints', () => {
  it('walks the full flow: hold -> book -> history -> cancel', async () => {
    const holdResponse = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds('A1', 'A2') })
      .expect(201);

    const { holdGroupId, totalAmount, expiresAt, serverTime } = holdResponse.body.hold;
    expect(totalAmount).toBe(50000);
    expect(expiresAt - serverTime).toBe(300_000);

    const bookResponse = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId })
      .expect(201);

    const bookingId = bookResponse.body.booking.id;
    expect(bookingId).toMatch(/^BK-\d{8}-[0-9A-F]{6}$/);

    const history = await request(app).get('/api/bookings').set(authed(user.token)).expect(200);
    expect(history.body.bookings).toHaveLength(1);
    expect(history.body.bookings[0].id).toBe(bookingId);

    await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set(authed(user.token))
      .expect(200);

    const seats = await request(app).get(`/api/shows/${show.showId}/seats`).expect(200);
    expect(seats.body.legendCounts).toEqual({ AVAILABLE: 50, HELD: 0, BOOKED: 0 });
  });

  it('answers 409 when a seat is already held by someone else', async () => {
    const other = await createUser();
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(other.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);

    const response = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toMatch(/A1 is no longer available/);
  });

  it('requires authentication for holds, bookings and cancellation', async () => {
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(401);
    await request(app).get('/api/bookings').expect(401);
    await request(app).post('/api/bookings/BK-20260101-ABCDEF/cancel').expect(401);
  });

  it('rejects a malformed hold request with 400', async () => {
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: [] })
      .expect(400);

    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: ['not-a-uuid'] })
      .expect(400);
  });

  it('releases a hold through DELETE /api/holds/:holdId', async () => {
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds('A1', 'A2') })
      .expect(201);

    const response = await request(app)
      .delete(`/api/holds/${held.body.hold.holdGroupId}`)
      .set(authed(user.token))
      .expect(200);

    expect(response.body.releasedSeats).toBe(2);
  });

  it('refuses to release a hold belonging to another user', async () => {
    const other = await createUser();
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(other.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);

    await request(app)
      .delete(`/api/holds/${held.body.hold.holdGroupId}`)
      .set(authed(user.token))
      .expect(403);
  });

  it('lets a returning client recover its live hold', async () => {
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds('B1') })
      .expect(201);

    const recovered = await request(app)
      .get(`/api/shows/${show.showId}/my-hold`)
      .set(authed(user.token))
      .expect(200);

    expect(recovered.body.hold.holdGroupId).toBe(held.body.hold.holdGroupId);
  });
});

describe('admin endpoints', () => {
  it('are closed to anonymous and standard users', async () => {
    for (const path of ['/api/admin/events', '/api/admin/shows', '/api/admin/bookings']) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set(authed(user.token)).expect(403);
      await request(app).get(path).set(authed(admin.token)).expect(200);
    }
  });

  it('lists and searches bookings across all users', async () => {
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);
    const booked = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);

    const all = await request(app)
      .get('/api/admin/bookings')
      .set(authed(admin.token))
      .expect(200);
    expect(all.body.total).toBe(1);
    expect(all.body.bookings[0].userEmail).toBe(user.email);

    const found = await request(app)
      .get(`/api/admin/bookings?search=${booked.body.booking.id}`)
      .set(authed(admin.token))
      .expect(200);
    expect(found.body.total).toBe(1);

    const missing = await request(app)
      .get('/api/admin/bookings?search=nothing-matches-this')
      .set(authed(admin.token))
      .expect(200);
    expect(missing.body.total).toBe(0);
  });

  it('exposes the seat breakdown for a show', async () => {
    const response = await request(app)
      .get(`/api/admin/shows/${show.showId}/seats`)
      .set(authed(admin.token))
      .expect(200);

    expect(response.body.legendCounts).toEqual({ AVAILABLE: 50, HELD: 0, BOOKED: 0 });
  });

  it('deactivates rather than deletes an event that has bookings', async () => {
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);
    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);

    const response = await request(app)
      .delete(`/api/events/${show.eventId}`)
      .set(authed(admin.token))
      .expect(200);

    expect(response.body.deleted).toBe(false);
    expect(response.body.event.isActive).toBe(false);
    // The booking survives.
    const bookings = await request(app).get('/api/bookings').set(authed(user.token)).expect(200);
    expect(bookings.body.bookings).toHaveLength(1);
  });

  it('refuses to reprice a show that already has sales', async () => {
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: [show.seatId('A1')] })
      .expect(201);

    await request(app)
      .patch(`/api/shows/${show.showId}`)
      .set(authed(admin.token))
      .send({ basePrice: 999 })
      .expect(409);
  });
});

describe('error handling', () => {
  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/api/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('reports a healthy service', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
  });
});
