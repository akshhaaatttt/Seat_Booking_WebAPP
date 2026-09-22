import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { SeatRow, ShowDto, ShowRow } from '../domain/models.js';

export interface ShowStatsRow extends ShowRow {
  event_title: string;
  total_seats: number;
  available_seats: number;
  held_seats: number;
  booked_seats: number;
}

export function toShowDto(row: ShowStatsRow): ShowDto {
  return {
    id: row.id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    startsAt: row.starts_at,
    screen: row.screen,
    basePrice: row.base_price,
    isActive: row.is_active === 1,
    totalSeats: row.total_seats,
    availableSeats: row.available_seats,
    heldSeats: row.held_seats,
    bookedSeats: row.booked_seats,
  };
}

const SHOW_STATS_SELECT = `
  SELECT sh.*,
         e.title AS event_title,
         COUNT(ss.id) AS total_seats,
         COALESCE(SUM(ss.status = 'AVAILABLE'), 0) AS available_seats,
         COALESCE(SUM(ss.status = 'HELD'), 0) AS held_seats,
         COALESCE(SUM(ss.status = 'BOOKED'), 0) AS booked_seats
    FROM shows sh
    JOIN events e ON e.id = sh.event_id
    LEFT JOIN show_seats ss ON ss.show_id = sh.id
`;

export function listShowsForEvent(
  eventId: string,
  options: { includeInactive: boolean },
  db: Db = getDb(),
): ShowStatsRow[] {
  const filter = options.includeInactive ? '' : 'AND sh.is_active = 1';
  return db
    .prepare<[string], ShowStatsRow>(
      `${SHOW_STATS_SELECT} WHERE sh.event_id = ? ${filter} GROUP BY sh.id ORDER BY sh.starts_at ASC`,
    )
    .all(eventId);
}

export function listAllShows(options: { includeInactive: boolean }, db: Db = getDb()): ShowStatsRow[] {
  const filter = options.includeInactive ? '' : 'WHERE sh.is_active = 1';
  return db
    .prepare<[], ShowStatsRow>(
      `${SHOW_STATS_SELECT} ${filter} GROUP BY sh.id ORDER BY sh.starts_at ASC`,
    )
    .all();
}

export function findShowWithStats(id: string, db: Db = getDb()): ShowStatsRow | undefined {
  return db
    .prepare<[string], ShowStatsRow>(`${SHOW_STATS_SELECT} WHERE sh.id = ? GROUP BY sh.id`)
    .get(id);
}

export function findShowById(id: string, db: Db = getDb()): ShowRow | undefined {
  return db.prepare<[string], ShowRow>('SELECT * FROM shows WHERE id = ?').get(id);
}

export function insertShow(
  show: {
    id: string;
    eventId: string;
    startsAt: number;
    screen: string;
    layoutKey: string;
    basePrice: number;
    isActive: number;
    createdAt: number;
  },
  db: Db = getDb(),
): ShowRow {
  db.prepare(
    `INSERT INTO shows (id, event_id, starts_at, screen, layout_key, base_price, is_active, created_at, updated_at)
     VALUES (@id, @eventId, @startsAt, @screen, @layoutKey, @basePrice, @isActive, @createdAt, @createdAt)`,
  ).run(show);
  return findShowById(show.id, db)!;
}

export function updateShow(
  id: string,
  patch: Partial<{ startsAt: number; screen: string; basePrice: number; isActive: number }>,
  updatedAt: number,
  db: Db = getDb(),
): ShowRow | undefined {
  const columns: Record<string, string> = {
    startsAt: 'starts_at',
    screen: 'screen',
    basePrice: 'base_price',
    isActive: 'is_active',
  };
  const assignments: string[] = [];
  const params: Record<string, unknown> = { id, updatedAt };
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      assignments.push(`${column} = @${key}`);
      params[key] = value;
    }
  }
  if (assignments.length > 0) {
    db.prepare(`UPDATE shows SET ${assignments.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(
      params,
    );
  }
  return findShowById(id, db);
}

export function deactivateShow(id: string, updatedAt: number, db: Db = getDb()): number {
  return db
    .prepare('UPDATE shows SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1')
    .run(updatedAt, id).changes;
}

export function countConfirmedBookingsForShow(id: string, db: Db = getDb()): number {
  const row = db
    .prepare<[string], { total: number }>(
      `SELECT COUNT(*) AS total FROM bookings WHERE show_id = ? AND status = 'CONFIRMED'`,
    )
    .get(id);
  return row?.total ?? 0;
}

export function hardDeleteShow(id: string, db: Db = getDb()): number {
  return db.prepare('DELETE FROM shows WHERE id = ?').run(id).changes;
}

export function listSeatsForLayout(layoutKey: string, db: Db = getDb()): SeatRow[] {
  return db
    .prepare<[string], SeatRow>('SELECT * FROM seats WHERE layout_key = ? ORDER BY sort_order ASC')
    .all(layoutKey);
}

export function listLayoutKeys(db: Db = getDb()): { layoutKey: string; seatCount: number }[] {
  return db
    .prepare<[], { layoutKey: string; seatCount: number }>(
      'SELECT layout_key AS layoutKey, COUNT(*) AS seatCount FROM seats GROUP BY layout_key ORDER BY layout_key',
    )
    .all();
}
