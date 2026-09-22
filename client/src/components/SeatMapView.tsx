import { formatMoney } from '../utils/format';
import type { Seat, SeatRow, SeatStatus } from '../types';

/** What the seat looks like to *this* viewer, which is not the same as its stored status. */
export type SeatView = SeatStatus | 'SELECTED' | 'MINE';

function viewFor(seat: Seat, isSelected: boolean): SeatView {
  if (seat.heldByMe) return 'MINE';
  if (isSelected) return 'SELECTED';
  return seat.status;
}

const LABELS: Record<SeatView, string> = {
  AVAILABLE: 'Available',
  SELECTED: 'Selected',
  HELD: 'Held by someone else',
  BOOKED: 'Booked',
  MINE: 'Held by you',
};

function SeatButton({
  seat,
  selected,
  onToggle,
}: {
  seat: Seat;
  selected: boolean;
  onToggle: (seat: Seat) => void;
}) {
  const view = viewFor(seat, selected);
  const disabled = view === 'HELD' || view === 'BOOKED' || view === 'MINE';

  return (
    <button
      type="button"
      className={`seat seat-${view}`}
      disabled={disabled}
      aria-pressed={view === 'SELECTED'}
      aria-label={`Seat ${seat.label} — ${LABELS[view]} — ${formatMoney(seat.price)}`}
      title={`${seat.label} · ${LABELS[view]} · ${formatMoney(seat.price)}`}
      onClick={() => onToggle(seat)}
    >
      {seat.seatNumber}
    </button>
  );
}

export function SeatMapView({
  rows,
  selectedIds,
  onToggle,
}: {
  rows: SeatRow[];
  selectedIds: Set<string>;
  onToggle: (seat: Seat) => void;
}) {
  return (
    <div className="screen-wrap">
      <div className="screen" role="presentation" />
      <div className="seat-scroll">
        <div className="seat-grid">
          {rows.map((row) => (
            <div className="seat-row" key={row.rowLabel}>
              <span className="seat-row-label" aria-hidden="true">
                {row.rowLabel}
              </span>
              {row.seats.map((seat, index) => (
                <span key={seat.showSeatId} style={{ display: 'contents' }}>
                  {/* A visual aisle in the middle of each row. */}
                  {index === Math.floor(row.seats.length / 2) && row.seats.length > 6 && (
                    <span className="seat-gap" aria-hidden="true" />
                  )}
                  <SeatButton
                    seat={seat}
                    selected={selectedIds.has(seat.showSeatId)}
                    onToggle={onToggle}
                  />
                </span>
              ))}
              <span className="seat-row-label" aria-hidden="true">
                {row.rowLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SeatLegend({ counts }: { counts?: Record<SeatStatus, number> }) {
  const items: { view: SeatView; label: string; count?: number }[] = [
    { view: 'AVAILABLE', label: 'Available', count: counts?.AVAILABLE },
    { view: 'SELECTED', label: 'Selected' },
    { view: 'HELD', label: 'Held', count: counts?.HELD },
    { view: 'BOOKED', label: 'Booked', count: counts?.BOOKED },
  ];

  return (
    <div className="legend">
      {items.map((item) => (
        <span className="legend-item" key={item.view}>
          <span className={`legend-swatch legend-${item.view}`} aria-hidden="true" />
          {item.label}
          {item.count !== undefined && <span className="faint">({item.count})</span>}
        </span>
      ))}
    </div>
  );
}

export function TierPrices({ rows }: { rows: SeatRow[] }) {
  const tiers = new Map<string, number>();
  for (const row of rows) {
    for (const seat of row.seats) {
      if (!tiers.has(seat.tier)) tiers.set(seat.tier, seat.price);
    }
  }
  const order = ['STANDARD', 'PREMIUM', 'RECLINER'];
  const sorted = [...tiers.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

  return (
    <div className="tier-note">
      {sorted.map(([tier, price]) => (
        <span key={tier}>
          {tier.charAt(0) + tier.slice(1).toLowerCase()} · {formatMoney(price)}
        </span>
      ))}
    </div>
  );
}
