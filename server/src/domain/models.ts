import type { SeatStatus } from './seatState.js';

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  created_at: number;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: number;
}

export interface EventRow {
  id: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface ShowRow {
  id: string;
  event_id: string;
  starts_at: number;
  screen: string;
  layout_key: string;
  base_price: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export const SEAT_TIERS = ['STANDARD', 'PREMIUM', 'RECLINER'] as const;
export type SeatTier = (typeof SEAT_TIERS)[number];

export interface SeatRow {
  id: string;
  layout_key: string;
  row_label: string;
  seat_number: number;
  label: string;
  tier: SeatTier;
  price_multiplier_bp: number;
  sort_order: number;
}

export interface ShowSeatRow {
  id: string;
  show_id: string;
  seat_id: string;
  status: SeatStatus;
  price: number;
  updated_at: number;
}

export const HOLD_STATUSES = ['ACTIVE', 'EXPIRED', 'RELEASED', 'CONVERTED'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export interface HoldRow {
  id: string;
  group_id: string;
  user_id: string;
  show_id: string;
  show_seat_id: string;
  status: HoldStatus;
  created_at: number;
  expires_at: number;
  ended_at: number | null;
}

export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface BookingRow {
  id: string;
  user_id: string;
  show_id: string;
  total_amount: number;
  status: BookingStatus;
  created_at: number;
  cancelled_at: number | null;
}

export interface BookingSeatRow {
  id: string;
  booking_id: string;
  show_seat_id: string;
  price: number;
  is_active: number;
}

// --- API-facing shapes -----------------------------------------------------

export interface EventDto {
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

export interface ShowDto {
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

export interface SeatDto {
  showSeatId: string;
  seatId: string;
  label: string;
  rowLabel: string;
  seatNumber: number;
  tier: SeatTier;
  status: SeatStatus;
  price: number;
  /** Populated only for the requesting user's own holds. */
  heldByMe: boolean;
  holdExpiresAt: number | null;
}

export interface SeatMapDto {
  show: ShowDto;
  rows: { rowLabel: string; seats: SeatDto[] }[];
  legendCounts: Record<SeatStatus, number>;
  serverTime: number;
}

export interface HoldDto {
  holdGroupId: string;
  showId: string;
  userId: string;
  seats: { showSeatId: string; label: string; price: number }[];
  totalAmount: number;
  createdAt: number;
  expiresAt: number;
  serverTime: number;
}

export interface BookingSeatDto {
  showSeatId: string;
  label: string;
  price: number;
}

export interface BookingDto {
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
  seats: BookingSeatDto[];
  totalAmount: number;
  status: BookingStatus;
  createdAt: number;
  cancelledAt: number | null;
  cancellable: boolean;
}
