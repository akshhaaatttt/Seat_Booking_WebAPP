import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Loading } from '../components/Feedback';
import { api } from '../services/api';
import { relativeDay } from '../utils/format';
import type { EventSummary } from '../types';

export function EventsPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listEvents()
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <h1>What's on</h1>
        <p>Pick an event, choose a showtime, then hold your seats for five minutes while you check out.</p>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!events && !error && <Loading label="Loading events…" />}

      {events && events.length === 0 && (
        <EmptyState title="Nothing on sale right now" description="Check back soon — new shows are added regularly." />
      )}

      {events && events.length > 0 && (
        <div className="grid grid-events">
          {events.map((event) => (
            <Link to={`/events/${event.id}`} key={event.id} className="card event-card">
              <div className="event-banner">
                <span className="badge" style={{ background: 'rgb(255 255 255 / 22%)', color: '#fff' }}>
                  {event.category}
                </span>
              </div>
              <div className="card-body">
                <h3>{event.title}</h3>
                <p className="muted" style={{ fontSize: '0.875rem' }}>{event.venue}</p>
                <p className="event-desc">{event.description}</p>
                <p className="faint" style={{ marginTop: 12 }}>
                  {event.nextShowAt
                    ? `Next show ${relativeDay(event.nextShowAt)} · ${event.showCount} showtime${
                        event.showCount === 1 ? '' : 's'
                      }`
                    : 'No upcoming showtimes'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
