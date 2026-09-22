-- ---------------------------------------------------------------------------
-- Seat Booking schema
--
-- Conventions:
--   * Every timestamp is an INTEGER holding Unix epoch milliseconds (UTC).
--     Integers compare correctly, sort correctly and are timezone-free, which
--     matters because hold expiry is decided by comparing numbers in SQL.
--   * Every monetary amount is an INTEGER holding paise (1/100 of a rupee).
--     Floating point money is never stored.
--   * Seat availability lives on `show_seats`, never on `seats`. The same
--     physical seat is independent across shows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
  created_at    INTEGER NOT NULL
);

-- Case-insensitive uniqueness: registration lowercases the address, this index
-- is the database-level guarantee that two accounts can never share an email.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL,
  venue       TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_active ON events (is_active, created_at DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shows (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  starts_at      INTEGER NOT NULL,
  screen         TEXT NOT NULL DEFAULT 'Screen 1',
  layout_key     TEXT NOT NULL,
  base_price     INTEGER NOT NULL CHECK (base_price > 0), -- paise
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shows_event ON shows (event_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_shows_starts_at ON shows (starts_at);

-- ---------------------------------------------------------------------------
-- Physical seat catalogue. A `layout_key` groups the seats belonging to one
-- auditorium layout; a show points at a layout and inherits its seats.

CREATE TABLE IF NOT EXISTS seats (
  id          TEXT PRIMARY KEY,
  layout_key  TEXT NOT NULL,
  row_label   TEXT NOT NULL,
  seat_number INTEGER NOT NULL CHECK (seat_number > 0),
  label       TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('STANDARD', 'PREMIUM', 'RECLINER')),
  -- Price of this seat = show.base_price * price_multiplier_bp / 10000.
  price_multiplier_bp INTEGER NOT NULL CHECK (price_multiplier_bp > 0),
  sort_order  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seats_layout_label ON seats (layout_key, label);
CREATE INDEX IF NOT EXISTS idx_seats_layout_order ON seats (layout_key, sort_order);

-- ---------------------------------------------------------------------------
-- Per-show seat inventory: this table is the single source of truth for
-- whether a seat can be taken.

CREATE TABLE IF NOT EXISTS show_seats (
  id         TEXT PRIMARY KEY,
  show_id    TEXT NOT NULL REFERENCES shows (id) ON DELETE CASCADE,
  seat_id    TEXT NOT NULL REFERENCES seats (id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('AVAILABLE', 'HELD', 'BOOKED')),
  price      INTEGER NOT NULL CHECK (price > 0), -- paise, resolved at show creation
  updated_at INTEGER NOT NULL
);

-- One inventory row per (show, seat): the structural guarantee that a seat
-- cannot be duplicated within a show.
CREATE UNIQUE INDEX IF NOT EXISTS idx_show_seats_unique ON show_seats (show_id, seat_id);
CREATE INDEX IF NOT EXISTS idx_show_seats_show_status ON show_seats (show_id, status);

-- ---------------------------------------------------------------------------
-- Temporary holds. A hold is the reservation of a show_seat by one user for a
-- bounded window; `expires_at` is authoritative and always server-generated.

CREATE TABLE IF NOT EXISTS holds (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL,     -- one id shared by all seats held in a single request
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  show_id      TEXT NOT NULL REFERENCES shows (id) ON DELETE CASCADE,
  show_seat_id TEXT NOT NULL REFERENCES show_seats (id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'RELEASED', 'CONVERTED')),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ended_at     INTEGER
);

-- THE race-condition backstop: at most one ACTIVE hold may exist for a seat.
-- Even if application logic were wrong, a second concurrent hold insert fails
-- with SQLITE_CONSTRAINT rather than double-booking the seat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_holds_one_active_per_seat
  ON holds (show_seat_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_holds_expiry_sweep ON holds (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_holds_user ON holds (user_id, status);
CREATE INDEX IF NOT EXISTS idx_holds_group ON holds (group_id);
CREATE INDEX IF NOT EXISTS idx_holds_show ON holds (show_id, status);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,           -- human readable, e.g. BK-20260922-8F42A1
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  show_id      TEXT NOT NULL REFERENCES shows (id) ON DELETE CASCADE,
  -- The hold group this booking was converted from. Unique, so a replayed
  -- "confirm booking" request can never create a second booking.
  hold_group_id TEXT,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0), -- paise, server-computed
  status       TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  created_at   INTEGER NOT NULL,
  cancelled_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_hold_group
  ON bookings (hold_group_id) WHERE hold_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_show ON bookings (show_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status, created_at DESC);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS booking_seats (
  id           TEXT PRIMARY KEY,
  booking_id   TEXT NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  show_seat_id TEXT NOT NULL REFERENCES show_seats (id) ON DELETE CASCADE,
  price        INTEGER NOT NULL CHECK (price > 0), -- paise, copied from show_seats at booking time
  -- 1 while the parent booking is CONFIRMED, 0 once cancelled.
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- A seat can only belong to one *active* booking, forever. Cancelling flips
-- is_active to 0 and frees the seat for a future booking, while the historical
-- row is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_seats_one_active
  ON booking_seats (show_seat_id) WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_booking_seats_booking ON booking_seats (booking_id);
