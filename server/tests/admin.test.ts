import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('events and shows API', () => {
  let admin: TestUser;
  let user: TestUser;

  beforeEach(async () => {
    resetDatabase();
    admin = await createUser({ role: 'ADMIN', name: 'Asha' });
    user = await createUser({ name: 'Aria' });
  });

  it('lists public events with their show counts', async () => {
    createShow();
    const response = await request(app).get('/api/events').expect(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({ title: 'Avengers: Secret Wars', showCount: 1 });
  });

  it('gives each show its own independent seat inventory', async () => {
    const first = createShow();
    const second = createShow();

    await request(app)
      .post(`/api/shows/${first.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: first.seatIds('A1') })
      .expect(201);

    // The same physical seat is untouched for the other show.
    expect(seatStatus(first.showId, 'A1')).toBe('HELD');
    expect(seatStatus(second.showId, 'A1')).toBe('AVAILABLE');
  });

  it('exposes a seat map with a full layout and counts', async () => {
    const show = createShow();
    const response = await request(app).get(`/api/shows/${show.showId}/seats`).expect(200);

    expect(response.body.rows.map((row: { rowLabel: string }) => row.rowLabel)).toEqual([
      'A', 'B', 'C', 'D', 'E',
    ]);
    expect(response.body.rows[0].seats).toHaveLength(10);
    expect(response.body.legendCounts).toEqual({ AVAILABLE: 50, HELD: 0, BOOKED: 0 });
    expect(response.body.serverTime).toBeGreaterThan(0);
    // Prices are resolved per tier: A is standard, E is recliner.
    expect(response.body.rows[0].seats[0].price).toBe(25000);
    expect(response.body.rows[4].seats[0].price).toBe(50000);
  });

  it('returns 404 for an unknown show or event', async () => {
    await request(app).get('/api/shows/11111111-1111-4111-8111-111111111111/seats').expect(404);
    await request(app).get('/api/events/11111111-1111-4111-8111-111111111111').expect(404);
  });

  it('only lets an admin create, update and remove events', async () => {
    await request(app).post('/api/events').send({ title: 'X', category: 'Movie', venue: 'V' }).expect(401);
    await request(app)
      .post('/api/events')
      .set(authed(user.token))
      .send({ title: 'X', category: 'Movie', venue: 'V' })
      .expect(403);

    const created = await request(app)
      .post('/api/events')
      .set(authed(admin.token))
      .send({ title: 'IPL Final 2026', description: 'Title decider', category: 'Sports', venue: 'Chennai' })
      .expect(201);
    expect(created.body.event.title).toBe('IPL Final 2026');

    const patched = await request(app)
      .patch(`/api/events/${created.body.event.id}`)
      .set(authed(admin.token))
      .send({ venue: 'M. A. Chidambaram Stadium' })
      .expect(200);
    expect(patched.body.event.venue).toBe('M. A. Chidambaram Stadium');

    await request(app).delete(`/api/events/${created.body.event.id}`).set(authed(user.token)).expect(403);
    const removed = await request(app)
      .delete(`/api/events/${created.body.event.id}`)
      .set(authed(admin.token))
      .expect(200);
    expect(removed.body.deleted).toBe(true);
  });

  it('creates a show with its own seat inventory', async () => {
    const event = await request(app)
      .post('/api/events')
      .set(authed(admin.token))
      .send({ title: 'Tech Conference 2026', category: 'Conference', venue: 'Mumbai' })
      .expect(201);

    const show = await request(app)
      .post(`/api/events/${event.body.event.id}/shows`)
      .set(authed(admin.token))
      .send({
        startsAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        screen: 'Main Hall',
        layoutKey: 'lounge-24',
        basePrice: 1500,
      })
      .expect(201);

    expect(show.body.show.totalSeats).toBe(24);
    expect(show.body.show.availableSeats).toBe(24);
    expect(show.body.show.basePrice).toBe(150000); // rupees in, paise stored
  });

  it('rejects an unknown layout and a past showtime', async () => {
    const event = await request(app)
      .post('/api/events')
      .set(authed(admin.token))
      .send({ title: 'E', category: 'C', venue: 'V' })
      .expect(201);

    await request(app)
      .post(`/api/events/${event.body.event.id}/shows`)
      .set(authed(admin.token))
      .send({ startsAt: Date.now() + 3600_000, layoutKey: 'does-not-exist', basePrice: 100 })
      .expect(400);

    await request(app)
      .post(`/api/events/${event.body.event.id}/shows`)
      .set(authed(admin.token))
      .send({ startsAt: Date.now() - 3600_000, layoutKey: 'cinema-50', basePrice: 100 })
      .expect(400);
  });

  it('deactivates rather than deletes a show that has sales', async () => {
    const show = createShow();
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds('A1') })
      .expect(201);
    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(user.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);

    const response = await request(app)
      .delete(`/api/shows/${show.showId}`)
      .set(authed(admin.token))
      .expect(200);

    expect(response.body.deleted).toBe(false);
    expect(response.body.show.isActive).toBe(false);
    // The booking and its seat are untouched.
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('refuses to reprice a show that already has held or booked seats', async () => {
    const show = createShow();
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds('A1') })
      .expect(201);

    const response = await request(app)
      .patch(`/api/shows/${show.showId}`)
      .set(authed(admin.token))
      .send({ basePrice: 999 })
      .expect(409);
    expect(response.body.error.message).toContain('Prices cannot change');
  });
});

describe('admin panel', () => {
  let admin: TestUser;
  let alice: TestUser;
  let bob: TestUser;
  let show: TestShow;

  beforeEach(async () => {
    resetDatabase();
    admin = await createUser({ role: 'ADMIN', name: 'Asha' });
    alice = await createUser({ name: 'Alice', email: 'alice@example.com' });
    bob = await createUser({ name: 'Bob', email: 'bob@example.com' });
    show = createShow();
  });

  const bookFor = async (user: TestUser, labels: string[]): Promise<string> => {
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

  it('blocks non-admins from every admin route', async () => {
    for (const path of ['/api/admin/bookings', '/api/admin/events', '/api/admin/shows', '/api/admin/layouts']) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set(authed(alice.token)).expect(403);
      await request(app).get(path).set(authed(admin.token)).expect(200);
    }
  });

  it('lists every booking with the customer attached', async () => {
    await bookFor(alice, ['A1']);
    await bookFor(bob, ['B1']);

    const response = await request(app).get('/api/admin/bookings').set(authed(admin.token)).expect(200);
    expect(response.body.total).toBe(2);
    expect(response.body.bookings.map((b: { userEmail: string }) => b.userEmail).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('searches bookings by reference, customer and event', async () => {
    const bookingId = await bookFor(alice, ['A1']);
    await bookFor(bob, ['B1']);

    const byId = await request(app)
      .get(`/api/admin/bookings?search=${bookingId}`)
      .set(authed(admin.token))
      .expect(200);
    expect(byId.body.bookings).toHaveLength(1);

    const byEmail = await request(app)
      .get('/api/admin/bookings?search=bob@example.com')
      .set(authed(admin.token))
      .expect(200);
    expect(byEmail.body.bookings).toHaveLength(1);
    expect(byEmail.body.bookings[0].userName).toBe('Bob');

    const byEvent = await request(app)
      .get('/api/admin/bookings?search=Avengers')
      .set(authed(admin.token))
      .expect(200);
    expect(byEvent.body.bookings).toHaveLength(2);
  });

  it('filters bookings by status and paginates', async () => {
    const bookingId = await bookFor(alice, ['A1']);
    await bookFor(bob, ['B1']);
    await request(app).post(`/api/bookings/${bookingId}/cancel`).set(authed(alice.token)).expect(200);

    const cancelled = await request(app)
      .get('/api/admin/bookings?status=CANCELLED')
      .set(authed(admin.token))
      .expect(200);
    expect(cancelled.body.bookings).toHaveLength(1);
    expect(cancelled.body.bookings[0].id).toBe(bookingId);

    const page = await request(app)
      .get('/api/admin/bookings?limit=1&offset=0')
      .set(authed(admin.token))
      .expect(200);
    expect(page.body.bookings).toHaveLength(1);
    expect(page.body.total).toBe(2);
  });

  it('rejects invalid query parameters', async () => {
    await request(app).get('/api/admin/bookings?limit=0').set(authed(admin.token)).expect(400);
    await request(app).get('/api/admin/bookings?status=NOPE').set(authed(admin.token)).expect(400);
  });

  it('shows the live seat breakdown for a show', async () => {
    await bookFor(alice, ['A1', 'A2']);
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(bob.token))
      .send({ showSeatIds: show.seatIds('C1') })
      .expect(201);

    const response = await request(app)
      .get(`/api/admin/shows/${show.showId}/seats`)
      .set(authed(admin.token))
      .expect(200);

    expect(response.body.legendCounts).toEqual({ AVAILABLE: 47, HELD: 1, BOOKED: 2 });
  });

  it('lists inactive events and shows for admins only', async () => {
    const event = await request(app)
      .post('/api/events')
      .set(authed(admin.token))
      .send({ title: 'Hidden', category: 'Movie', venue: 'V', isActive: false })
      .expect(201);

    const adminView = await request(app).get('/api/admin/events').set(authed(admin.token)).expect(200);
    expect(adminView.body.events.some((e: { id: string }) => e.id === event.body.event.id)).toBe(true);

    const publicView = await request(app).get('/api/events').expect(200);
    expect(publicView.body.events.some((e: { id: string }) => e.id === event.body.event.id)).toBe(false);
  });
});
