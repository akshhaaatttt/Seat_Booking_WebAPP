import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { config } from '../../src/config/index.js';
import { getDb } from '../../src/db/index.js';
import { migrate } from '../../src/db/migrate.js';
import { newId } from '../../src/domain/ids.js';
import type { UserRole } from '../../src/domain/models.js';
import * as seatRepository from '../../src/repositories/seatRepository.js';
import * as userRepository from '../../src/repositories/userRepository.js';
import * as eventService from '../../src/services/eventService.js';
import * as showService from '../../src/services/showService.js';

export const app: Express = createApp();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Fresh transactional state before every test; the seat catalogue is kept. */
export function resetDatabase(): void {
  migrate();
  const db = getDb();
  db.transaction(() => {
    for (const table of ['booking_seats', 'bookings', 'holds', 'show_seats', 'shows', 'events', 'users']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  })();
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  token: string;
}

export async function createUser(
  overrides: { email?: string; name?: string; role?: UserRole } = {},
): Promise<TestUser> {
  const email = overrides.email ?? `user-${newId()}@example.com`;
  const row = userRepository.insertUser({
    id: newId(),
    email,
    passwordHash: await bcrypt.hash('Passw0rd!', config.security.bcryptRounds),
    name: overrides.name ?? 'Test User',
    role: overrides.role ?? 'USER',
    createdAt: Date.now(),
  });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'Passw0rd!' })
    .expect(200);

  return { id: row.id, email, name: row.name, role: row.role, token: login.body.token };
}

export interface TestShow {
  eventId: string;
  showId: string;
  /** Resolves a seat label such as 'A1' to its show_seats id. */
  seatId(label: string): string;
  seatIds(...labels: string[]): string[];
}

export function createShow(
  options: { startsInHours?: number; basePrice?: number; layoutKey?: string } = {},
): TestShow {
  const event = eventService.createEvent({
    title: 'Avengers: Secret Wars',
    description: 'Test event',
    category: 'Movie',
    venue: 'Test Venue',
  });
  const show = showService.createShow({
    eventId: event.id,
    startsAt: Date.now() + (options.startsInHours ?? 48) * HOUR,
    screen: 'Screen 1',
    layoutKey: options.layoutKey ?? 'cinema-50',
    basePrice: options.basePrice ?? 25000, // ₹250 in paise
  });

  const seatId = (label: string): string => {
    const found = seatRepository.findShowSeatsByLabels(show.id, [label])[0];
    if (!found) throw new Error(`Seat ${label} not found for show ${show.id}`);
    return found.id;
  };

  return {
    eventId: event.id,
    showId: show.id,
    seatId,
    seatIds: (...labels: string[]) => labels.map(seatId),
  };
}

export function authed(token: string) {
  return { Authorization: `Bearer ${token}` } as const;
}

export function seatStatus(showId: string, label: string): string {
  const seat = seatRepository.findShowSeatsByLabels(showId, [label])[0];
  if (!seat) throw new Error(`Seat ${label} not found`);
  return seat.status;
}

/**
 * Simulates the passage of time by moving a hold's deadline into the past.
 *
 * Expiry in production is decided by comparing the server clock against the
 * stored `expires_at`, so rewriting that column exercises exactly the real code
 * path — no clock mocking, no special-cased test branch.
 */
export function setHoldExpiry(groupId: string, expiresAt: number): void {
  getDb().prepare('UPDATE holds SET expires_at = ? WHERE group_id = ?').run(expiresAt, groupId);
}

export function holdStatus(groupId: string): string[] {
  return getDb()
    .prepare<[string], { status: string }>('SELECT status FROM holds WHERE group_id = ?')
    .all(groupId)
    .map((row) => row.status);
}

export function bookingStatus(bookingId: string): string | undefined {
  return getDb()
    .prepare<[string], { status: string }>('SELECT status FROM bookings WHERE id = ?')
    .get(bookingId)?.status;
}
