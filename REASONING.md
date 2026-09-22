# Reasoning

Why SeatBox is built the way it is. The README describes *what* the system does;
this document explains the thinking, the trade-offs, and the things that would
be wrong if done the obvious way.

---

## 1. The seat state machine

A seat, within a given show, is in exactly one of three states:

```
            HOLD                 BOOK
 AVAILABLE ────▶ HELD ─────────▶ BOOKED
     ▲            │                 │
     │ EXPIRE /   │                 │ CANCEL
     └─ RELEASE ──┘                 │
     └──────────────────────────────┘
```

Five transitions exist, and nothing else is representable:

| Transition | From | To | Trigger |
| --- | --- | --- | --- |
| `HOLD` | `AVAILABLE` | `HELD` | User confirms a selection |
| `BOOK` | `HELD` | `BOOKED` | User confirms the booking |
| `EXPIRE` | `HELD` | `AVAILABLE` | Deadline passed |
| `RELEASE` | `HELD` | `AVAILABLE` | User gave the seats up |
| `CANCEL` | `BOOKED` | `AVAILABLE` | Owner cancelled the booking |

The machine is defined once, as data, in `domain/seatState.ts`. Each transition
declares the state it requires and the state it produces. That single definition
is then used twice:

- as a **guard** before acting, which produces a precise message
  ("Seat A1 is already booked");
- as the **`WHERE` clause** of the `UPDATE` that performs it.

The second use is the one that matters. Because `tryTransition` writes

```sql
UPDATE show_seats SET status = :to WHERE id = :id AND status = :from
```

an illegal transition cannot be executed even if a bug skipped the guard: the
row simply does not match and zero rows change.

The transitions that are *absent* carry as much meaning as the ones present:

- **`AVAILABLE → BOOKED` is missing.** Booking must pass through a hold. This
  guarantees that a booking is always backed by a reservation the user actually
  owned, and gives us one place — the hold — where identity and time are checked.
- **`BOOKED → HELD` and `BOOKED → BOOKED` are missing.** A sold seat is sold.
- **`HELD → HELD` is missing.** A hold cannot be stolen. Combined with the
  partial unique index on active holds, one seat has at most one owner.

### Why state lives on `show_seats` and not on `seats`

`seats` is a catalogue of physical chairs in an auditorium. `show_seats` is the
*inventory for one performance*. Seat `A1` is a different sellable thing on
Friday than on Saturday, so availability belongs to the pairing of seat and
show. Putting a status column on `seats` would mean selling `A1` once, ever —
an obvious bug, and one that is easy to write if the schema invites it.

---

## 2. Why holds are temporary

Checkout takes time. Without a hold, either:

- **nothing is reserved**, and the user reaches the confirmation step only to be
  told the seat went to someone else — the worst possible moment to fail; or
- **the seat is reserved forever**, and any abandoned tab permanently removes
  inventory.

A hold is the compromise: an exclusive, *time-boxed* claim. Five minutes is long
enough to finish checkout and short enough that an abandoned session costs the
venue a few minutes of one seat.

The hold is also the unit of identity and atomicity. Seats held in one request
share a `group_id`, so "the three seats I picked" is a single thing that can be
booked, released, or expired as a unit.

A hold is **not** a lock in the database sense. Database locks are held for
microseconds inside a transaction; a hold is a *business* reservation that
outlives any transaction and survives a server restart, because it is a row.

---

## 3. How expiration works

A hold stores `expires_at`, set by the server as `now + HOLD_DURATION_SECONDS`.
The client never supplies or influences it.

A hold is expired when `expires_at <= now`. The boundary is **inclusive**: at
exactly the deadline the hold is already dead. That choice is arbitrary but must
be consistent, so it lives in one SQL predicate used by every code path, and it
is pinned by a test that checks the millisecond either side of the deadline.

Expiry is enforced in two independent ways, and this redundancy is the point.

**The background sweeper** (`scheduler/` → `holdExpirationService`) runs every
30 seconds: find expired holds, close them, return their seats, broadcast. It
also runs once at boot, so holds that died while the process was down are
cleaned up before the first request is served.

**Inline expiry on the request path.** Reading a seat map, holding seats and
confirming a booking each begin by releasing expired holds in scope. This is
what makes the system correct rather than merely tidy: if a hold expired 200ms
ago and the sweeper is 25 seconds from its next run, the seat is *still*
immediately available to the next person who asks.

The scheduler is therefore an optimisation — it keeps the data clean and keeps
other viewers' screens up to date — not the mechanism. If the timer never fired,
the system would still never sell an expired hold.

One subtlety worth recording. Inline expiry runs in its **own committed
transaction**, before the transaction that does the real work. The first
implementation ran it inside the same transaction, which had a quiet bug: if the
hold attempt then failed (seat taken), the rollback would also undo the
expirations, resurrecting holds that had genuinely died. Separating them means a
rejected request rolls back only its own work.

