import { useEffect, useRef, useState } from 'react';
import type { SeatStatusChangedEvent } from '../types';

export type StreamStatus = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to a show's seat stream.
 *
 * EventSource reconnects on its own after a network drop, which covers the
 * "user loses connectivity" case. Because events can be missed while offline,
 * `onReconnect` lets the page re-fetch the authoritative seat map instead of
 * trusting the patches it received — the stream is an optimisation, never the
 * source of truth.
 */
export function useSeatStream(
  showId: string | undefined,
  handlers: {
    onSeatChange: (event: SeatStatusChangedEvent) => void;
    onReconnect?: () => void;
  },
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!showId) return;

    const source = new EventSource(`/api/shows/${showId}/stream`);
    // The first CONNECTED frame after a drop means we may have missed events.
    let hasConnectedBefore = false;

    source.addEventListener('CONNECTED', () => {
      setStatus('live');
      if (hasConnectedBefore) handlersRef.current.onReconnect?.();
      hasConnectedBefore = true;
    });

    source.addEventListener('SEAT_STATUS_CHANGED', (event) => {
      try {
        handlersRef.current.onSeatChange(JSON.parse((event as MessageEvent<string>).data));
      } catch (error) {
        console.error('Malformed seat event', error);
      }
    });

    source.onerror = () => {
      // readyState CLOSED means it gave up; CONNECTING means it is retrying.
      setStatus(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    };

    return () => source.close();
  }, [showId]);

  return status;
}
