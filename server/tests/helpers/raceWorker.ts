/**
 * Runs one seat operation in its own OS process, against the same SQLite file
 * as every other worker.
 *
 * This exists because an in-process concurrency test cannot, on its own, prove
 * that the *database* prevents double booking: better-sqlite3 is synchronous,
 * so a single Node process serialises its own transactions for free. Separate
 * processes contend for a real write lock, so what is being tested here is the
 * `BEGIN IMMEDIATE` + conditional-UPDATE + unique-index design itself.
 *
 * Invoked as: tsx raceWorker.ts <dbPath> <mode> <showId> <userId> <payload> <startAtMs>
 */
const [dbPath, mode, showId, userId, payload, startAt] = process.argv.slice(2);

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.DATABASE_PATH = dbPath;

// Imported after the environment is set, because config is read at module load.
const { AppError } = await import('../../src/domain/errors.js');
const holdService = await import('../../src/services/holdService.js');
const bookingService = await import('../../src/services/bookingService.js');

// Spin until the shared start instant so the workers collide as tightly as
// possible rather than lining up behind each other's startup cost.
const target = Number(startAt);
while (Date.now() < target) {
  /* deliberate busy-wait: sub-millisecond precision matters here */
}

// Recorded immediately after the barrier so the parent can verify the workers
// really did collide rather than running one after another.
const attemptedAt = Date.now();

try {
  if (mode === 'hold') {
    const hold = holdService.holdSeats({
      userId: userId!,
      showId: showId!,
      showSeatIds: payload!.split(','),
    });
    report({ ok: true, holdGroupId: hold.holdGroupId, seats: hold.seats.map((s) => s.label) });
  } else if (mode === 'book') {
    const { booking, alreadyExisted } = bookingService.confirmBooking({
      userId: userId!,
      showId: showId!,
      holdGroupId: payload!,
    });
    report({ ok: true, bookingId: booking.id, alreadyExisted });
  } else {
    throw new Error(`Unknown worker mode: ${mode}`);
  }
} catch (error) {
  if (error instanceof AppError) {
    report({ ok: false, status: error.statusCode, message: error.message });
  } else {
    report({ ok: false, status: 500, message: error instanceof Error ? error.message : String(error) });
  }
}

function report(result: Record<string, unknown>): void {
  process.stdout.write(`__RESULT__${JSON.stringify({ ...result, attemptedAt })}\n`);
}

// Release the SQLite handle explicitly before this process exits; leaving it to
// runtime teardown can abort the process inside the native destructor.
const { closeDb } = await import('../../src/db/index.js');
closeDb();

// Marks the file as a module so its top-level `await` is valid TypeScript.
export {};