Finally, the booking path re-checks the deadline itself rather than assuming the
sweep just ran. Defence in depth: each step is correct without trusting the
previous one.

---

## 4. How race conditions are prevented

The scenario to defeat: two users both see `A1` as available and both click.

Four layers, in order of when they act. Any one of them is sufficient; together
they make a double sale unrepresentable.

### Layer 1 — `BEGIN IMMEDIATE`

Every seat operation runs inside a transaction opened with `BEGIN IMMEDIATE`,
which acquires the write lock at `BEGIN` rather than at first write. Two
concurrent hold attempts therefore serialise at the door, instead of both
reading "available", both deciding to proceed, and then discovering the conflict
halfway through. If the lock is unavailable, the transaction is retried with
back-off rather than failing the user.

### Layer 2 — conditional updates

The read that decided to act is not trusted at write time. Every status change
is expressed as:

```sql
UPDATE show_seats SET status = 'HELD'
 WHERE id = :id AND status = 'AVAILABLE';
```

If another transaction got there first, the predicate no longer matches, zero
rows change, and `tryTransition` returns `false`. The service turns that into
`409 Conflict — "Seat A1 is no longer available."`

This is the difference between *checking* and *guaranteeing*. A
`SELECT … then UPDATE` pair can be interleaved; a conditional `UPDATE` is
evaluated and applied atomically by the database.

### Layer 3 — unique constraints

Even if the application logic were wrong, the schema refuses:

```sql
CREATE UNIQUE INDEX idx_holds_one_active_per_seat
  ON holds (show_seat_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX idx_booking_seats_one_active
  ON booking_seats (show_seat_id) WHERE is_active = 1;
```

Two live holds on one seat, or one seat in two active bookings, are not
*rejected by code* — they are **not storable**. Tests assert this by bypassing
every service and writing directly to the tables.

### Layer 4 — idempotency

A retried or double-clicked "confirm booking" must not produce two bookings. A
unique index on `bookings(hold_group_id)` makes one hold group yield at most one
booking, and the service detects the existing booking and returns it with `200`
instead of erroring. Duplicate hold requests are similarly safe: the second one
loses the conditional update and gets a clean `409`.

### Proving it

A test that fires parallel requests inside one Node process proves less than it
appears to: `better-sqlite3` is synchronous, so one process serialises its own
transactions for free, and the test would pass even with no protection at all.

So the concurrency suite spawns **six separate OS processes**. Each opens the
same SQLite file, waits on a shared start timestamp, then calls the real service
code. Each worker reports the instant it crossed the barrier, and the test
asserts those instants fall inside a tight window — measured at about 12ms — so
a pass cannot be an artifact of accidental sequencing. Exactly one process wins;
the other five receive a `409` with the expected message.

---

## 5. How database transactions are used

The rule: **a transaction wraps a decision and its consequences, never just a
write.**

Holding seats, inside one transaction:

1. release expired holds in scope (re-checked here, after the pre-sweep);
2. check the per-user seat limit;
3. load the requested inventory rows;
4. for each seat: conditional `UPDATE` to `HELD`, then insert the hold row;
5. any failure throws → the whole transaction rolls back.

Because the throw happens inside the transaction callback, rollback is automatic
and total. There is no cleanup code to forget.

Booking follows the same shape: verify the hold exists, is owned by this user
and has not expired; move each seat `HELD → BOOKED`; compute the total from
stored prices; insert the booking and its seats; close the holds as `CONVERTED`.
All of it, or none of it.

Realtime events are deliberately **outside** this boundary. Services collect the
events they would emit, return them from the transaction, and publish only after
it commits — so no client is ever told about a change that then rolls back.

`better-sqlite3` being synchronous helps here in a way that is easy to
under-appreciate: there is no `await` inside a transaction, so it is impossible
to accidentally yield the event loop mid-transaction and interleave unrelated
work.

---

## 6. Why the frontend cannot be trusted

Anything the browser sends is a *claim*, not a fact. Every claim that matters is
re-derived server-side:

| The client might send | What the server does |
| --- | --- |
| Seat status ("A1 is available") | Reads `show_seats.status` inside the transaction |
| A price or total | Ignores it; sums `show_seats.price` |
| A user id | Ignores it; uses the id inside the signed session token |
| "This booking is mine" | Compares `bookings.user_id` to the session user |
| `role: "ADMIN"` at signup | Ignores it; self-service signup is always `USER` |
| A hold that has expired | Compares `expires_at` to the server clock |

The request body carries only opaque identifiers — which seats, which hold. Even
those are validated: seats must belong to the show in the URL, and a hold must
belong to the caller.

The countdown makes the principle concrete. The browser shows `04:32` ticking
down, but that number has no authority. It is anchored to a `serverTime` value
returned by the API (so a device with a wrong clock still shows the right
number), and when it reaches zero the client does not *decide* anything — it
re-asks the server. Conversely, a client whose timer still shows time remaining
will still be refused if the server says the hold is gone.

