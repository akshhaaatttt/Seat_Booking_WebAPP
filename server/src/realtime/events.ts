import type { SeatStatus } from '../domain/seatState.js';

export const SEAT_CHANGE_REASONS = ['HELD', 'RELEASED', 'EXPIRED', 'BOOKED', 'CANCELLED'] as const;
export type SeatChangeReason = (typeof SEAT_CHANGE_REASONS)[number];

export interface SeatStatusChangedEvent {
  type: 'SEAT_STATUS_CHANGED';
  showId: string;
  showSeatId: string;
  seatId: string;
  label: string;
  status: SeatStatus;
  reason: SeatChangeReason;
  /** Present only while the seat is HELD, so other tabs of the same user can recognise their own hold. */
  holdUserId: string | null;
  holdExpiresAt: number | null;
  at: number;
}

export interface ConnectedEvent {
  type: 'CONNECTED';
  showId: string | null;
  at: number;
}

export type RealtimeEvent = SeatStatusChangedEvent | ConnectedEvent;
