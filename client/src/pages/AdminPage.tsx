import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Banner, EmptyState, Loading } from '../components/Feedback';
import { SeatLegend, SeatMapView } from '../components/SeatMapView';
import { ApiError, api } from '../services/api';
import { formatDateTime, formatMoney } from '../utils/format';
import type { Booking, EventSummary, SeatMap, Show } from '../types';

type Tab = 'overview' | 'events' | 'shows' | 'seats' | 'bookings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'events', label: 'Events' },
  { id: 'shows', label: 'Shows' },
  { id: 'seats', label: 'Seat map' },
  { id: 'bookings', label: 'Bookings' },
];

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [loadedEvents, loadedShows] = await Promise.all([api.admin.events(), api.admin.shows()]);
      setEvents(loadedEvents);
      setShows(loadedShows);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load admin data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Admin</h1>
        <p>Manage the catalogue and watch inventory move in real time.</p>
      </div>

      {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}

      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`tab${tab === item.id ? ' tab-active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading label="Loading admin data…" />
      ) : (
        <>
          {tab === 'overview' && <Overview events={events} shows={shows} />}
          {tab === 'events' && <EventsAdmin events={events} onChange={reload} onError={setError} />}
          {tab === 'shows' && <ShowsAdmin events={events} shows={shows} onChange={reload} onError={setError} />}
          {tab === 'seats' && <SeatsAdmin shows={shows} />}
          {tab === 'bookings' && <BookingsAdmin />}
        </>
      )}
    </main>
  );
}

function Overview({ events, shows }: { events: EventSummary[]; shows: Show[] }) {
  const totals = useMemo(() => {
    return shows.reduce(
      (acc, show) => ({
        seats: acc.seats + show.totalSeats,
        available: acc.available + show.availableSeats,
        held: acc.held + show.heldSeats,
        booked: acc.booked + show.bookedSeats,
      }),
      { seats: 0, available: 0, held: 0, booked: 0 },
    );
  }, [shows]);

  const stats = [
    { label: 'Events', value: events.length },
    { label: 'Shows', value: shows.length },
    { label: 'Seats', value: totals.seats },
    { label: 'Available', value: totals.available, colour: 'var(--available)' },
    { label: 'Held', value: totals.held, colour: 'var(--held)' },
    { label: 'Booked', value: totals.booked, colour: 'var(--booked)' },
  ];

  return (
    <div className="stat-row">
      {stats.map((stat) => (
        <div className="card stat" key={stat.label}>
          <div className="stat-value" style={stat.colour ? { color: stat.colour } : undefined}>
            {stat.value}
          </div>
          <div className="stat-label">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

function EventsAdmin({
  events,
  onChange,
  onError,
}: {
  events: EventSummary[];
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ title: '', description: '', category: '', venue: '' });
  const [saving, setSaving] = useState(false);

  const create = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault();
    setSaving(true);
    try {
      await api.admin.createEvent(form);
      setForm({ title: '', description: '', category: '', venue: '' });
      await onChange();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not create the event.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (event: EventSummary): Promise<void> => {
    try {
      await api.admin.updateEvent(event.id, { isActive: !event.isActive });
      await onChange();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not update the event.');
    }
  };

  const remove = async (event: EventSummary): Promise<void> => {
    try {
      const result = await api.admin.deleteEvent(event.id);
      if (!result.deleted) {
        onError('This event has confirmed bookings, so it was deactivated instead of deleted.');
      }
      await onChange();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not delete the event.');
    }
  };

  return (
    <div className="stack">
      <form className="card card-body stack" onSubmit={create}>
        <h3>Create an event</h3>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: '2 1 220px' }}>
            <label htmlFor="ev-title">Title</label>
            <input
              id="ev-title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="ev-category">Category</label>
            <input
              id="ev-category"
              required
              placeholder="Movie"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: '2 1 220px' }}>
            <label htmlFor="ev-venue">Venue</label>
            <input
              id="ev-venue"
              required
              value={form.venue}
              onChange={(e) => setForm({ ...form, venue: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ev-desc">Description</label>
          <textarea
            id="ev-desc"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Creating…' : 'Create event'}
          </button>
        </div>
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Venue</th>
              <th>Shows</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{event.title}</td>
                <td className="muted">{event.category}</td>
                <td className="muted">{event.venue}</td>
                <td>{event.showCount ?? 0}</td>
                <td>
                  <span className={`badge badge-${event.isActive ? 'confirmed' : 'cancelled'}`}>
                    {event.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleActive(event)}>
                      {event.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(event)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShowsAdmin({
  events,
  shows,
  onChange,
  onError,
}: {
  events: EventSummary[];
  shows: Show[];
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [layouts, setLayouts] = useState<{ layoutKey: string; seatCount: number }[]>([]);
  const [form, setForm] = useState({ eventId: '', startsAt: '', screen: 'Screen 1', layoutKey: '', basePrice: '250' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.admin
      .layouts()
      .then((list) => {
        setLayouts(list);
        setForm((current) => ({ ...current, layoutKey: current.layoutKey || (list[0]?.layoutKey ?? '') }));
      })
      .catch(() => undefined);
  }, []);

  const create = async (submitEvent: FormEvent): Promise<void> => {
    submitEvent.preventDefault();
    setSaving(true);
    try {
      await api.admin.createShow(form.eventId, {
        startsAt: new Date(form.startsAt).getTime(),
        screen: form.screen,
        layoutKey: form.layoutKey,
        basePrice: Number(form.basePrice),
      });
      await onChange();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not create the show.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (show: Show): Promise<void> => {
    try {
      const result = await api.admin.deleteShow(show.id);
      if (!result.deleted) onError('This show has confirmed bookings, so it was deactivated instead.');
      await onChange();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Could not delete the show.');
    }
  };

  return (
    <div className="stack">
      <form className="card card-body stack" onSubmit={create}>
        <h3>Schedule a show</h3>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 200px' }}>
            <label htmlFor="sh-event">Event</label>
            <select
              id="sh-event"
              required
              value={form.eventId}
              onChange={(e) => setForm({ ...form, eventId: e.target.value })}
            >
              <option value="">Select an event…</option>
              {events.map((event) => (
                <option value={event.id} key={event.id}>
                  {event.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 190px' }}>
            <label htmlFor="sh-time">Starts at</label>
            <input
              id="sh-time"
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: '1 1 130px' }}>
            <label htmlFor="sh-screen">Screen</label>
            <input
              id="sh-screen"
              required
              value={form.screen}
              onChange={(e) => setForm({ ...form, screen: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: '1 1 150px' }}>
            <label htmlFor="sh-layout">Layout</label>
            <select
              id="sh-layout"
              required
              value={form.layoutKey}
              onChange={(e) => setForm({ ...form, layoutKey: e.target.value })}
            >
              {layouts.map((layout) => (
                <option value={layout.layoutKey} key={layout.layoutKey}>
                  {layout.layoutKey} ({layout.seatCount} seats)
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 120px' }}>
            <label htmlFor="sh-price">Base price (₹)</label>
            <input
              id="sh-price"
              type="number"
              min="1"
              required
              value={form.basePrice}
              onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
            />
          </div>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Creating…' : 'Add show'}
          </button>
        </div>
      </form>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Starts</th>
              <th>Screen</th>
              <th>Base price</th>
              <th>Available</th>
              <th>Held</th>
              <th>Booked</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shows.map((show) => (
              <tr key={show.id}>
                <td>{show.eventTitle}</td>
                <td>{formatDateTime(show.startsAt)}</td>
                <td className="muted">{show.screen}</td>
                <td>{formatMoney(show.basePrice)}</td>
                <td style={{ color: 'var(--available)' }}>{show.availableSeats}</td>
                <td style={{ color: 'var(--held)' }}>{show.heldSeats}</td>
                <td style={{ color: 'var(--booked)' }}>{show.bookedSeats}</td>
                <td>
                  <span className={`badge badge-${show.isActive ? 'confirmed' : 'cancelled'}`}>
                    {show.isActive ? 'On sale' : 'Off sale'}
                  </span>
                </td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(show)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeatsAdmin({ shows }: { shows: Show[] }) {
  const [showId, setShowId] = useState(shows[0]?.id ?? '');
  const [seatMap, setSeatMap] = useState<SeatMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showId) return;
    setSeatMap(null);
    api.admin
      .seats(showId)
      .then(setSeatMap)
      .catch((caught: Error) => setError(caught.message));
  }, [showId]);

  if (shows.length === 0) {
    return <EmptyState title="No shows yet" description="Create a show to inspect its seat inventory." />;
  }

  return (
    <div className="stack">
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="seat-show">Show</label>
        <select id="seat-show" value={showId} onChange={(e) => setShowId(e.target.value)}>
          {shows.map((show) => (
            <option value={show.id} key={show.id}>
              {show.eventTitle} · {formatDateTime(show.startsAt)} · {show.screen}
            </option>
          ))}
        </select>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!seatMap && !error && <Loading label="Loading seat map…" />}

      {seatMap && (
        <div className="card">
          <SeatMapView rows={seatMap.rows} selectedIds={new Set()} onToggle={() => undefined} />
          <SeatLegend counts={seatMap.legendCounts} />
        </div>
      )}
    </div>
  );
}

function BookingsAdmin() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ bookings: Booking[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Debounced so typing in the search box does not hammer the API.
    const timer = window.setTimeout(() => {
      api.admin
        .bookings({ search: search || undefined, status: status || undefined, limit: 50 })
        .then(setData)
        .catch((caught: Error) => setError(caught.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, status]);

  return (
    <div className="stack">
      <div className="row">
        <div className="field" style={{ flex: '2 1 260px' }}>
          <label htmlFor="bk-search">Search</label>
          <input
            id="bk-search"
            placeholder="Booking reference, customer or event"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: '1 1 160px' }}>
          <label htmlFor="bk-status">Status</label>
          <select id="bk-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!data && !error && <Loading label="Loading bookings…" />}

      {data && data.bookings.length === 0 && (
        <EmptyState title="No bookings match" description="Try a different search term or status filter." />
      )}

      {data && data.bookings.length > 0 && (
        <>
          <p className="faint">
            Showing {data.bookings.length} of {data.total}
          </p>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Event</th>
                  <th>Showtime</th>
                  <th>Seats</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Booked</th>
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="mono">{booking.id}</td>
                    <td>
                      {booking.userName}
                      <div className="faint">{booking.userEmail}</div>
                    </td>
                    <td>{booking.eventTitle}</td>
                    <td className="muted">{formatDateTime(booking.showStartsAt)}</td>
                    <td>{booking.seats.map((seat) => seat.label).join(', ')}</td>
                    <td>{formatMoney(booking.totalAmount)}</td>
                    <td>
                      <span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span>
                    </td>
                    <td className="muted">{formatDateTime(booking.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