Client-side route guards and disabled seat buttons exist so the interface is
pleasant, not so it is safe. Every one of them is enforced again on the server,
and the tests exercise the server directly to prove it.

---

## 7. How real-time updates work

The requirement is one-directional: the server tells browsers that a seat
changed. WebSocket would work but brings a protocol upgrade, a second
dependency, and connection lifecycle code to maintain.

**Server-Sent Events** does exactly this job over plain HTTP, and the browser's
`EventSource` reconnects automatically after a network drop — which is precisely
the "user's train went into a tunnel" case that has to be survived anyway.

```
Alice holds A1
      │
      ▼
transaction commits           ← state is now true
      │
      ▼
publisher.publish(event)      ← per-show channel
      │
      ▼
SSE stream → Bob's browser
      │
      ▼
A1 turns amber, no refresh
```

Design points:

- **Per-show channels.** A busy screening does not wake clients watching a
  different one.
- **Publish after commit.** Never announce a change that could still roll back.
- **Heartbeat comments** every 25 seconds so proxies do not close an idle stream.
- **`holdUserId` is included** so a user's second tab can recognise their own
  hold. It is an opaque uuid, and seat availability is public information
  anyway; the alternative — an extra authenticated fetch per event — was not
  worth it.
- **Resync on reconnect.** Events missed while offline are gone forever, so
  `EventSource`'s second `CONNECTED` frame triggers a full seat-map re-fetch
  rather than leaving the UI to drift.

The last point is the important one: the stream is an *optimisation of
freshness*. Correctness comes from the fact that every action is re-validated
against the database. If the stream broke entirely, the app would still be
correct — just less pleasant.

---

## 8. How multi-seat atomicity works

Selecting `A1, A2, A3` must not produce `A1 = HELD, A2 = failed, A3 = HELD`.
Partial success is arguably worse than clean failure: the user is charged
nothing, holds two seats they did not want, and has removed them from sale.

All three seats are therefore held inside a **single transaction**. Each seat is
attempted in turn; the first failure throws, and the throw rolls back every
change made so far — including seats already moved to `HELD` and hold rows
already inserted.

The result the user sees:

```
A1 = AVAILABLE   (rolled back)
A2 = unavailable (someone else has it)
A3 = AVAILABLE   (rolled back)

409 Conflict — "Seat A2 is no longer available."
```

The error names the specific seat that failed, because "your booking failed" is
useless to someone staring at a seat map.

Booking inherits the same property: a hold group converts entirely or not at
all.

Two details make this robust:

- **Duplicate seat ids are collapsed** before the transaction, so sending `A1`
  three times holds one seat rather than tripping the unique index.
- **Seats are processed in a stable order** (by layout position), which keeps
  concurrent overlapping requests from deadlocking on each other.

---

## 9. Trade-offs

**SQLite instead of PostgreSQL.** Zero setup, real transactions, real
constraints, and `BEGIN IMMEDIATE` gives exactly the serialisation needed. The
cost is one writer at a time — fine here, and honestly stated rather than
hidden. All SQL is confined to the repository layer, so the port to PostgreSQL
would be connection handling and dialect details (`SELECT … FOR UPDATE` instead
of relying on the write lock), not a redesign.

**In-process realtime.** The publisher is a `Map` of subscribers, which works
for one server and not for several. Swapping it for Redis pub/sub is a
single-module change because services publish through an interface rather than
touching a transport. Building that now would have been complexity without a
requirement.

**Polling vs SSE.** Polling every few seconds would be simpler still, but with a
five-minute hold window it would waste requests and show stale seats for longer
than feels acceptable when two people are competing for the last pair together.

**Synchronous database driver.** It blocks the event loop during a transaction,
which caps throughput. In exchange, transactions cannot be accidentally
interleaved with `await`, and the exact rows-changed count is available for the
conditional-update design. For a booking system, the correctness properties are
worth more than the throughput.

**Lazy expiry on read paths.** Every seat-map read may open a write transaction.
It is guarded by a cheap indexed lookup that only escalates when something has
actually expired, and it buys the guarantee that no client ever sees a stale
`HELD` seat.

**Five-minute holds, eight seats per user.** Both are judgement calls, both live
in configuration rather than in the code, and neither is assumed anywhere in the
logic.

**Owner-only cancellation.** Admins can see every booking but cannot cancel one.
Support-initiated refunds are a real need, but they should be a deliberate,
audited feature rather than an implicit consequence of having an admin flag.

**Soft delete for events and shows with sales.** Hard-deleting them would orphan
bookings. Deactivation keeps history intact and keeps the admin from bypassing
consistency rules.

**Prices frozen at show creation.** Each `show_seats` row stores its own price
rather than computing it from the tier at read time. This means an existing
booking can never disagree with its seats, at the cost of refusing to reprice a
show that already has holds or sales.
