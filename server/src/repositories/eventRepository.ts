import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { EventDto, EventRow } from '../domain/models.js';

export interface EventListRow extends EventRow {
  show_count: number;
  next_show_at: number | null;
}

export function toEventDto(row: EventRow | EventListRow): EventDto {
  const dto: EventDto = {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    venue: row.venue,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if ('show_count' in row) {
    dto.showCount = row.show_count;
    dto.nextShowAt = row.next_show_at;
  }
  return dto;
}

/**
 * `includeInactive` is only ever true for admin callers; the public listing
 * also hides shows that have already started when computing the next showtime.
 */
export function listEvents(
  options: { includeInactive: boolean; now: number },
  db: Db = getDb(),
): EventListRow[] {
  const showIsSelectable = options.includeInactive
    ? 's.id IS NOT NULL'
    : 's.is_active = 1 AND s.starts_at > @now';
  const eventFilter = options.includeInactive ? '1 = 1' : 'e.is_active = 1';

  return db
    .prepare<{ now: number }, EventListRow>(
      `SELECT e.*,
              COUNT(s.id) AS show_count,
              MIN(s.starts_at) AS next_show_at
         FROM events e
         LEFT JOIN shows s ON s.event_id = e.id AND (${showIsSelectable})
        WHERE ${eventFilter}
        GROUP BY e.id
        ORDER BY e.is_active DESC,
                 next_show_at IS NULL,
                 next_show_at ASC,
                 e.created_at DESC`,
    )
    .all({ now: options.now });
}

export function findEventById(id: string, db: Db = getDb()): EventRow | undefined {
  return db.prepare<[string], EventRow>('SELECT * FROM events WHERE id = ?').get(id);
}

export function insertEvent(
  event: {
    id: string;
    title: string;
    description: string;
    category: string;
    venue: string;
    isActive: number;
    createdAt: number;
  },
  db: Db = getDb(),
): EventRow {
  db.prepare(
    `INSERT INTO events (id, title, description, category, venue, is_active, created_at, updated_at)
     VALUES (@id, @title, @description, @category, @venue, @isActive, @createdAt, @createdAt)`,
  ).run(event);
  return findEventById(event.id, db)!;
}

export function updateEvent(
  id: string,
  patch: Partial<{ title: string; description: string; category: string; venue: string; isActive: number }>,
  updatedAt: number,
  db: Db = getDb(),
): EventRow | undefined {
  const columns: Record<string, string> = {
    title: 'title',
    description: 'description',
    category: 'category',
    venue: 'venue',
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
    db.prepare(
      `UPDATE events SET ${assignments.join(', ')}, updated_at = @updatedAt WHERE id = @id`,
    ).run(params);
  }
  return findEventById(id, db);
}

export function deactivateEvent(id: string, updatedAt: number, db: Db = getDb()): number {
  const result = db
    .prepare('UPDATE events SET is_active = 0, updated_at = ? WHERE id = ? AND is_active = 1')
    .run(updatedAt, id);
  db.prepare('UPDATE shows SET is_active = 0, updated_at = ? WHERE event_id = ?').run(updatedAt, id);
  return result.changes;
}

export function countConfirmedBookingsForEvent(id: string, db: Db = getDb()): number {
  const row = db
    .prepare<[string], { total: number }>(
      `SELECT COUNT(*) AS total
         FROM bookings b JOIN shows s ON s.id = b.show_id
        WHERE s.event_id = ? AND b.status = 'CONFIRMED'`,
    )
    .get(id);
  return row?.total ?? 0;
}

export function hardDeleteEvent(id: string, db: Db = getDb()): number {
  return db.prepare('DELETE FROM events WHERE id = ?').run(id).changes;
}
