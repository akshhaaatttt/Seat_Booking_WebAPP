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
import { config } from '../src/config/index.js';
import * as holdRepository from '../src/repositories/holdRepository.js';

describe('seat holds', () => {
  let show: TestShow;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    resetDatabase();
    show = createShow();
    alice = await createUser({ name: 'Alice' });
    bob = await createUser({ name: 'Bob' });
  });

  const hold = (user: TestUser, labels: string[]) =>
    request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds(...labels) });

  it('moves AVAILABLE seats to HELD and prices them server-side', async () => {
    const response = await hold(alice, ['A1', 'A2', 'A3']).expect(201);

    expect(response.body.hold.seats.map((s: { label: string }) => s.label)).toEqual(['A1', 'A2', 'A3']);
    // Row A is STANDARD at 1.0x of ₹250 -> ₹750 for three seats.
    expect(response.body.hold.totalAmount).toBe(75000);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
    expect(seatStatus(show.showId, 'A2')).toBe('HELD');
    expect(seatStatus(show.showId, 'A3')).toBe('HELD');
  });

  it('sets the expiry from the server clock, not the request', async () => {
    const before = Date.now();
    const response = await hold(alice, ['A1']).expect(201);
    const { createdAt, expiresAt } = response.body.hold;

    expect(expiresAt - createdAt).toBe(config.holds.durationSeconds * 1000);
    expect(createdAt).toBeGreaterThanOrEqual(before);

    const stored = holdRepository.findActiveHoldForShowSeat(show.seatId('A1'));
    expect(stored?.expires_at).toBe(expiresAt);
  });

  it('prices premium and recliner rows from the seat tier', async () => {
    // C is PREMIUM (1.4x) and E is RECLINER (2.0x) of a ₹250 base.
    const response = await hold(alice, ['C1', 'E1']).expect(201);
    expect(response.body.hold.totalAmount).toBe(35000 + 50000);
  });

  it('refuses a seat that another user already holds', async () => {
    await hold(alice, ['A1']).expect(201);
    const response = await hold(bob, ['A1']).expect(409);
    expect(response.body.error.message).toBe('Seat A1 is no longer available.');
  });

  it('refuses a booked seat', async () => {
    const held = await hold(alice, ['A1']).expect(201);
    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);

    const response = await hold(bob, ['A1']).expect(409);
    expect(response.body.error.message).toBe('Seat A1 is already booked.');
  });

  it('holds all requested seats or none of them', async () => {
    await hold(bob, ['A2']).expect(201);

    const response = await hold(alice, ['A1', 'A2', 'A3']).expect(409);
    expect(response.body.error.message).toBe('Seat A2 is no longer available.');

    // The whole transaction rolled back: nothing was partially held.
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A3')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('HELD');
    expect(holdRepository.countActiveHoldsForUserShow(alice.id, show.showId)).toBe(0);
  });

  it('requires authentication', async () => {
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .send({ showSeatIds: show.seatIds('A1') })
      .expect(401);
  });

  it('validates the request body', async () => {
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: [] })
      .expect(400);
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: ['not-a-uuid'] })
      .expect(400);
  });

  it('rejects seats that belong to a different show', async () => {
    const otherShow = createShow();
    await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: otherShow.seatIds('A1') })
      .expect(404);
  });

  it('enforces the per-user seat limit across requests', async () => {
    await hold(alice, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']).expect(201);
    const response = await hold(alice, ['B1']).expect(409);
    expect(response.body.error.message).toContain('limit is 8');
  });

  it('ignores duplicate seat ids inside one request', async () => {
    const seatId = show.seatId('A1');
    const response = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: [seatId, seatId, seatId] })
      .expect(201);
    expect(response.body.hold.seats).toHaveLength(1);
    expect(response.body.hold.totalAmount).toBe(25000);
  });

  it('releases a hold on request and frees the seats', async () => {
    const held = await hold(alice, ['A1', 'A2']).expect(201);
    await request(app)
      .delete(`/api/holds/${held.body.hold.holdGroupId}`)
      .set(authed(alice.token))
      .expect(200);

    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('AVAILABLE');
    await hold(bob, ['A1']).expect(201);
  });

  it('will not let a user release someone else\'s hold', async () => {
    const held = await hold(alice, ['A1']).expect(201);
    await request(app)
      .delete(`/api/holds/${held.body.hold.holdGroupId}`)
      .set(authed(bob.token))
      .expect(403);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
  });

  it('lets a reconnecting client recover its own live hold', async () => {
    const held = await hold(alice, ['A1', 'A2']).expect(201);

    const mine = await request(app)
      .get(`/api/shows/${show.showId}/my-hold`)
      .set(authed(alice.token))
      .expect(200);
    expect(mine.body.hold.holdGroupId).toBe(held.body.hold.holdGroupId);
    expect(mine.body.hold.expiresAt).toBe(held.body.hold.expiresAt);

    const theirs = await request(app)
      .get(`/api/shows/${show.showId}/my-hold`)
      .set(authed(bob.token))
      .expect(200);
    expect(theirs.body.hold).toBeNull();
  });

  it('marks the holder\'s own seats in the seat map, and only theirs', async () => {
    await hold(alice, ['A1']).expect(201);

    const forAlice = await request(app)
      .get(`/api/shows/${show.showId}/seats`)
      .set(authed(alice.token))
      .expect(200);
    const forBob = await request(app)
      .get(`/api/shows/${show.showId}/seats`)
      .set(authed(bob.token))
      .expect(200);

    const seatOf = (body: { rows: { seats: { label: string; heldByMe: boolean }[] }[] }) =>
      body.rows.flatMap((row) => row.seats).find((seat) => seat.label === 'A1');

    expect(seatOf(forAlice.body)?.heldByMe).toBe(true);
    expect(seatOf(forBob.body)?.heldByMe).toBe(false);
  });

  it('refuses to hold seats for a show that has already started', async () => {
    const pastShow = createShow({ startsInHours: 48 });
    // Move the show into the past directly; the API refuses to schedule one there.
    const { getDb } = await import('../src/db/index.js');
    getDb().prepare('UPDATE shows SET starts_at = ? WHERE id = ?').run(Date.now() - 1000, pastShow.showId);

    const response = await request(app)
      .post(`/api/shows/${pastShow.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: pastShow.seatIds('A1') })
      .expect(409);
    expect(response.body.error.message).toBe('This show has already started.');
  });
});
