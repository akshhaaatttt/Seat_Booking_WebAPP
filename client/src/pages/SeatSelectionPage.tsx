import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banner, Loading, StreamIndicator } from '../components/Feedback';
import { SeatLegend, SeatMapView, TierPrices } from '../components/SeatMapView';
import { useAuth } from '../hooks/useAuth';
import { useCountdown } from '../hooks/useCountdown';
import { useSeatStream } from '../hooks/useSeatStream';
import { ApiError, api } from '../services/api';
import { formatCountdown, formatDateTime, formatMoney } from '../utils/format';
import type { Hold, Seat, SeatMap, SeatStatusChangedEvent } from '../types';

/** Below this the countdown turns red. */
const URGENT_MS = 60_000;

export function SeatSelectionPage() {
  const { showId } = useParams<{ showId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [seatMap, setSeatMap] = useState<SeatMap | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'holding' | 'booking' | 'releasing' | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!showId) return;
    try {
      const [map, mine] = await Promise.all([
        api.getSeatMap(showId),
        user ? api.getMyHold(showId).catch(() => null) : Promise.resolve(null),
      ]);
      setSeatMap(map);
      setHold(mine);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : 'Could not load the seat map.');
    }
  }, [showId, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Applies a broadcast change to the local copy of the seat map. This is a
   * display optimisation: every action is still validated by the server, and a
   * reconnect re-fetches the authoritative map.
   */
  const applySeatEvent = useCallback(
    (event: SeatStatusChangedEvent) => {
      setSeatMap((current) => {
        if (!current || current.show.id !== event.showId) return current;

        let changed = false;
        const rows = current.rows.map((row) => ({
          ...row,
          seats: row.seats.map((seat) => {
            if (seat.showSeatId !== event.showSeatId || seat.status === event.status) return seat;
            changed = true;
            return {
              ...seat,
              status: event.status,
              heldByMe: event.status === 'HELD' && event.holdUserId === user?.id,
              holdExpiresAt: event.holdExpiresAt,
            };
          }),
        }));
        if (!changed) return current;

        const counts = { AVAILABLE: 0, HELD: 0, BOOKED: 0 };
        for (const row of rows) for (const seat of row.seats) counts[seat.status] += 1;
        return { ...current, rows, legendCounts: counts };
      });

      // If a seat we had merely *selected* was taken by someone else, drop it
      // and say so rather than letting the user submit a doomed request.
      if (event.status !== 'AVAILABLE' && event.holdUserId !== user?.id) {
        setSelected((current) => {
          if (!current.has(event.showSeatId)) return current;
          const next = new Set(current);
          next.delete(event.showSeatId);
          setNotice(`Seat ${event.label} was just taken by someone else.`);
          return next;
        });
      }
    },
    [user?.id],
  );

  const streamStatus = useSeatStream(showId, {
    onSeatChange: applySeatEvent,
    // Events may have been missed while disconnected, so resync from the server.
    onReconnect: () => void refresh(),
  });

  const seatsById = useMemo(() => {
    const map = new Map<string, Seat>();
    for (const row of seatMap?.rows ?? []) for (const seat of row.seats) map.set(seat.showSeatId, seat);
    return map;
  }, [seatMap]);

  const selectedSeats = useMemo(
    () => [...selected].map((id) => seatsById.get(id)).filter((seat): seat is Seat => Boolean(seat)),
    [selected, seatsById],
  );

  const selectionTotal = selectedSeats.reduce((total, seat) => total + seat.price, 0);

  const onHoldExpired = useCallback(() => {
    setHold(null);
    setSelected(new Set());
    setNotice('Your seat hold expired and the seats were released. Please select again.');
    void refresh();
  }, [refresh]);

  const remaining = useCountdown(hold?.expiresAt ?? null, hold?.serverTime ?? null, onHoldExpired);

  const toggleSeat = (seat: Seat): void => {
    setNotice(null);
    setError(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(seat.showSeatId)) next.delete(seat.showSeatId);
      else next.add(seat.showSeatId);
      return next;
    });
  };

  const holdSeats = async (): Promise<void> => {
    if (!showId || selected.size === 0) return;
    if (!user) {
      navigate('/login', { state: { from: `/shows/${showId}` } });
      return;
    }

    setBusy('holding');
    setError(null);
    setNotice(null);
    try {
      const created = await api.holdSeats(showId, [...selected]);
      setHold(created);
      setSelected(new Set());
      await refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        // A conflict means our view was stale — resync and clear the selection.
        if (caught.isConflict) {
          setSelected(new Set());
          await refresh();
        }
      } else {
        setError('Could not hold those seats. Please try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmBooking = async (): Promise<void> => {
    if (!showId || !hold) return;
    setBusy('booking');
    setError(null);
    try {
      const booking = await api.confirmBooking(showId, hold.holdGroupId);
      navigate(`/bookings/${booking.id}`, { state: { justBooked: true } });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setHold(null);
        await refresh();
      } else {
        setError('Could not complete your booking. Please try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  const releaseHold = async (): Promise<void> => {
    if (!hold) return;
    setBusy('releasing');
    try {
      await api.releaseHold(hold.holdGroupId);
      setHold(null);
      setNotice('Your seats were released.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not release your seats.');
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <main className="page">
        <Banner kind="error">{loadError}</Banner>
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!seatMap) {
    return (
      <main className="page">
        <Loading label="Loading seats…" />
      </main>
    );
  }

  const { show } = seatMap;

  return (
    <main className="page">
      <Link to={`/events/${show.eventId}`} className="crumb">
        ← All showtimes
      </Link>

      <div className="row-between page-head">
        <div>
          <h1>{show.eventTitle}</h1>
          <p>
            {formatDateTime(show.startsAt)} · {show.screen}
          </p>
        </div>
        <StreamIndicator status={streamStatus} />
      </div>

      <div className="booking-layout">
        <section className="card" aria-label="Seat map">
          <SeatMapView rows={seatMap.rows} selectedIds={selected} onToggle={toggleSeat} />
          <SeatLegend counts={seatMap.legendCounts} />
          <TierPrices rows={seatMap.rows} />
        </section>

        <aside className="card summary" aria-label="Your selection">
          <div className="summary-head">
            <h2>{hold ? 'Your held seats' : 'Your selection'}</h2>
          </div>

          <div className="summary-body">
            {error && <Banner kind="error" onDismiss={() => setError(null)}>{error}</Banner>}
            {notice && <Banner kind="warn" onDismiss={() => setNotice(null)}>{notice}</Banner>}

            {hold ? (
              <>
                <div className={`countdown${remaining < URGENT_MS ? ' countdown-urgent' : ''}`}>
                  <span>Held for you</span>
                  <span className="countdown-clock" aria-live="off">
                    {formatCountdown(remaining)}
                  </span>
                </div>
                <p className="faint">
                  These seats are reserved until the timer runs out. The server decides when a hold
                  expires, so finish checkout before then.
                </p>

                <div className="selected-chips">
                  {hold.seats.map((seat) => (
                    <span className="chip chip-held" key={seat.showSeatId}>
                      {seat.label}
                    </span>
                  ))}
                </div>

                <div className="line">
                  <span>
                    {hold.seats.length} seat{hold.seats.length === 1 ? '' : 's'}
                  </span>
                  <span>{formatMoney(hold.totalAmount)}</span>
                </div>

                <div className="total">
                  <span>Total</span>
                  <span className="total-amount">{formatMoney(hold.totalAmount)}</span>
                </div>

                <button
                  type="button"
                  className="btn btn-block"
                  onClick={() => void confirmBooking()}
                  disabled={busy !== null || remaining <= 0}
                >
                  {busy === 'booking' && <span className="spinner" aria-hidden="true" />}
                  {busy === 'booking' ? 'Confirming…' : 'Confirm booking'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => void releaseHold()}
                  disabled={busy !== null}
                >
                  Release seats
                </button>
              </>
            ) : (
              <>
                {selectedSeats.length === 0 ? (
                  <p className="muted">Choose one or more available seats from the map.</p>
                ) : (
                  <>
                    <div className="selected-chips">
                      {selectedSeats.map((seat) => (
                        <span className="chip" key={seat.showSeatId}>
                          {seat.label}
                        </span>
                      ))}
                    </div>

                    {selectedSeats.map((seat) => (
                      <div className="line" key={seat.showSeatId}>
                        <span>
                          {seat.label} · {seat.tier.charAt(0) + seat.tier.slice(1).toLowerCase()}
                        </span>
                        <span>{formatMoney(seat.price)}</span>
                      </div>
                    ))}

                    <div className="total">
                      <span>Total</span>
                      <span className="total-amount">{formatMoney(selectionTotal)}</span>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="btn btn-block"
                  onClick={() => void holdSeats()}
                  disabled={selected.size === 0 || busy !== null}
                >
                  {busy === 'holding' && <span className="spinner" aria-hidden="true" />}
                  {busy === 'holding'
                    ? 'Holding…'
                    : user
                      ? `Hold ${selected.size || ''} seat${selected.size === 1 ? '' : 's'}`.replace('  ', ' ')
                      : 'Sign in to hold seats'}
                </button>
                <p className="faint">Seats are held for 5 minutes while you complete checkout.</p>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
