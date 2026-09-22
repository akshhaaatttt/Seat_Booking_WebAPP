import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banner, EmptyState, Loading } from '../components/Feedback';
import { api } from '../services/api';
import { formatDate, formatMoney, formatTime, relativeDay } from '../utils/format';
import type { EventSummary, Show } from '../types';

function availabilityClass(show: Show): string {
  if (show.availableSeats === 0) return 'availability-none';
  if (show.availableSeats <= show.totalSeats * 0.2) return 'availability-low';
  return 'availability-good';
}

export function ShowSelectionPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    Promise.all([api.getEvent(eventId), api.listShows(eventId)])
      .then(([loadedEvent, loadedShows]) => {
        if (cancelled) return;
        setEvent(loadedEvent);
        setShows(loadedShows);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Group showtimes by calendar day so the user picks a date, then a time.
  const byDay = useMemo(() => {
    const groups = new Map<string, Show[]>();
    for (const show of shows ?? []) {
      const key = formatDate(show.startsAt);
      const bucket = groups.get(key);
      if (bucket) bucket.push(show);
      else groups.set(key, [show]);
    }
    return [...groups.entries()];
  }, [shows]);

  if (error) {
    return (
      <main className="page">
        <Banner kind="error">{error}</Banner>
      </main>
    );
  }

  if (!event || !shows) {
    return (
      <main className="page">
        <Loading label="Loading showtimes…" />
      </main>
    );
  }

  return (
    <main className="page">
      <Link to="/" className="crumb">
        ← All events
      </Link>

      <div className="page-head">
        <span className="badge">{event.category}</span>
        <h1 style={{ marginTop: 8 }}>{event.title}</h1>
        <p>{event.venue}</p>
        {event.description && <p style={{ marginTop: 10, maxWidth: '60ch' }}>{event.description}</p>}
      </div>

      {byDay.length === 0 ? (
        <EmptyState
          title="No showtimes scheduled"
          description="This event has no upcoming shows on sale at the moment."
          action={
            <Link to="/" className="btn btn-secondary">
              Browse other events
            </Link>
          }
        />
      ) : (
        byDay.map(([day, dayShows]) => (
          <section className="show-day" key={day}>
            <h3>
              {relativeDay(dayShows[0]!.startsAt)} · {day}
            </h3>
            <div className="show-times">
              {dayShows.map((show) => {
                const soldOut = show.availableSeats === 0;
                return (
                  <button
                    type="button"
                    key={show.id}
                    className={`show-tile${soldOut ? ' is-full' : ''}`}
                    disabled={soldOut}
                    onClick={() => navigate(`/shows/${show.id}`)}
                  >
                    <strong>{formatTime(show.startsAt)}</strong>
                    <span className="faint">{show.screen}</span>
                    <span className="faint">from {formatMoney(show.basePrice)}</span>
                    <span className={`availability ${availabilityClass(show)}`}>
                      {soldOut ? 'Sold out' : `${show.availableSeats} seats left`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
