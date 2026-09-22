# AI Development Log

A record of the AI-assisted build of SeatBox: what was built in what order, what
was verified at each step, and the points where the first attempt was wrong and
had to be corrected.

**Assistant:** Claude Opus 5 (Claude Code)
**Repository at start:** empty — one commit containing a one-line `README.md`
**Approach:** phased, with tests and typecheck run after each phase rather than
at the end.

---

## Phase 0 — Survey

Inspected the repository (empty), confirmed Node 24 and npm registry access, and
verified the `better-sqlite3` native binding compiled and could open a database
before committing to it as the storage layer.

**Decisions taken up front**

| Decision | Reason |
| --- | --- |
| npm workspaces (`server`, `client`) | One install, shared tooling, clear boundary |
| `better-sqlite3` | Synchronous — no `await` can interleave a transaction; exposes `changes` and real `BEGIN IMMEDIATE` |
| Server-Sent Events | Updates are one-directional; `EventSource` reconnects for free |
| Integer paise for money | Exact arithmetic |
| Integer epoch ms for time | Compares and sorts correctly in SQL, timezone-free |

---

## Phase 1 — Database and models

Wrote `schema.sql` with eight tables, foreign keys, `CHECK` constraints on every
status column, and the partial unique indexes that carry the core guarantees.
Added the typed config module, logger, error types, money and id helpers.

The seat state machine (`domain/seatState.ts`) was written as data — each
transition declaring its required and resulting status — so the same definition
could drive both the pre-flight guard and the SQL `WHERE` clause.

**Verified:** `tsc --noEmit` clean.

---

## Phase 2 — Authentication

bcrypt hashing, JWT in an httpOnly cookie with bearer-token fallback, and a
constant-time-ish login that always performs a hash comparison so a missing
account and a wrong password take the same time. Role is never read from the
request body.

**Verified:** typecheck clean.

---

## Phases 3–4 — Events, shows, seat layouts

Event and show services, three auditorium layouts, and show creation that
materialises `show_seats` with prices resolved once from the base price and seat
tier.

---

## Phases 5–7 — Holds, expiration, booking

The core of the system. Written in this order: `holdExpirationService`, then
`seatService`, `holdService`, `bookingService`, so that expiry was available to
every path that needed it from the start.

**Correction made during this phase.** The first version of `confirmBooking`
had no idempotency story: a replayed request found no active holds and returned
a confusing `409`. Added `bookings.hold_group_id` with a partial unique index,
so one hold group can produce at most one booking and a replay returns the
original booking with `200`. This moved idempotency from application logic into
the schema, where it cannot be bypassed.

---

## Phase 8 — First end-to-end verification

Seeded the database through the real services (rather than raw inserts, so the
seed data satisfies every invariant), started the server, and drove the API with
`curl`.

Confirmed: registration, `/auth/me`, event listing, seat map matching the seed
exactly, a three-seat hold totalling ₹750, a competing user receiving
`409 "Seat A4 is no longer available."`, a rival being refused with `403` when
booking someone else's hold, booking, idempotent replay, ownership checks on
read and cancel, cancellation returning seats to `AVAILABLE`, and double
cancellation rejected with `409`.

**Two environment problems found and fixed here.**

1. A seat-map request unexpectedly 404'd. Investigation found **two** server
   processes listening on different ports, one holding a pre-reset database
   snapshot. Killed both and restarted deterministically.
2. The root cause of the stray restarts: `tsx watch` was watching
   `server/data/`, so every SQLite write triggered a reload. Fixed by ignoring
   the data directory in the dev script.

Neither was a product bug, but both would have wasted a developer's afternoon,
so both were fixed rather than worked around.

---

## Phase 9 — Real-time

In-process per-show publisher plus an SSE transport. The key design rule —
**publish only after the transaction commits** — was built in from the start:
services return the events they would emit, and the caller publishes them after
`withTransaction` returns.

**Verified live**, with a script that opened an SSE connection, then had eight
users race for one seat: one `201`, seven `409`, and the passive listener
received exactly one `SEAT_STATUS_CHANGED` event for `A1 → HELD`. The same
script confirmed atomic multi-seat rollback — a request for `A5, A4, A6` where
`A4` was taken failed with `409` and left `A5` and `A6` `AVAILABLE`.

