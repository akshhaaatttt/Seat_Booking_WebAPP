import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { SeatTier, ShowSeatRow } from '../domain/models.js';
import type { SeatStatus, SeatTransition } from '../domain/seatState.js';
import { requiredStatusFor, resultingStatusFor } from '../domain/seatState.js';

export interface SeatMapRow {
  show_seat_id: string;
  seat_id: string;
  status: SeatStatus;
  price: number;
  label: string;
  row_label: string;
  seat_number: number;
  tier: SeatTier;
  sort_order: number;
  hold_user_id: string | null;
  hold_expires_at: number | null;
}

export function insertShowSeats(
  rows: { id: string; showId: string; seatId: string; price: number; updatedAt: number }[],
  db: Db = getDb(),
): void {
  const stmt = db.prepare(
    `INSERT INTO show_seats (id, show_id, seat_id, status, price, updated_at)
     VALUES (@id, @showId, @seatId, 'AVAILABLE', @price, @updatedAt)`,
  );
  for (const row of rows) stmt.run(row);
}

export function listSeatMap(showId: string, db: Db = getDb()): SeatMapRow[] {
  return db
    .prepare<[string], SeatMapRow>(
      `SELECT ss.id AS show_seat_id,
              ss.seat_id,
              ss.status,
              ss.price,
              s.label,
              s.row_label,
              s.seat_number,
              s.tier,
              s.sort_order,
              h.user_id AS hold_user_id,
              h.expires_at AS hold_expires_at
         FROM show_seats ss
         JOIN seats s ON s.id = ss.seat_id
         LEFT JOIN holds h ON h.show_seat_id = ss.id AND h.status = 'ACTIVE'
        WHERE ss.show_id = ?
        ORDER BY s.sort_order ASC`,
    )
    .all(showId);
}

export interface ShowSeatWithLabel extends ShowSeatRow {
  label: string;
}

export function findShowSeatsByIds(
  showId: string,
  showSeatIds: readonly string[],
  db: Db = getDb(),
): ShowSeatWithLabel[] {
  if (showSeatIds.length === 0) return [];
  const placeholders = showSeatIds.map(() => '?').join(', ');
  return db
    .prepare<string[], ShowSeatWithLabel>(
      `SELECT ss.*, s.label
         FROM show_seats ss
         JOIN seats s ON s.id = ss.seat_id
        WHERE ss.show_id = ? AND ss.id IN (${placeholders})
        ORDER BY s.sort_order ASC`,
    )
    .all(showId, ...showSeatIds);
}

export function findShowSeatsByLabels(
  showId: string,
  labels: readonly string[],
  db: Db = getDb(),
): ShowSeatWithLabel[] {
  if (labels.length === 0) return [];
  const placeholders = labels.map(() => '?').join(', ');
  return db
    .prepare<string[], ShowSeatWithLabel>(
      `SELECT ss.*, s.label
         FROM show_seats ss
         JOIN seats s ON s.id = ss.seat_id
        WHERE ss.show_id = ? AND s.label IN (${placeholders})
        ORDER BY s.sort_order ASC`,
    )
    .all(showId, ...labels);
}

/**
 * The single place where a seat's status changes.
 *
 * This is a *conditional* update: the `status = @from` predicate means the row
 * is only written if the seat is still in the state the caller observed. The
 * driver reports `changes === 0` when the predicate failed, which is exactly
 * the "someone else got there first" signal the services turn into a 409.
 *
 * Callers must already be inside a `BEGIN IMMEDIATE` transaction so that the
 * read that decided to attempt the transition and this write cannot be
 * interleaved by another writer.
 */
export function tryTransition(
  showSeatId: string,
  transition: SeatTransition,
  now: number,
  db: Db = getDb(),
): boolean {
  const result = db
    .prepare<{ id: string; from: SeatStatus; to: SeatStatus; now: number }>(
      `UPDATE show_seats
          SET status = @to, updated_at = @now
        WHERE id = @id AND status = @from`,
    )
    .run({
      id: showSeatId,
      from: requiredStatusFor(transition),
      to: resultingStatusFor(transition),
      now,
    });
  return result.changes === 1;
}

export function countsByStatus(showId: string, db: Db = getDb()): Record<SeatStatus, number> {
  const rows = db
    .prepare<[string], { status: SeatStatus; total: number }>(
      'SELECT status, COUNT(*) AS total FROM show_seats WHERE show_id = ? GROUP BY status',
    )
    .all(showId);
  const counts: Record<SeatStatus, number> = { AVAILABLE: 0, HELD: 0, BOOKED: 0 };
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

export function labelsForShowSeats(
  showSeatIds: readonly string[],
  db: Db = getDb(),
): Map<string, string> {
  if (showSeatIds.length === 0) return new Map();
  const placeholders = showSeatIds.map(() => '?').join(', ');
  const rows = db
    .prepare<string[], { id: string; label: string }>(
      `SELECT ss.id, s.label FROM show_seats ss JOIN seats s ON s.id = ss.seat_id WHERE ss.id IN (${placeholders})`,
    )
    .all(...showSeatIds);
  return new Map(rows.map((row) => [row.id, row.label]));
}

/**
 * Re-prices a show's inventory. Only called when a show has no held or booked
 * seats, so no existing booking can end up disagreeing with its seats.
 */
export function repriceShowSeats(
  showId: string,
  prices: readonly { seatId: string; price: number }[],
  now: number,
  db: Db = getDb(),
): void {
  const stmt = db.prepare(
    'UPDATE show_seats SET price = ?, updated_at = ? WHERE show_id = ? AND seat_id = ?',
  );
  for (const entry of prices) stmt.run(entry.price, now, showId, entry.seatId);
}
