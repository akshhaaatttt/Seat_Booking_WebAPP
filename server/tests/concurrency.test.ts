import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
import { getDb } from '../src/db/index.js';
import { newId } from '../src/domain/ids.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(here, 'helpers', 'raceWorker.ts');
const TSX = path.resolve(here, '..', '..', 'node_modules', '.bin', 'tsx');

interface WorkerResult {
  ok: boolean;
  attemptedAt: number;
  status?: number;
  message?: string;
  holdGroupId?: string;
  bookingId?: string;
  alreadyExisted?: boolean;
  seats?: string[];
}

/** Launches N independent processes that all act at the same wall-clock instant. */
async function raceInProcesses(
  jobs: { mode: 'hold' | 'book'; showId: string; userId: string; payload: string }[],
  leadTimeMs = 2500,
): Promise<WorkerResult[]> {
  const dbPath = process.env.DATABASE_PATH!;
  const startAt = Date.now() + leadTimeMs;

  const runs = jobs.map(async (job) => {
    const { stdout } = await execFileAsync(
      TSX,
      [WORKER, dbPath, job.mode, job.showId, job.userId, job.payload, String(startAt)],
      { timeout: 30000 },
    );
    const line = stdout.split('\n').find((l) => l.startsWith('__RESULT__'));
    if (!line) throw new Error(`Worker produced no result. Output was:\n${stdout}`);
    return JSON.parse(line.slice('__RESULT__'.length)) as WorkerResult;
  });

  return Promise.all(runs);
}

/**
 * Guards the guard: if the workers had simply run one after another, the test
 * would pass for the wrong reason. Every worker records the instant it crossed
 * the barrier, and those instants must sit inside a tight window.
 */
function expectGenuineOverlap(results: WorkerResult[], windowMs = 250): void {
  const times = results.map((result) => result.attemptedAt);
  const spread = Math.max(...times) - Math.min(...times);
  expect(spread, `workers started ${spread}ms apart, which is not a real race`).toBeLessThan(windowMs);
}

