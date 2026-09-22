import { applySchema, closeDb, getDb } from './index.js';
import { expandAllLayouts } from './layouts.js';
import { config } from '../config/index.js';

/**
 * Applies the schema and makes sure the seat catalogue matches the layout
 * definitions. Safe to run repeatedly: every statement is `IF NOT EXISTS` or an
 * upsert keyed on the deterministic seat id.
 */
export function migrate(): void {
  const db = getDb();
  applySchema(db);

  const insert = db.prepare(
    `INSERT INTO seats (id, layout_key, row_label, seat_number, label, tier, price_multiplier_bp, sort_order)
     VALUES (@id, @layout_key, @row_label, @seat_number, @label, @tier, @price_multiplier_bp, @sort_order)
     ON CONFLICT (id) DO UPDATE SET
       tier = excluded.tier,
       price_multiplier_bp = excluded.price_multiplier_bp,
       sort_order = excluded.sort_order`,
  );

  const seats = expandAllLayouts();
  db.transaction(() => {
    for (const seat of seats) insert.run(seat);
  })();
}

const isEntrypoint = process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isEntrypoint) {
  migrate();
  console.log(`Schema applied and seat catalogue synced at ${config.databasePath}`);
  closeDb();
}
