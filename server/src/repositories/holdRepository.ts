import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { HoldRow, HoldStatus } from '../domain/models.js';

export interface HoldWithSeat extends HoldRow {
  label: string;
  price: number;
}

export function insertHold(
  hold: {
    id: string;
    groupId: string;
    userId: string;
    showId: string;
    showSeatId: string;
    createdAt: number;
    expiresAt: number;
  },
  db: Db = getDb(),
): void {
  db.prepare(
    `INSERT INTO holds (id, group_id, user_id, show_id, show_seat_id, status, created_at, expires_at, ended_at)
     VALUES (@id, @groupId, @userId, @showId, @showSeatId, 'ACTIVE', @createdAt, @expiresAt, NULL)`,
  ).run(hold);
}

const HOLD_WITH_SEAT_SELECT = `
  SELECT h.*, s.label, ss.price
    FROM holds h
    JOIN show_seats ss ON ss.id = h.show_seat_id
    JOIN seats s ON s.id = ss.seat_id
`;

export function findActiveHoldsByGroup(groupId: string, db: Db = getDb()): HoldWithSeat[] {
  return db
    .prepare<[string], HoldWithSeat>(
      `${HOLD_WITH_SEAT_SELECT} WHERE h.group_id = ? AND h.status = 'ACTIVE' ORDER BY s.sort_order ASC`,
    )
    .all(groupId);
}

export function findHoldsByGroup(groupId: string, db: Db = getDb()): HoldWithSeat[] {
  return db
    .prepare<[string], HoldWithSeat>(`${HOLD_WITH_SEAT_SELECT} WHERE h.group_id = ? ORDER BY s.sort_order ASC`)
    .all(groupId);
}

export function findActiveHoldForShowSeat(showSeatId: string, db: Db = getDb()): HoldRow | undefined {
  return db
    .prepare<[string], HoldRow>(
      `SELECT * FROM holds WHERE show_seat_id = ? AND status = 'ACTIVE'`,
    )
    .get(showSeatId);
}

export function findActiveHoldsForUserShow(
  userId: string,
  showId: string,
  db: Db = getDb(),
): HoldWithSeat[] {
  return db
    .prepare<[string, string], HoldWithSeat>(
      `${HOLD_WITH_SEAT_SELECT}
        WHERE h.user_id = ? AND h.show_id = ? AND h.status = 'ACTIVE'
        ORDER BY h.created_at DESC, s.sort_order ASC`,
    )
    .all(userId, showId);
}

export function countActiveHoldsForUserShow(
  userId: string,
  showId: string,
  db: Db = getDb(),
): number {
  const row = db
    .prepare<[string, string], { total: number }>(
      `SELECT COUNT(*) AS total FROM holds WHERE user_id = ? AND show_id = ? AND status = 'ACTIVE'`,
    )
    .get(userId, showId);
  return row?.total ?? 0;
}

export interface ExpiredHoldRow {
  id: string;
  show_id: string;
  show_seat_id: string;
  user_id: string;
  label: string;
}

/**
 * Expired holds are found by comparing the stored `expires_at` against the
 * server clock — never against anything the client sent. `expires_at <= now`
 * makes the boundary inclusive: a hold is dead the instant its deadline is
 * reached.
 */
export function findExpiredActiveHolds(
  now: number,
  scope: { showId?: string; showSeatIds?: readonly string[] } = {},
  db: Db = getDb(),
): ExpiredHoldRow[] {
  const clauses = [`h.status = 'ACTIVE'`, 'h.expires_at <= ?'];
  const params: unknown[] = [now];
  if (scope.showId) {
    clauses.push('h.show_id = ?');
    params.push(scope.showId);
  }
  if (scope.showSeatIds && scope.showSeatIds.length > 0) {
    clauses.push(`h.show_seat_id IN (${scope.showSeatIds.map(() => '?').join(', ')})`);
    params.push(...scope.showSeatIds);
  }
  return db
    .prepare<unknown[], ExpiredHoldRow>(
      `SELECT h.id, h.show_id, h.show_seat_id, h.user_id, s.label
         FROM holds h
         JOIN show_seats ss ON ss.id = h.show_seat_id
         JOIN seats s ON s.id = ss.seat_id
        WHERE ${clauses.join(' AND ')}`,
    )
    .all(...params);
}

/**
 * Conditional close of a hold: only an `ACTIVE` hold can be ended, so two
 * concurrent attempts to expire/release/convert the same hold cannot both
 * succeed.
 */
export function tryCloseHold(
  holdId: string,
  status: Exclude<HoldStatus, 'ACTIVE'>,
  endedAt: number,
  db: Db = getDb(),
): boolean {
  const result = db
    .prepare(`UPDATE holds SET status = ?, ended_at = ? WHERE id = ? AND status = 'ACTIVE'`)
    .run(status, endedAt, holdId);
  return result.changes === 1;
}

export function findHoldById(holdId: string, db: Db = getDb()): HoldRow | undefined {
  return db.prepare<[string], HoldRow>('SELECT * FROM holds WHERE id = ?').get(holdId);
}

export function countActiveHolds(db: Db = getDb()): number {
  const row = db
    .prepare<[], { total: number }>(`SELECT COUNT(*) AS total FROM holds WHERE status = 'ACTIVE'`)
    .get();
  return row?.total ?? 0;
}
