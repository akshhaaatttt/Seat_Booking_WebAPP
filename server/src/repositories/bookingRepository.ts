import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { BookingDto, BookingRow, BookingStatus } from '../domain/models.js';

export interface BookingDetailRow extends BookingRow {
  hold_group_id: string | null;
  event_id: string;
  event_title: string;
  venue: string;
  screen: string;
  show_starts_at: number;
  user_name: string;
  user_email: string;
}

export interface BookingSeatDetailRow {
  booking_id: string;
  show_seat_id: string;
  label: string;
  price: number;
}

const BOOKING_SELECT = `
  SELECT b.*,
         sh.event_id,
         e.title AS event_title,
         e.venue,
         sh.screen,
         sh.starts_at AS show_starts_at,
         u.name AS user_name,
         u.email AS user_email
    FROM bookings b
    JOIN shows sh ON sh.id = b.show_id
    JOIN events e ON e.id = sh.event_id
    JOIN users u ON u.id = b.user_id
`;

export function insertBooking(
  booking: {
    id: string;
    userId: string;
    showId: string;
    holdGroupId: string | null;
    totalAmount: number;
    createdAt: number;
  },
  db: Db = getDb(),
): void {
  db.prepare(
    `INSERT INTO bookings (id, user_id, show_id, hold_group_id, total_amount, status, created_at, cancelled_at)
     VALUES (@id, @userId, @showId, @holdGroupId, @totalAmount, 'CONFIRMED', @createdAt, NULL)`,
  ).run(booking);
}

/** Used to make a replayed booking request idempotent instead of a 409. */
export function findBookingByHoldGroup(
  holdGroupId: string,
  db: Db = getDb(),
): BookingDetailRow | undefined {
  return db
    .prepare<[string], BookingDetailRow>(`${BOOKING_SELECT} WHERE b.hold_group_id = ?`)
    .get(holdGroupId);
}

export function insertBookingSeats(
  rows: { id: string; bookingId: string; showSeatId: string; price: number }[],
  db: Db = getDb(),
): void {
  const stmt = db.prepare(
    `INSERT INTO booking_seats (id, booking_id, show_seat_id, price, is_active)
     VALUES (@id, @bookingId, @showSeatId, @price, 1)`,
  );
  for (const row of rows) stmt.run(row);
}

export function findBookingById(id: string, db: Db = getDb()): BookingDetailRow | undefined {
  return db.prepare<[string], BookingDetailRow>(`${BOOKING_SELECT} WHERE b.id = ?`).get(id);
}

export function listBookingsForUser(userId: string, db: Db = getDb()): BookingDetailRow[] {
  return db
    .prepare<[string], BookingDetailRow>(
      `${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    )
    .all(userId);
}

export interface AdminBookingFilters {
  search?: string;
  status?: BookingStatus;
  showId?: string;
  limit: number;
  offset: number;
}

export function listAllBookings(
  filters: AdminBookingFilters,
  db: Db = getDb(),
): { rows: BookingDetailRow[]; total: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.showId) {
    clauses.push('b.show_id = ?');
    params.push(filters.showId);
  }
  if (filters.search) {
    clauses.push('(b.id LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR e.title LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const totalRow = db
    .prepare<unknown[], { total: number }>(
      `SELECT COUNT(*) AS total
         FROM bookings b
         JOIN shows sh ON sh.id = b.show_id
         JOIN events e ON e.id = sh.event_id
         JOIN users u ON u.id = b.user_id
         ${where}`,
    )
    .get(...params);

  const rows = db
    .prepare<unknown[], BookingDetailRow>(
      `${BOOKING_SELECT} ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit, filters.offset);

  return { rows, total: totalRow?.total ?? 0 };
}

export function listBookingSeats(
  bookingIds: readonly string[],
  db: Db = getDb(),
): BookingSeatDetailRow[] {
  if (bookingIds.length === 0) return [];
  const placeholders = bookingIds.map(() => '?').join(', ');
  return db
    .prepare<string[], BookingSeatDetailRow>(
      `SELECT bs.booking_id, bs.show_seat_id, bs.price, s.label
         FROM booking_seats bs
         JOIN show_seats ss ON ss.id = bs.show_seat_id
         JOIN seats s ON s.id = ss.seat_id
        WHERE bs.booking_id IN (${placeholders})
        ORDER BY s.sort_order ASC`,
    )
    .all(...bookingIds);
}

/** Conditional cancel: only a CONFIRMED booking can move to CANCELLED. */
export function tryCancelBooking(id: string, cancelledAt: number, db: Db = getDb()): boolean {
  const result = db
    .prepare(
      `UPDATE bookings SET status = 'CANCELLED', cancelled_at = ? WHERE id = ? AND status = 'CONFIRMED'`,
    )
    .run(cancelledAt, id);
  return result.changes === 1;
}

export function deactivateBookingSeats(bookingId: string, db: Db = getDb()): number {
  return db.prepare('UPDATE booking_seats SET is_active = 0 WHERE booking_id = ?').run(bookingId)
    .changes;
}

export function toBookingDto(
  row: BookingDetailRow,
  seats: BookingSeatDetailRow[],
  options: { cancellable: boolean; includeUser: boolean },
): BookingDto {
  const dto: BookingDto = {
    id: row.id,
    userId: row.user_id,
    showId: row.show_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    venue: row.venue,
    screen: row.screen,
    showStartsAt: row.show_starts_at,
    seats: seats.map((seat) => ({
      showSeatId: seat.show_seat_id,
      label: seat.label,
      price: seat.price,
    })),
    totalAmount: row.total_amount,
    status: row.status,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
    cancellable: options.cancellable,
  };
  if (options.includeUser) {
    dto.userName = row.user_name;
    dto.userEmail = row.user_email;
  }
  return dto;
}

export function activeBookingSeatIds(bookingId: string, db: Db = getDb()): string[] {
  return db
    .prepare<[string], { show_seat_id: string }>(
      'SELECT show_seat_id FROM booking_seats WHERE booking_id = ? AND is_active = 1',
    )
    .all(bookingId)
    .map((row) => row.show_seat_id);
}
