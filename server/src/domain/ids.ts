import { randomBytes, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

const BOOKING_SUFFIX_BYTES = 3; // -> 6 uppercase hex characters

/**
 * Human-readable booking reference, e.g. `BK-20260922-8F42A1`.
 * The date segment is the booking's creation date; the random suffix makes the
 * reference unguessable. Uniqueness is guaranteed by the primary key, and the
 * booking service retries on the (astronomically unlikely) collision.
 */
export function newBookingId(createdAt: Date = new Date()): string {
  const y = createdAt.getFullYear().toString().padStart(4, '0');
  const m = (createdAt.getMonth() + 1).toString().padStart(2, '0');
  const d = createdAt.getDate().toString().padStart(2, '0');
  const suffix = randomBytes(BOOKING_SUFFIX_BYTES).toString('hex').toUpperCase();
  return `BK-${y}${m}${d}-${suffix}`;
}
