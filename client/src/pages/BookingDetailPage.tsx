import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Banner, Loading } from '../components/Feedback';
import { ApiError, api } from '../services/api';
import { formatDateTime, formatMoney } from '../utils/format';
import type { Booking } from '../types';

export function BookingDetailPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const location = useLocation();
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked ?? false;

  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    api
      .getBooking(bookingId)
      .then((loaded) => {
        if (!cancelled) setBooking(loaded);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const cancel = async (): Promise<void> => {
    if (!bookingId) return;
    setCancelling(true);
    setActionError(null);
    try {
      setBooking(await api.cancelBooking(bookingId));
      setConfirmingCancel(false);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not cancel this booking.');
      // Re-read: the server's view is the one that counts.
      api.getBooking(bookingId).then(setBooking).catch(() => undefined);
    } finally {
      setCancelling(false);
    }
  };

  if (error) {
    return (
      <main className="page">
        <Banner kind="error">{error}</Banner>
        <div style={{ marginTop: 16 }}>
          <Link to="/bookings" className="btn btn-secondary">
            Back to my bookings
          </Link>
        </div>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="page">
        <Loading label="Loading booking…" />
      </main>
    );
  }

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <Link to="/bookings" className="crumb">
        ← My bookings
      </Link>

      {justBooked && booking.status === 'CONFIRMED' && (
        <div style={{ marginBottom: 16 }}>
          <Banner kind="success">Your booking is confirmed. Keep the reference handy at the venue.</Banner>
        </div>
      )}

      <div className="ticket-stub">
        <div>
          <div className="label">Seats</div>
          <div className="seats">{booking.seats.map((seat) => seat.label).join(' · ')}</div>
          <div style={{ marginTop: 10, opacity: 0.9 }}>{booking.eventTitle}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="label">Total paid</div>
          <div className="seats">{formatMoney(booking.totalAmount)}</div>
        </div>
      </div>

      <div className="card card-body stack" style={{ marginTop: 16 }}>
        <div className="row-between">
          <div>
            <div className="label faint">Booking reference</div>
            <div className="booking-id" style={{ fontSize: '1rem' }}>
              {booking.id}
            </div>
          </div>
          <span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span>
        </div>

        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 20px', margin: 0 }}>
          <dt className="faint">Event</dt>
          <dd style={{ margin: 0 }}>{booking.eventTitle}</dd>

          <dt className="faint">Showtime</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(booking.showStartsAt)}</dd>

          <dt className="faint">Venue</dt>
          <dd style={{ margin: 0 }}>
            {booking.venue} · {booking.screen}
          </dd>

          <dt className="faint">Seats</dt>
          <dd style={{ margin: 0 }}>
            {booking.seats.map((seat) => `${seat.label} (${formatMoney(seat.price)})`).join(', ')}
          </dd>

          <dt className="faint">Booked on</dt>
          <dd style={{ margin: 0 }}>{formatDateTime(booking.createdAt)}</dd>

          {booking.cancelledAt && (
            <>
              <dt className="faint">Cancelled on</dt>
              <dd style={{ margin: 0 }}>{formatDateTime(booking.cancelledAt)}</dd>
            </>
          )}
        </dl>

        {actionError && <Banner kind="error">{actionError}</Banner>}

        {booking.status === 'CONFIRMED' && (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {booking.cancellable ? (
              confirmingCancel ? (
                <>
                  <span className="muted" style={{ flex: 1, fontSize: '0.88rem' }}>
                    Cancel this booking and release the seats?
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmingCancel(false)}
                    disabled={cancelling}
                  >
                    Keep booking
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void cancel()}
                    disabled={cancelling}
                  >
                    {cancelling && <span className="spinner" aria-hidden="true" />}
                    {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmingCancel(true)}>
                  Cancel booking
                </button>
              )
            ) : (
              <span className="faint">Too close to showtime to cancel online.</span>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