describe('race conditions', () => {
  let show: TestShow;
  let users: TestUser[];

  beforeEach(async () => {
    resetDatabase();
    show = createShow();
    users = [];
    for (let i = 0; i < 6; i += 1) {
      users.push(await createUser({ name: `Racer ${i}` }));
    }
  });

  it('lets exactly one of many simultaneous HTTP requests hold a seat', async () => {
    const seatId = show.seatId('A1');

    const responses = await Promise.all(
      users.map((user) =>
        request(app)
          .post(`/api/shows/${show.showId}/holds`)
          .set(authed(user.token))
          .send({ showSeatIds: [seatId] }),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(users.length - 1);
    expect(conflicts[0]?.body.error.message).toBe('Seat A1 is no longer available.');
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');

    const activeHolds = getDb()
      .prepare<[string], { total: number }>(
        `SELECT COUNT(*) AS total FROM holds WHERE show_seat_id = ? AND status = 'ACTIVE'`,
      )
      .get(seatId);
    expect(activeHolds?.total).toBe(1);
  });

  it('lets exactly one of six separate OS processes hold the same seat', async () => {
    const seatId = show.seatId('A1');

    const results = await raceInProcesses(
      users.map((user) => ({
        mode: 'hold' as const,
        showId: show.showId,
        userId: user.id,
        payload: seatId,
      })),
    );

    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);

    expectGenuineOverlap(results);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(users.length - 1);
    expect(losers.every((loser) => loser.status === 409)).toBe(true);
    expect(losers.every((loser) => loser.message === 'Seat A1 is no longer available.')).toBe(true);
    expect(seatStatus(show.showId, 'A1')).toBe('HELD');
  }, 60000);

  it('keeps overlapping multi-seat requests all-or-nothing across processes', async () => {
    // Three users want overlapping blocks; each block shares at least one seat
    // with the next, so at most one can succeed... and partial holds must never
    // appear whatever the interleaving.
    const blocks = [
      show.seatIds('B1', 'B2', 'B3'),
      show.seatIds('B3', 'B4', 'B5'),
      show.seatIds('B5', 'B6', 'B1'),
    ];

    const results = await raceInProcesses(
      blocks.map((block, index) => ({
        mode: 'hold' as const,
        showId: show.showId,
        userId: users[index]!.id,
        payload: block.join(','),
      })),
    );

    expectGenuineOverlap(results);
    const winners = results.filter((result) => result.ok);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners.length).toBeLessThanOrEqual(2); // B2/B4/B6 allow at most two disjoint winners

    // Whatever happened, every seat is either fully held by one winner or free:
    // no request left a partial footprint.
    const heldLabels = new Set(winners.flatMap((winner) => winner.seats ?? []));
    for (const label of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
      const expected = heldLabels.has(label) ? 'HELD' : 'AVAILABLE';
      expect(seatStatus(show.showId, label), `seat ${label}`).toBe(expected);
    }

    const activeHolds = getDb()
      .prepare<[], { total: number }>(`SELECT COUNT(*) AS total FROM holds WHERE status = 'ACTIVE'`)
      .get();
    expect(activeHolds?.total).toBe(heldLabels.size);
  }, 60000);

  it('creates only one booking when the same confirmation runs twice at once', async () => {
    const owner = users[0]!;
    const held = await request(app)
      .post(`/api/shows/${show.showId}/holds`)
      .set(authed(owner.token))
      .send({ showSeatIds: show.seatIds('C1', 'C2') })
      .expect(201);
    const groupId = held.body.hold.holdGroupId;

    const results = await raceInProcesses(
      Array.from({ length: 4 }, () => ({
        mode: 'book' as const,
        showId: show.showId,
        userId: owner.id,
        payload: groupId,
      })),
    );

    expectGenuineOverlap(results);
    const succeeded = results.filter((result) => result.ok);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    // Every successful response points at the same booking, and only one row exists.
    const ids = new Set(succeeded.map((result) => result.bookingId));
    expect(ids.size).toBe(1);

    const bookings = getDb()
      .prepare<[], { total: number }>('SELECT COUNT(*) AS total FROM bookings')
      .get();
    expect(bookings?.total).toBe(1);
    expect(seatStatus(show.showId, 'C1')).toBe('BOOKED');
    expect(seatStatus(show.showId, 'C2')).toBe('BOOKED');
  }, 60000);

  it('lets concurrent requests for different seats all succeed', async () => {
    const labels = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

    const responses = await Promise.all(
      users.map((user, index) =>
        request(app)
          .post(`/api/shows/${show.showId}/holds`)
          .set(authed(user.token))
          .send({ showSeatIds: show.seatIds(labels[index]!) }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    for (const label of labels) expect(seatStatus(show.showId, label)).toBe('HELD');
  });

  it('the database itself refuses a second active hold on a seat', async () => {
    const seatId = show.seatId('A1');
    const db = getDb();
    const insert = (userId: string) =>
      db
        .prepare(
          `INSERT INTO holds (id, group_id, user_id, show_id, show_seat_id, status, created_at, expires_at, ended_at)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NULL)`,
        )
        .run(newId(), newId(), userId, show.showId, seatId, Date.now(), Date.now() + 60000);

    insert(users[0]!.id);
    // Bypassing every service and writing straight to the table still fails.
    expect(() => insert(users[1]!.id)).toThrow(/UNIQUE constraint failed/);
  });

  it('the database itself refuses a seat in two active bookings', async () => {
    const seatId = show.seatId('A1');
    const db = getDb();
    const makeBooking = (userId: string): string => {
      const id = `BK-TEST-${newId().slice(0, 6)}`;
      db.prepare(
        `INSERT INTO bookings (id, user_id, show_id, hold_group_id, total_amount, status, created_at, cancelled_at)
         VALUES (?, ?, ?, NULL, 25000, 'CONFIRMED', ?, NULL)`,
      ).run(id, userId, show.showId, Date.now());
      return id;
    };
    const addSeat = (bookingId: string) =>
      db
        .prepare(
          `INSERT INTO booking_seats (id, booking_id, show_seat_id, price, is_active) VALUES (?, ?, ?, 25000, 1)`,
        )
        .run(newId(), bookingId, seatId);

    addSeat(makeBooking(users[0]!.id));
    expect(() => addSeat(makeBooking(users[1]!.id))).toThrow(/UNIQUE constraint failed/);
  });
});
