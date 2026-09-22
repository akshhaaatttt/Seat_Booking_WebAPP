# SeatBox — Seat Booking Platform

A production-quality seat booking system for films, sport and live events. It is
built around one hard problem: **two people must never end up with the same
seat**, even when they click at the same moment.

Everything else in the app — the catalogue, the seat map, the admin panel —
exists to serve that guarantee.

---

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Database design](#database-design)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Commands](#commands)
- [Development credentials](#development-credentials)
- [API reference](#api-reference)
- [Authentication](#authentication)
- [Seat state machine](#seat-state-machine)
- [Hold expiration](#hold-expiration)
- [Race-condition handling](#race-condition-handling)
- [Real-time updates](#real-time-updates)
- [Testing](#testing)
- [Design decisions](#design-decisions)

---

## What it does

| Area | Behaviour |
| --- | --- |
| Accounts | Register, sign in, sign out, current user; `USER` and `ADMIN` roles |
| Catalogue | Browse events, pick a showtime; every show has its **own** seat inventory |
| Seat map | Colour-coded layout with a legend, per-seat pricing and live updates |
| Holds | Select seats and hold them for 5 minutes, with a countdown |
| Booking | Convert a hold into a booking with a reference such as `BK-20260922-8F42A1` |
| History | "My bookings" list and detail view, scoped strictly to the owner |
| Cancellation | Owner-only cancellation that returns seats to the pool |
| Admin | Manage events and shows, inspect seat inventory, search all bookings |

---

## Tech stack

**Backend** — Node.js, TypeScript (strict), Express, SQLite via `better-sqlite3`,
Zod for validation, bcrypt for password hashing, JWT sessions in httpOnly
cookies, Server-Sent Events for realtime, Vitest + Supertest for tests.

**Frontend** — React 18, TypeScript (strict), Vite, React Router, hand-written
CSS with design tokens (light and dark), `EventSource` for live seat updates.

`better-sqlite3` is a deliberate choice: it is **synchronous**, so a transaction
cannot be accidentally interleaved with an `await`, and it exposes real
`BEGIN IMMEDIATE` semantics and the exact number of rows a conditional `UPDATE`
touched — which is what the concurrency design is built on.

---

## Architecture

Request flow, strictly one direction:

```
HTTP request
    │
    ▼
route          ← validation (Zod), auth/admin middleware
    │
    ▼
service        ← business rules, transactions, state machine
    │
    ▼
repository     ← all SQL lives here, parameterised
    │
    ▼
SQLite
```

After a transaction **commits**, the service publishes realtime events:

```
service ──▶ realtime publisher ──▶ SSE stream ──▶ connected browsers
```

```
server/src/
  app.ts                 Express wiring
  server.ts              boot, scheduler start, graceful shutdown
  config/                environment parsing, one typed config object
  db/                    connection, schema.sql, transactions, layouts, migrate, seed
  domain/                errors, money, ids, models, seatState (the state machine)
  repositories/          user, event, show, seat, hold, booking — SQL only
  services/              auth, event, show, seat, hold, booking, holdExpiration
  scheduler/             interval timer that only triggers the expiry service
  realtime/              event types, in-process publisher, SSE transport
  middleware/            auth, admin, validation, centralised error handler
  validation/            Zod schemas
  routes/                auth, events, shows, holds, bookings, admin
tests/                   134 tests, including multi-process race tests

client/src/
  components/            Layout, SeatMapView, Feedback, ProtectedRoute
  pages/                 Login, Register, Events, Shows, Seats, Bookings, Admin
  hooks/                 useAuth, useSeatStream (SSE), useCountdown
  services/api.ts        the only place that talks HTTP
  types/, utils/
```

Rules the codebase keeps: no SQL outside `repositories/`, no business logic in
route handlers or React components, and no seat status change outside
`seatRepository.tryTransition`.

---

## Database design

Eight tables. Timestamps are integer epoch milliseconds; money is **integer
paise** (never floating point).

```
users ──< bookings >── shows ──< show_seats >── seats
              │          │           │
              │          │           └──< holds
              └──< booking_seats ────────┘
                                    events ──< shows
```

| Table | Purpose |
| --- | --- |
| `users` | Accounts with bcrypt hashes and a role |
| `events` | The thing being sold (a film, a match, a conference) |
| `shows` | A dated session of an event; points at a seat layout, sets the base price |
| `seats` | Physical seat catalogue per layout (row, number, tier, price multiplier) |
| `show_seats` | **Per-show inventory — the source of truth for availability** |
| `holds` | Temporary reservations with a server-set `expires_at` |
| `bookings` | Confirmed or cancelled bookings with a human-readable reference |
| `booking_seats` | Which seats a booking covers, with the price paid |

The important consequence: **a seat's state belongs to a show, not to the
world.** Seat `A1` can be `BOOKED` for tonight's screening and `AVAILABLE` for
tomorrow's, at the same time.

### Indexes and constraints that enforce correctness

```sql
-- At most one live hold per seat, ever.
CREATE UNIQUE INDEX idx_holds_one_active_per_seat
  ON holds (show_seat_id) WHERE status = 'ACTIVE';

-- A seat can belong to only one *active* booking; cancelling frees it while
-- keeping the historical row.
CREATE UNIQUE INDEX idx_booking_seats_one_active
  ON booking_seats (show_seat_id) WHERE is_active = 1;

-- One hold group can produce at most one booking, making a replayed
-- "confirm" request idempotent rather than a double booking.
CREATE UNIQUE INDEX idx_bookings_hold_group
  ON bookings (hold_group_id) WHERE hold_group_id IS NOT NULL;

-- One inventory row per (show, seat).
CREATE UNIQUE INDEX idx_show_seats_unique ON show_seats (show_id, seat_id);
```

Plus indexes on `shows(event_id, starts_at)`, `show_seats(show_id, status)`,
`holds(status, expires_at)` (the expiry sweep), `holds(user_id, status)`,
`bookings(user_id, created_at)` and `bookings(status, created_at)`.

Foreign keys are enforced (`PRAGMA foreign_keys = ON`), and every status column
carries a `CHECK` constraint, so an invalid value cannot be stored even by a
direct SQL write.

---

## Getting started

Requirements: **Node.js 20+** and npm.

```bash
git clone <repository-url>
cd Seat_Booking_WebAPP

npm install                 # installs both workspaces

cp server/.env.example server/.env
npm run db:reset            # creates the database and loads seed data

npm run dev                 # API on :4000, web app on :5173
```

Open <http://localhost:5173>.

The Vite dev server proxies `/api` to the backend, so the browser stays on a
single origin and the session cookie works without CORS special cases.

### Containers, Codespaces and remote VMs

The dev server binds to `0.0.0.0` (`server.host: true` in `client/vite.config.ts`).
Vite's default is loopback-only, which a port forwarder outside the container
cannot reach — in the browser that appears as `ERR_CONNECTION_REFUSED`.
Forwarded hostnames (`*.app.github.dev`) are listed in `server.allowedHosts`;
add your own domain there if you forward through something else.

In GitHub Codespaces, open port **5173** from the **Ports** panel rather than
typing `localhost:5173` directly. Only 5173 needs forwarding: the browser never
talks to port 4000, because Vite proxies `/api` to it from inside the container.

---

## Environment variables

All backend settings live in `server/.env` (see `server/.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `NODE_ENV` | `development` | `production` refuses to boot with the default JWT secret |
| `DATABASE_PATH` | `./data/seatbooking.db` | SQLite file location |
| `JWT_SECRET` | dev placeholder | **Must** be a strong secret in production |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for credentialed requests |
| `HOLD_DURATION_SECONDS` | `300` | How long a hold lasts (5 minutes) |
| `HOLD_SWEEP_INTERVAL_SECONDS` | `30` | How often the background sweeper runs |
| `CANCELLATION_CUTOFF_MINUTES` | `60` | No cancellation inside this window before showtime |
| `MAX_SEATS_PER_HOLD` | `8` | Per-user seat limit per show |

---

## Commands

Run from the repository root:

| Command | Does |
| --- | --- |
| `npm run dev` | API and web app together |
| `npm run dev:server` / `npm run dev:client` | One half only |
| `npm test` | The full backend test suite (134 tests) |
| `npm run typecheck` | Strict TypeScript across both workspaces |
| `npm run build` | Compile the API and bundle the web app |
| `npm run db:migrate` | Apply the schema and sync the seat catalogue |
| `npm run db:seed` | Clear transactional data and reload seed data |
| `npm run db:reset` | Delete the database file, then migrate and seed |

To run the compiled API: `cd server && npm start`.

---

## Development credentials

⚠️ **Development only.** These accounts are created by `npm run db:seed` with
deliberately weak passwords. Never run the seed against a real deployment.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@seatbox.dev` | `Admin@12345` |
| User | `aria@example.com` | `User@12345` |
| User | `dev@example.com` | `User@12345` |
| User | `nina@example.com` | `User@12345` |

The seed creates 4 events, 11 shows across three auditorium layouts, three
confirmed bookings and two live holds — all produced by calling the same
services a real user would, so the seeded state satisfies every invariant.

---

## API reference

All responses are JSON. Errors use
`{ "error": { "code": "...", "message": "...", "details": ... } }`.

| Status | Used for |
| --- | --- |
| `200` / `201` | Success |
| `400` | Malformed body or query (Zod validation) |
| `401` | Not signed in, or an expired session |
| `403` | Signed in but not allowed (another user's booking, non-admin) |
| `404` | Unknown resource |
| `409` | **Business/race conflict** — "Seat A1 is no longer available." |
| `500` | Unexpected failure (details are logged, never returned) |

### Auth
```
POST   /api/auth/register          { name, email, password }
POST   /api/auth/login             { email, password }
POST   /api/auth/logout
GET    /api/auth/me
```

### Events and shows
```
GET    /api/events
GET    /api/events/:id
GET    /api/events/:eventId/shows
POST   /api/events                 (admin)
PATCH  /api/events/:id             (admin)
DELETE /api/events/:id             (admin)
POST   /api/events/:eventId/shows  (admin)
GET    /api/shows/:id
PATCH  /api/shows/:id              (admin)
DELETE /api/shows/:id              (admin)
```

### Seats, holds and bookings
```
GET    /api/shows/:showId/seats     seat map (public)
GET    /api/shows/:showId/stream    Server-Sent Events (public)
GET    /api/shows/:showId/my-hold   recover your own live hold
POST   /api/shows/:showId/holds     { showSeatIds: string[] }  → 201 or 409
DELETE /api/holds/:holdId           release a hold you own
POST   /api/shows/:showId/book      { holdGroupId }            → 201, 200 (replay) or 409
GET    /api/bookings
GET    /api/bookings/:id
POST   /api/bookings/:id/cancel
```

### Admin
```
GET    /api/admin/events
GET    /api/admin/shows
GET    /api/admin/layouts
GET    /api/admin/shows/:showId/seats
GET    /api/admin/bookings?search=&status=&limit=&offset=
GET    /api/admin/bookings/:id
```

---

## Authentication

- Passwords are hashed with **bcrypt** (12 rounds). Plain text is never stored,
  and login always runs a hash comparison so a missing account and a wrong
  password take the same time.
- A successful register/login issues a **JWT** delivered as an **httpOnly,
  SameSite=Lax** cookie (`Secure` in production), so page JavaScript cannot read
  it. A `Authorization: Bearer <token>` header is also accepted for API clients.
- Every request re-loads the user from the database, so a deleted or demoted
  account cannot keep acting on an old token.
- `role` is **never** taken from a request body — self-service signup is always
  `USER`.

---

## Seat state machine

```
            HOLD                 BOOK
 AVAILABLE ────▶ HELD ─────────▶ BOOKED
     ▲            │                 │
     │ EXPIRE /   │                 │ CANCEL
     └─ RELEASE ──┘                 │
     └──────────────────────────────┘
```

Rejected by design, at both the service layer and in SQL:

| Transition | Why it is refused |
| --- | --- |
| `AVAILABLE → BOOKED` | A booking must always pass through a hold |
| `BOOKED → HELD` | A sold seat cannot be re-held |
| `BOOKED → BOOKED` | Double booking |
| `HELD → HELD` (other user) | A live hold cannot be taken over |

Defined once in `domain/seatState.ts`; every status change in the entire system
goes through `seatRepository.tryTransition`, which turns a transition into a
conditional `UPDATE ... WHERE status = <required state>`.

---

## Hold expiration

A hold carries a server-generated `expires_at`. It is dead the instant
`now >= expires_at` — the boundary is inclusive, and it is decided by comparing
integers in SQL against the server clock.

Expiry is enforced in **two independent places**:

1. **A background sweeper** (`scheduler/` → `holdExpirationService`) runs every
   30 seconds, releases expired holds and broadcasts the change. It also runs
   once at boot, so holds that expired while the process was down are cleaned up
   before the first request.
2. **Inline, on every request that matters.** Reading the seat map, holding
   seats and confirming a booking each release expired holds first, in their own
   committed transaction. So the system is correct even if the sweeper has not
   run — the timer is an optimisation, not the mechanism.

The countdown in the browser is **presentation only**. It is anchored to
`serverTime` from the same API response so a skewed device clock still shows the
right number, and when it hits zero the client simply re-asks the server.

---

## Race-condition handling

Four layers, each sufficient on its own to prevent a double sale:

1. **`BEGIN IMMEDIATE` transactions.** The write lock is taken up front, so two
   seat operations serialise at `BEGIN` rather than discovering the conflict
   half way through. Lock contention is retried with back-off.
2. **Conditional updates.** A seat only changes if it is still in the state the
   caller observed:
   ```sql
   UPDATE show_seats SET status = 'HELD'
    WHERE id = ? AND status = 'AVAILABLE';
   ```
   `changes === 0` means someone else won, and the request becomes a `409`.
3. **Partial unique indexes.** At most one `ACTIVE` hold per seat, one active
   `booking_seats` row per seat, one booking per hold group. Even a direct SQL
   write cannot break these.
4. **Atomic multi-seat operations.** Holding `A1, A2, A3` happens inside one
   transaction; if any seat fails, the whole thing rolls back. You never get
   `A1 = HELD, A2 = failed, A3 = HELD`.

This is verified by tests that launch **six separate OS processes** contending
for the same seat through the real service code — see [Testing](#testing).

---

## Real-time updates

**Server-Sent Events**, chosen over WebSocket because seat updates only travel
server → client, SSE needs no upgrade handshake or extra dependency, and the
browser's `EventSource` reconnects on its own after a network drop.

```
GET /api/shows/:showId/stream

event: SEAT_STATUS_CHANGED
data: {"type":"SEAT_STATUS_CHANGED","showId":"…","showSeatId":"…","label":"A1",
       "status":"HELD","reason":"HELD","holdUserId":"…","holdExpiresAt":…}
```

`reason` is one of `HELD`, `RELEASED`, `EXPIRED`, `BOOKED`, `CANCELLED`.

Two rules make this safe:

- **Events are published only after the transaction commits.** A client is never
  told about a change that could still roll back.
- **Events are a hint, never authority.** They update what is drawn on screen;
  every action is re-validated by the server. On reconnect the client re-fetches
  the full seat map rather than trusting the patches it may have missed.

Subscriptions are per-show, so a busy screening never wakes up clients watching
a different one.

---

## Testing

```bash
npm test          # 134 tests
```

| Suite | Covers |
| --- | --- |
| `seatState` | Every legal transition, and nine illegal ones |
| `auth` | Hashing, duplicate emails, role escalation attempts, sessions |
| `holds` | Pricing, limits, atomicity, ownership, conflicts |
| `expiration` | The exact boundary, inline expiry, sweeper, restart recovery |
| `booking` | Conversion, ownership, idempotent replay, server-side totals |
| `cancellation` | Owner-only, cutoff window, seats returned to the pool |
| `concurrency` | **Multi-process races**, plus database-level constraint proofs |
| `realtime` | The correct event for every transition, and none on rollback |
| `admin` / `api` | Authorisation, search, per-show inventory isolation |

The concurrency suite deserves a note. An in-process test cannot prove the
*database* prevents double booking, because a synchronous driver serialises a
single process for free. So those tests spawn **six independent OS processes**
that each open the same SQLite file, wait on a shared start instant and then
call the real service code. The workers report when they crossed the barrier and
the test asserts they collided within a tight window (measured: ~12ms), so a
pass cannot come from accidental sequencing.

---

## Design decisions

**Money as integer paise.** Floating-point money drifts. Totals are computed as
integers and formatted as `₹` only at the edges.

**Prices resolved at show creation.** Each `show_seats` row stores its own price,
derived from the show's base price and the seat tier. Repricing a show with
sales is refused, so a booking always agrees with its seats.

**The client is never trusted.** Seat status, price, user id and booking
ownership are all derived server-side. The request body carries seat *ids* and a
hold id; nothing else is believed.

**Hold groups.** Seats held in one request share a `group_id`, which is what the
client later presents to book. It makes multi-seat holds atomic to reason about
and gives a natural idempotency key.

**Soft delete where history exists.** Deleting an event or show that has
confirmed bookings would orphan them, so it is deactivated instead. Admins
cannot bypass consistency rules.

**Owner-only cancellation.** Admins can *see* every booking but cannot cancel
someone else's, so the audit trail always reflects who acted.

**Single-process realtime.** The publisher is in-process, which is right for one
server. Running several instances needs only that module swapped for Redis
pub/sub — the services call an interface, not a transport.

**SQLite.** Zero-setup, transactional, and its `BEGIN IMMEDIATE` plus conditional
updates give exactly the guarantees this problem needs. The repository layer is
plain SQL, so moving to PostgreSQL would mean changing connection handling and a
few dialect details, not the design.

---

## Further reading

- [`REASONING.md`](./REASONING.md) — why the system is built this way
- [`AI_LOGS.md`](./AI_LOGS.md) — record of the AI-assisted build
