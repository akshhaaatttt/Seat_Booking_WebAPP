export type UserRole = 'USER' | 'ADMIN';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED';
export type SeatTier = 'STANDARD' | 'PREMIUM' | 'RECLINER';
export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: number;
}

export interface EventSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  showCount?: number;
  nextShowAt?: number | null;
}

export interface Show {
  id: string;
  eventId: string;
  eventTitle: string;
  startsAt: number;
  screen: string;
  basePrice: number;
  isActive: boolean;
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
}

export interface Seat {
  showSeatId: string;
  seatId: string;
  label: string;
  rowLabel: string;
  seatNumber: number;
  tier: SeatTier;
  status: SeatStatus;
  price: number;
  heldByMe: boolean;
  holdExpiresAt: number | null;
}

export interface SeatRow {
  rowLabel: string;
  seats: Seat[];
}

export interface SeatMap {
  show: Show;
  rows: SeatRow[];
  legendCounts: Record<SeatStatus, number>;
  serverTime: number;
}

export interface Hold {
  holdGroupId: string;
  showId: string;
  userId: string;
  seats: { showSeatId: string; label: string; price: number }[];
  totalAmount: number;
  createdAt: number;
  expiresAt: number;
  serverTime: number;
}

export interface Booking {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  showId: string;
  eventId: string;
  eventTitle: string;
  venue: string;
  screen: string;
  showStartsAt: number;
  seats: { showSeatId: string; label: string; price: number }[];
  totalAmount: number;
  status: BookingStatus;
  createdAt: number;
  cancelledAt: number | null;
  cancellable: boolean;
}

export type SeatChangeReason = 'HELD' | 'RELEASED' | 'EXPIRED' | 'BOOKED' | 'CANCELLED';

export interface SeatStatusChangedEvent {
  type: 'SEAT_STATUS_CHANGED';
  showId: string;
  showSeatId: string;
  seatId: string;
  label: string;
  status: SeatStatus;
  reason: SeatChangeReason;
  holdUserId: string | null;
  holdExpiresAt: number | null;
  at: number;
}
