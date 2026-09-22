import type { SeatTier } from '../domain/models.js';

export interface LayoutRowSpec {
  rowLabel: string;
  seats: number;
  tier: SeatTier;
  /** 10000 bp = the show's base price. */
  priceMultiplierBp: number;
}

export interface LayoutSpec {
  key: string;
  name: string;
  rows: LayoutRowSpec[];
}

/**
 * Physical auditorium layouts. Seats are catalogue data, shared by every show
 * that uses the layout; availability always lives in `show_seats`.
 */
export const LAYOUTS: LayoutSpec[] = [
  {
    key: 'cinema-50',
    name: 'Cinema · 5 rows × 10',
    rows: [
      { rowLabel: 'A', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'B', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'C', seats: 10, tier: 'PREMIUM', priceMultiplierBp: 14000 },
      { rowLabel: 'D', seats: 10, tier: 'PREMIUM', priceMultiplierBp: 14000 },
      { rowLabel: 'E', seats: 10, tier: 'RECLINER', priceMultiplierBp: 20000 },
    ],
  },
  {
    key: 'lounge-24',
    name: 'Lounge · 4 rows × 6',
    rows: [
      { rowLabel: 'A', seats: 6, tier: 'PREMIUM', priceMultiplierBp: 12000 },
      { rowLabel: 'B', seats: 6, tier: 'PREMIUM', priceMultiplierBp: 12000 },
      { rowLabel: 'C', seats: 6, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'D', seats: 6, tier: 'STANDARD', priceMultiplierBp: 10000 },
    ],
  },
  {
    key: 'stadium-80',
    name: 'Stadium stand · 8 rows × 10',
    rows: [
      { rowLabel: 'A', seats: 10, tier: 'RECLINER', priceMultiplierBp: 25000 },
      { rowLabel: 'B', seats: 10, tier: 'RECLINER', priceMultiplierBp: 25000 },
      { rowLabel: 'C', seats: 10, tier: 'PREMIUM', priceMultiplierBp: 16000 },
      { rowLabel: 'D', seats: 10, tier: 'PREMIUM', priceMultiplierBp: 16000 },
      { rowLabel: 'E', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'F', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'G', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
      { rowLabel: 'H', seats: 10, tier: 'STANDARD', priceMultiplierBp: 10000 },
    ],
  },
];

export interface SeatSeedRow {
  id: string;
  layout_key: string;
  row_label: string;
  seat_number: number;
  label: string;
  tier: SeatTier;
  price_multiplier_bp: number;
  sort_order: number;
}

export function expandLayout(layout: LayoutSpec): SeatSeedRow[] {
  const rows: SeatSeedRow[] = [];
  let order = 0;
  for (const row of layout.rows) {
    for (let number = 1; number <= row.seats; number += 1) {
      const label = `${row.rowLabel}${number}`;
      rows.push({
        // Deterministic id keeps seeding idempotent and makes fixtures readable.
        id: `${layout.key}:${label}`,
        layout_key: layout.key,
        row_label: row.rowLabel,
        seat_number: number,
        label,
        tier: row.tier,
        price_multiplier_bp: row.priceMultiplierBp,
        sort_order: order,
      });
      order += 1;
    }
  }
  return rows;
}

export function expandAllLayouts(): SeatSeedRow[] {
  return LAYOUTS.flatMap(expandLayout);
}
