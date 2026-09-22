import { notFound } from '../domain/errors.js';
import type { SeatDto, SeatMapDto } from '../domain/models.js';
import type { SeatStatus } from '../domain/seatState.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showRepository from '../repositories/showRepository.js';
import { toShowDto } from '../repositories/showRepository.js';
import { sweepIfNeeded } from './holdExpirationService.js';

/**
 * Builds the seat map for a show.
 *
 * Before reading, any hold that is already past its deadline is released, so
 * what a client sees can never include a stale HELD seat — regardless of when
 * the background sweeper last ran.
 */
export function getSeatMap(showId: string, viewerId: string | null): SeatMapDto {
  const now = Date.now();
  sweepIfNeeded(now, { showId });

  const show = showRepository.findShowWithStats(showId);
  if (!show) throw notFound('Show not found.');

  const rows = seatRepository.listSeatMap(showId);
  const legendCounts: Record<SeatStatus, number> = { AVAILABLE: 0, HELD: 0, BOOKED: 0 };
  const byRow = new Map<string, SeatDto[]>();

  for (const row of rows) {
    const holdIsLive = row.hold_expires_at !== null && row.hold_expires_at > now;
    const seat: SeatDto = {
      showSeatId: row.show_seat_id,
      seatId: row.seat_id,
      label: row.label,
      rowLabel: row.row_label,
      seatNumber: row.seat_number,
      tier: row.tier,
      status: row.status,
      price: row.price,
      // Ownership of a hold is decided by the server from the authenticated
      // session, never from anything the client claims.
      heldByMe: Boolean(viewerId) && holdIsLive && row.hold_user_id === viewerId,
      holdExpiresAt: holdIsLive ? row.hold_expires_at : null,
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
    // The client uses this to align its countdown with the server clock rather
    // than trusting the device clock.
    serverTime: now,
  };
}

export function getSeatCounts(showId: string): Record<SeatStatus, number> {
  sweepIfNeeded(Date.now(), { showId });
  return seatRepository.countsByStatus(showId);
}
