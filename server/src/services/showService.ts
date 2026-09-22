import { withTransaction } from '../db/index.js';
import { badRequest, conflict, notFound } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { ShowDto } from '../domain/models.js';
import { applyMultiplierBp } from '../domain/money.js';
import * as eventRepository from '../repositories/eventRepository.js';
import * as seatRepository from '../repositories/seatRepository.js';
import * as showRepository from '../repositories/showRepository.js';
import { toShowDto } from '../repositories/showRepository.js';

export function listShowsForEvent(
  eventId: string,
  options: { includeInactive: boolean },
): ShowDto[] {
  if (!eventRepository.findEventById(eventId)) throw notFound('Event not found.');
  return showRepository.listShowsForEvent(eventId, options).map(toShowDto);
}

export function listAllShows(options: { includeInactive: boolean }): ShowDto[] {
  return showRepository.listAllShows(options).map(toShowDto);
}

export function getShow(id: string): ShowDto {
  const row = showRepository.findShowWithStats(id);
  if (!row) throw notFound('Show not found.');
  return toShowDto(row);
}

export function listLayouts(): { layoutKey: string; seatCount: number }[] {
  return showRepository.listLayoutKeys();
}

/**
 * Creating a show materialises its own seat inventory from the chosen layout.
 * Each row gets its own price, resolved once from the show's base price and the
 * seat tier multiplier, so pricing is fixed at the moment of sale opening and
 * never recomputed from client input.
 */
export function createShow(input: {
  eventId: string;
  startsAt: number;
  screen: string;
  layoutKey: string;
  basePrice: number;
  isActive?: boolean;
}): ShowDto {
  const event = eventRepository.findEventById(input.eventId);
  if (!event) throw notFound('Event not found.');
  if (input.basePrice <= 0) throw badRequest('Base price must be greater than zero.');

  const seats = showRepository.listSeatsForLayout(input.layoutKey);
  if (seats.length === 0) throw badRequest(`Seat layout "${input.layoutKey}" does not exist.`);

  const now = Date.now();
  const showId = newId();

  withTransaction((db) => {
    showRepository.insertShow(
      {
        id: showId,
        eventId: input.eventId,
        startsAt: input.startsAt,
        screen: input.screen,
        layoutKey: input.layoutKey,
        basePrice: input.basePrice,
        isActive: input.isActive === false ? 0 : 1,
        createdAt: now,
      },
      db,
    );

    seatRepository.insertShowSeats(
      seats.map((seat) => ({
        id: newId(),
        showId,
        seatId: seat.id,
        price: applyMultiplierBp(input.basePrice, seat.price_multiplier_bp),
        updatedAt: now,
      })),
      db,
    );
  });

  return getShow(showId);
}

export function updateShow(
  id: string,
  patch: { startsAt?: number; screen?: string; basePrice?: number; isActive?: boolean },
): ShowDto {
  const existing = showRepository.findShowById(id);
  if (!existing) throw notFound('Show not found.');
  if (patch.basePrice !== undefined && patch.basePrice <= 0) {
    throw badRequest('Base price must be greater than zero.');
  }

  // Repricing an inventory that already has sales would make existing bookings
  // disagree with their seats, so it is refused.
  if (patch.basePrice !== undefined && patch.basePrice !== existing.base_price) {
    const counts = seatRepository.countsByStatus(id);
    if (counts.BOOKED > 0 || counts.HELD > 0) {
      throw conflict('Prices cannot change while seats are held or booked for this show.');
    }
  }

  withTransaction((db) => {
    const now = Date.now();
    showRepository.updateShow(
      id,
      {
        ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
        ...(patch.screen !== undefined ? { screen: patch.screen } : {}),
        ...(patch.basePrice !== undefined ? { basePrice: patch.basePrice } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive ? 1 : 0 } : {}),
      },
      now,
      db,
    );

    if (patch.basePrice !== undefined && patch.basePrice !== existing.base_price) {
      const seats = showRepository.listSeatsForLayout(existing.layout_key, db);
      seatRepository.repriceShowSeats(
        id,
        seats.map((seat) => ({
          seatId: seat.id,
          price: applyMultiplierBp(patch.basePrice!, seat.price_multiplier_bp),
        })),
        now,
        db,
      );
    }
  });

  return getShow(id);
}

/** Same rule as events: a show with confirmed bookings is deactivated, not deleted. */
export function removeShow(id: string): { deleted: boolean; show: ShowDto | null } {
  const row = showRepository.findShowById(id);
  if (!row) throw notFound('Show not found.');

  if (showRepository.countConfirmedBookingsForShow(id) > 0) {
    showRepository.deactivateShow(id, Date.now());
    return { deleted: false, show: getShow(id) };
  }

  showRepository.hardDeleteShow(id);
  return { deleted: true, show: null };
}
