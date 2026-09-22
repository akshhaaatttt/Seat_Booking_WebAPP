import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Every test file gets its own on-disk database. It must be a real file rather
// than :memory: because the concurrency suite opens the same database from
// separate OS processes.
const dbPath = path.join(os.tmpdir(), 'seatbooking-tests', `${process.pid}-${randomUUID()}.db`);

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret-not-used-in-production';
process.env.DATABASE_PATH = dbPath;
process.env.HOLD_DURATION_SECONDS = '300';
process.env.CANCELLATION_CUTOFF_MINUTES = '60';
process.env.MAX_SEATS_PER_HOLD = '8';

afterAll(async () => {
  // better-sqlite3 holds native handles; closing them before the worker exits
  // avoids a crash in the addon's destructor during teardown.
  const { closeDb } = await import('../src/db/index.js');
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbPath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
});
