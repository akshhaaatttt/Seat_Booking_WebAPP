import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, EmptyState, Loading } from '../components/Feedback';
import { api } from '../services/api';
import { formatDateTime, formatMoney } from '../utils/format';
import type { Booking } from '../types';

export function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listBookings()
      .then((list) => {
        if (!cancelled) setBookings(list);
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
        <h1>My bookings</h1>
        <p>Every booking you have made, newest first.</p>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {!bookings && !error && <Loading label="Loading your bookings…" />}

      {bookings && bookings.length === 0 && (
        <EmptyState
          title="No bookings yet"
          description="Once you book seats they will appear here with your reference number."
          action={
            <Link to="/" className="btn">
              Browse events
            </Link>
          }
        />
      )}

      {bookings && bookings.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {bookings.map((booking) => (
            <Link to={`/bookings/${booking.id}`} key={booking.id} className="card booking-card">
              <div className="row-between">
                <span className="booking-id">{booking.id}</span>
                <span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span>
              </div>

              <div>
                <h3>{booking.eventTitle}</h3>
                <p className="muted" style={{ fontSize: '0.875rem' }}>
                  {formatDateTime(booking.showStartsAt)} · {booking.screen}
                </p>
                <p className="faint">{booking.venue}</p>
              </div>

              <div className="row-between">
                <span className="muted">
                  {booking.seats.map((seat) => seat.label).join(', ')}
                </span>
                <strong>{formatMoney(booking.totalAmount)}</strong>
              </div>

              <span className="faint">Booked {formatDateTime(booking.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
