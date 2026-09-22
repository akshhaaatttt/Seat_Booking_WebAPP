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
import { config } from '../src/config/index.js';
import { getDb } from '../src/db/index.js';
import * as holdRepository from '../src/repositories/holdRepository.js';
import { createHoldExpirationScheduler } from '../src/scheduler/index.js';
import { sweepExpiredHolds } from '../src/services/holdExpirationService.js';

const HOLD_MS = config.holds.durationSeconds * 1000;

describe('hold expiration', () => {
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

  /** Only Date is faked: bcrypt and supertest keep using real timers. */
  const travelTo = (timestamp: number) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(timestamp);
  };

  const hold = (user: TestUser, labels: string[]) =>
    request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(user.token))
      .send({ showSeatIds: show.seatIds(...labels) });

  it('leaves an active hold alone', async () => {
    const held = await hold(alice, ['A1']).expect(201);

    travelTo(held.body.hold.expiresAt - 1000);
    expect(sweepExpiredHolds()).toBe(0);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
  });

  it('treats the expiry instant itself as expired', async () => {
    const held = await hold(alice, ['A1']).expect(201);
    const { expiresAt } = held.body.hold;

    // One millisecond before the deadline the hold is still live...
    travelTo(expiresAt - 1);
    expect(sweepExpiredHolds()).toBe(0);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');

    // ...and exactly at the deadline it is gone.
    travelTo(expiresAt);
    expect(sweepExpiredHolds()).toBe(1);
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
  });

  it('releases an expired hold and marks the hold row EXPIRED', async () => {
    await hold(alice, ['A1', 'A2']).expect(201);

    travelTo(Date.now() + HOLD_MS + 1);
    expect(sweepExpiredHolds()).toBe(2);

    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('AVAILABLE');
    expect(holdRepository.countActiveHolds()).toBe(0);
    const rows = getDb()
      .prepare<[], { status: string; ended_at: number | null }>('SELECT status, ended_at FROM holds')
      .all();
    expect(rows.every((row) => row.status === 'EXPIRED' && row.ended_at !== null)).toBe(true);
  });

  it('frees the seat for another user once the hold expires', async () => {
    await hold(alice, ['A1']).expect(201);
    await hold(bob, ['A1']).expect(409);

    travelTo(Date.now() + HOLD_MS + 1);

    // No sweep has run: expiry is still enforced on the request path itself.
    await hold(bob, ['A1']).expect(201);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
  });

  it('rejects booking an expired hold even before the sweeper runs', async () => {
    const held = await hold(alice, ['A1']).expect(201);

    travelTo(held.body.hold.expiresAt + 1);

    const response = await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(409);

    expect(response.body.error.message).toContain('expired');
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
  });

  it('rejects booking a hold that expires at exactly the booking instant', async () => {
    const held = await hold(alice, ['A1']).expect(201);

    travelTo(held.body.hold.expiresAt);

    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(409);
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
  });

  it('hides an expired hold from the seat map without waiting for the sweeper', async () => {
    await hold(alice, ['A1']).expect(201);
    travelTo(Date.now() + HOLD_MS + 1);

    const response = await request(app).get(`/api/shows/${show.showId}/seats`).expect(200);
    const seat = response.body.rows
      .flatMap((row: { seats: { label: string; status: string }[] }) => row.seats)
      .find((s: { label: string }) => s.label === 'A1');

    expect(seat.status).toBe('AVAILABLE');
    expect(response.body.legendCounts.HELD).toBe(0);
  });

  it('releases many simultaneously expiring holds in one sweep', async () => {
    await hold(alice, ['A1', 'A2', 'A3']).expect(201);
    await hold(bob, ['B1', 'B2']).expect(201);

    travelTo(Date.now() + HOLD_MS + 1);
    expect(sweepExpiredHolds()).toBe(5);
    expect(holdRepository.countActiveHolds()).toBe(0);
    for (const label of ['A1', 'A2', 'A3', 'B1', 'B2']) {
      expect(seatStatus(show.showId, label)).toBe('AVAILABLE');
    }
  });

  it('does not touch holds belonging to other shows when scoped', async () => {
    const otherShow = createShow();
    await hold(alice, ['A1']).expect(201);
    await request(app)
      .post(`/api/shows/${otherShow.showId}/holds`)
      .set(authed(alice.token))
      .send({ showSeatIds: otherShow.seatIds('A1') })
      .expect(201);

    travelTo(Date.now() + HOLD_MS + 1);
    expect(sweepExpiredHolds(Date.now(), { showId: show.showId })).toBe(1);

    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(otherShow.showId, 'A1')).toBe('HELD');
  });

  it('never releases a seat that was already booked', async () => {
    const held = await hold(alice, ['A1']).expect(201);
    await request(app)
      .post(`/api/shows/${show.showId}/book`)
      .set(authed(alice.token))
      .send({ holdGroupId: held.body.hold.holdGroupId })
      .expect(201);

    travelTo(Date.now() + HOLD_MS + 1);
    expect(sweepExpiredHolds()).toBe(0);
    expect(seatStatus(show.showId, 'A1')).toBe('BOOKED');
  });

  it('the scheduler triggers the service and survives repeated runs', async () => {
    await hold(alice, ['A1']).expect(201);
    const scheduler = createHoldExpirationScheduler(1);

    expect(scheduler.runOnce()).toBe(0);

    travelTo(Date.now() + HOLD_MS + 1);
    expect(scheduler.runOnce()).toBe(1);
    // A second sweep finds nothing left to do.
    expect(scheduler.runOnce()).toBe(0);
    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
  });

  it('cleans up holds that expired while the server was down, on the first sweep', async () => {
    await hold(alice, ['A1', 'A2']).expect(201);

    // Simulate downtime: nothing ran while the clock moved well past the deadline.
    travelTo(Date.now() + HOLD_MS * 10);

    const scheduler = createHoldExpirationScheduler();
    scheduler.start(); // starting sweeps immediately
    scheduler.stop();

    expect(seatStatus(show.showId, 'A1')).toBe('AVAILABLE');
    expect(seatStatus(show.showId, 'A2')).toBe('AVAILABLE');
    expect(holdRepository.countActiveHolds()).toBe(0);
  });
});
