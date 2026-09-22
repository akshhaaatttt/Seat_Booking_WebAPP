import { conflict } from './errors.js';

export const SEAT_STATUSES = ['AVAILABLE', 'HELD', 'BOOKED'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

/**
 * The reason a seat moved, which doubles as the set of transitions the domain
 * recognises. Anything not listed here is not a legal move.
 */
export const SEAT_TRANSITIONS = ['HOLD', 'BOOK', 'EXPIRE', 'RELEASE', 'CANCEL'] as const;
export type SeatTransition = (typeof SEAT_TRANSITIONS)[number];

/**
 *            HOLD                 BOOK
 *  AVAILABLE ────▶ HELD ─────────▶ BOOKED
 *      ▲            │                 │
 *      │ EXPIRE /   │                 │ CANCEL
 *      └─ RELEASE ──┘                 │
 *      └──────────────────────────────┘
 *
 * Deliberately absent, and therefore rejected:
 *   AVAILABLE → BOOKED  (a booking must always pass through a hold)
 *   BOOKED    → HELD    (a sold seat cannot be re-held)
 *   BOOKED    → BOOKED  (double booking)
 *   HELD      → HELD    (a second user cannot take over an active hold)
 */
const TRANSITIONS: Record<SeatTransition, { from: SeatStatus; to: SeatStatus }> = {
  HOLD: { from: 'AVAILABLE', to: 'HELD' },
  BOOK: { from: 'HELD', to: 'BOOKED' },
  EXPIRE: { from: 'HELD', to: 'AVAILABLE' },
  RELEASE: { from: 'HELD', to: 'AVAILABLE' },
  CANCEL: { from: 'BOOKED', to: 'AVAILABLE' },
};

export function requiredStatusFor(transition: SeatTransition): SeatStatus {
  return TRANSITIONS[transition].from;
}

export function resultingStatusFor(transition: SeatTransition): SeatStatus {
  return TRANSITIONS[transition].to;
}

export function canTransition(from: SeatStatus, transition: SeatTransition): boolean {
  return TRANSITIONS[transition].from === from;
}

/**
 * Pure guard used by the services before they touch the database. The database
 * re-checks the same condition inside the conditional UPDATE — this function
 * exists to produce a precise error message, not to be the safety net.
 */
export function assertTransition(
  seatLabel: string,
  from: SeatStatus,
  transition: SeatTransition,
): void {
  if (canTransition(from, transition)) return;
  throw conflict(describeIllegalTransition(seatLabel, from, transition), {
    seatLabel,
    from,
    transition,
  });
}

export function describeIllegalTransition(
  seatLabel: string,
  from: SeatStatus,
  transition: SeatTransition,
): string {
  const to = resultingStatusFor(transition);
  switch (from) {
    case 'BOOKED':
      return `Seat ${seatLabel} is already booked.`;
    case 'HELD':
      return transition === 'HOLD'
        ? `Seat ${seatLabel} is no longer available.`
        : `Seat ${seatLabel} is held and cannot be ${to.toLowerCase()} yet.`;
    case 'AVAILABLE':
      return transition === 'BOOK'
        ? `Seat ${seatLabel} must be held before it can be booked.`
        : `Seat ${seatLabel} is available and cannot be ${to.toLowerCase()}.`;
    default:
      return `Seat ${seatLabel} cannot move from ${from} to ${to}.`;
  }
}