---

## Phase 12 — Testing

134 tests across ten files: state machine, auth, holds, expiration, booking,
cancellation, concurrency, realtime, admin, and general API behaviour.

**The most important correction in the project.** The first concurrency test
fired parallel requests inside one Node process. It passed — but it would have
passed with *no protection at all*, because a synchronous driver serialises a
single process for free. The test proved nothing.

It was replaced with one that spawns **six independent OS processes**, each
opening the same SQLite file, waiting on a shared start timestamp, then calling
the real service code. That genuinely contends for the database write lock.

Then a second concern: what if the processes merely *ran* one after another? A
barrier is not a guarantee. Each worker now reports the instant it crossed the
barrier, and the test asserts the spread is small. Measured by deliberately
setting the threshold to 1ms to read the real value: **12ms across six
processes**. The threshold sits at 250ms.

Two further tests bypass every service and write directly to the tables, proving
the unique indexes — not the code — are what makes double-selling impossible.

**Other issues found and fixed while testing**

- A native crash in `better-sqlite3`'s destructor during Vitest worker teardown.
  Fixed by closing the connection in an `afterAll` hook before the worker exits.
- Expiry originally ran *inside* the hold transaction. A rejected hold would roll
  back the expirations too, resurrecting dead holds. Expiry now commits in its
  own transaction first, with a second in-transaction check for anything that
  expired in between.
- `noUncheckedIndexedAccess` surfaced unsafe `req.params` access across the
  routes; added a `pathParam` helper rather than casting.

**Result:** 134 passed, 0 failed.

---

## Phase 7 (frontend) — React client

Nine pages, hand-written CSS with light and dark tokens, responsive to 400px,
`EventSource` for live updates and a countdown anchored to server time.

The seat selection page handles the states that matter: a seat taken by someone
else while selected (dropped from the selection with an explanation), a `409` on
hold (selection cleared and map resynced), an expired hold (re-asks the server
rather than deciding locally), and a reconnect (full seat-map re-fetch rather
than trusting missed events).

**Verified:** client typecheck clean, production build clean, compiled server
boots and applies its schema to a fresh database, and the full browser path —
**cookie** auth rather than bearer tokens — driven through the Vite proxy:
register → hold → recover hold → book → logout.

---

## Phase 13 — Documentation

`README.md`, `REASONING.md`, and this log.

---

## Note on concurrent edits

Partway through the build, files appeared in the working tree that this session
did not author: two additional test files, three test-helper functions, a second
set of frontend service modules, and a duplicate `EventDetailPage`. Some of them
also modified `holdService` and `bookingService`.

They were reviewed rather than accepted or discarded blindly:

- The service change was the expiry-outside-the-transaction fix described above.
  It is a genuine improvement and was kept.
- The extra test files are correct service-level tests that complement the
  HTTP-level ones. They pass and were kept.
- The duplicate frontend modules were unreachable from the app entrypoint and
  broke the typecheck. Before any action was taken they were removed by whatever
  produced them, leaving a single coherent client.

This is recorded because reviewers should know the tree had more than one writer.

---

## Verification summary

| Check | Result |
| --- | --- |
| `npm test` | 134 passed, 0 failed |
| `npm run typecheck` | Clean (server and client, strict) |
| `npm run build` | Clean (server `tsc`, client `vite build`) |
| Compiled server boot | Applies schema to a fresh database and serves |
| Live API verification | Auth, holds, booking, cancellation, authorisation |
| Live concurrency | 8 parallel HTTP holds → 1 success, 7 × `409` |
| Multi-process concurrency | 6 OS processes, ~12ms spread → 1 success, 5 × `409` |
| Live SSE | Passive listener received the seat change with no refresh |
| Cookie (browser) path | register → hold → recover → book → logout |

---

## What was hardest

Not the features — the honesty of the concurrency test. It is easy to write a
test that passes and believe the system is safe. Recognising that the in-process
version proved nothing, replacing it with real OS processes, and then adding an
assertion that the processes actually *collided*, is the difference between
claiming race safety and demonstrating it.
