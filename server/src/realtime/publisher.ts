import { logger } from '../utils/logger.js';
import type { RealtimeEvent, SeatStatusChangedEvent } from './events.js';

export type Subscriber = (event: RealtimeEvent) => void;

/**
 * A tiny in-process pub/sub bus keyed by show.
 *
 * Realtime is deliberately a *projection* of committed database state: services
 * publish only after their transaction commits, and clients treat what arrives
 * as a hint to update the UI, never as authorisation to do anything.
 *
 * Single-process scope is a conscious trade-off; swapping this implementation
 * for Redis pub/sub is the only change needed to run several server instances.
 */
class RealtimePublisher {
  private readonly byShow = new Map<string, Set<Subscriber>>();

  subscribe(showId: string, subscriber: Subscriber): () => void {
    let set = this.byShow.get(showId);
    if (!set) {
      set = new Set();
      this.byShow.set(showId, set);
    }
    set.add(subscriber);
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.byShow.delete(showId);
    };
  }

  publish(event: RealtimeEvent): void {
    const showId = event.showId;
    if (!showId) return;
    const subscribers = this.byShow.get(showId);
    if (!subscribers || subscribers.size === 0) return;
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        logger.warn('realtime subscriber failed', {
          showId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  publishAll(events: readonly RealtimeEvent[]): void {
    for (const event of events) this.publish(event);
  }

  subscriberCount(showId?: string): number {
    if (showId) return this.byShow.get(showId)?.size ?? 0;
    let total = 0;
    for (const set of this.byShow.values()) total += set.size;
    return total;
  }
}

export const realtimePublisher = new RealtimePublisher();

export function seatStatusChanged(input: {
  showId: string;
  showSeatId: string;
  seatId: string;
  label: string;
  status: SeatStatusChangedEvent['status'];
  reason: SeatStatusChangedEvent['reason'];
  holdUserId?: string | null;
  holdExpiresAt?: number | null;
  at: number;
}): SeatStatusChangedEvent {
  return {
    type: 'SEAT_STATUS_CHANGED',
    showId: input.showId,
    showSeatId: input.showSeatId,
    seatId: input.seatId,
    label: input.label,
    status: input.status,
    reason: input.reason,
    holdUserId: input.holdUserId ?? null,
    holdExpiresAt: input.holdExpiresAt ?? null,
    at: input.at,
  };
}
