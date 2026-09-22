import { notFound } from '../domain/errors.js';
import type { SeatDto, SeatMapDto } from '../domain/models.js';
import type { SeatStatus } from '../domain/seatState.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showRepository from '../repositories/showRepository.js';
import { toShowDto } from '../repositories/showRepository.js';

/** Builds the seat map shown on the booking page. */
export function getSeatMap(showId: string, viewerId: string | null): SeatMapDto {
  const now = Date.now();

  const show = showRepository.findShowWithStats(showId);
  if (!show) throw notFound('Show not found.');

  const rows = seatRepository.listSeatMap(showId);
  const legendCounts: Record<SeatStatus, number> = { AVAILABLE: 0, HELD: 0, BOOKED: 0 };
  const byRow = new Map<string, SeatDto[]>();

  for (const row of rows) {
    const seat: SeatDto = {
      showSeatId: row.show_seat_id,
      seatId: row.seat_id,
      label: row.label,
      rowLabel: row.row_label,
      seatNumber: row.seat_number,
      tier: row.tier,
      status: row.status,
      price: row.price,
      heldByMe: Boolean(viewerId) && row.hold_user_id === viewerId,
      holdExpiresAt: row.hold_expires_at,
    };
    legendCounts[seat.status] += 1;

    const bucket = byRow.get(row.row_label);
    if (bucket) bucket.push(seat);
    else byRow.set(row.row_label, [seat]);
  }

  return {
    show: toShowDto(show),
    rows: [...byRow.entries()].map(([rowLabel, seats]) => ({ rowLabel, seats })),
    legendCounts,
    serverTime: now,
  };
}
