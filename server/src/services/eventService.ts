import { conflict, notFound } from '../domain/errors.js';
import { newId } from '../domain/ids.js';
import type { EventDto } from '../domain/models.js';
import * as eventRepository from '../repositories/eventRepository.js';
import { toEventDto } from '../repositories/eventRepository.js';

export function listEvents(options: { includeInactive: boolean }): EventDto[] {
  return eventRepository
    .listEvents({ includeInactive: options.includeInactive, now: Date.now() })
    .map(toEventDto);
}

export function getEvent(id: string, options: { includeInactive: boolean }): EventDto {
  const row = eventRepository.findEventById(id);
  if (!row || (row.is_active !== 1 && !options.includeInactive)) throw notFound('Event not found.');
  return toEventDto(row);
}

export function createEvent(input: {
  title: string;
  description: string;
  category: string;
  venue: string;
  isActive?: boolean;
}): EventDto {
  const row = eventRepository.insertEvent({
    id: newId(),
    title: input.title,
    description: input.description,
    category: input.category,
    venue: input.venue,
    isActive: input.isActive === false ? 0 : 1,
    createdAt: Date.now(),
  });
  return toEventDto(row);
}

export function updateEvent(
  id: string,
  patch: {
    title?: string;
    description?: string;
    category?: string;
    venue?: string;
    isActive?: boolean;
  },
): EventDto {
  if (!eventRepository.findEventById(id)) throw notFound('Event not found.');
  const row = eventRepository.updateEvent(
    id,
    {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.venue !== undefined ? { venue: patch.venue } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive ? 1 : 0 } : {}),
    },
    Date.now(),
  );
  if (!row) throw notFound('Event not found.');
  return toEventDto(row);
}

/**
 * Deleting an event that has confirmed bookings would orphan them, so it is
 * deactivated instead. Hard deletion is only allowed while nothing is sold —
 * an admin cannot bypass referential consistency.
 */
export function removeEvent(id: string): { deleted: boolean; event: EventDto | null } {
  const row = eventRepository.findEventById(id);
  if (!row) throw notFound('Event not found.');

  if (eventRepository.countConfirmedBookingsForEvent(id) > 0) {
    eventRepository.deactivateEvent(id, Date.now());
    const updated = eventRepository.findEventById(id);
    if (!updated) throw conflict('Event could not be deactivated.');
    return { deleted: false, event: toEventDto(updated) };
  }

  eventRepository.hardDeleteEvent(id);
  return { deleted: true, event: null };
}
