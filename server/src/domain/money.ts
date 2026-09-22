/**
 * Money is stored and computed in paise (integer hundredths of a rupee) so that
 * totals are exact. Formatting to rupees happens only at the edges.
 */
export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function formatPaise(paise: number): string {
  const rupees = paise / PAISE_PER_RUPEE;
  const hasFraction = paise % PAISE_PER_RUPEE !== 0;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function sumPaise(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/** basis points: 10000 bp = 1.0x */
export function applyMultiplierBp(basePaise: number, multiplierBp: number): number {
  return Math.round((basePaise * multiplierBp) / 10000);
}
