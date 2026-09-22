import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export type Db = Database.Database;

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/** Read the schema from source in dev/test, or from the compiled output in prod. */
function readSchema(): string {
  if (fs.existsSync(SCHEMA_PATH)) return fs.readFileSync(SCHEMA_PATH, 'utf8');
  const fallback = path.resolve(process.cwd(), 'src/db/schema.sql');
  return fs.readFileSync(fallback, 'utf8');
}

export function openDatabase(filePath: string): Db {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const db = new Database(filePath);

  // WAL lets readers proceed while a writer holds the write lock, which is what
  // makes concurrent seat reads cheap while a hold transaction commits.
  db.pragma('journal_mode = WAL');
  // Durability: FULL is not needed for this workload, NORMAL is crash-safe under WAL.
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // If another connection holds the write lock, wait instead of failing instantly.
  db.pragma('busy_timeout = 5000');
  return db;
}

export function applySchema(db: Db): void {
  db.exec(readSchema());
}

let instance: Db | null = null;

export function getDb(): Db {
  if (!instance) {
    instance = openDatabase(config.databasePath);
    applySchema(instance);
    logger.debug('database ready', { path: config.databasePath });
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

const BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED']);
const MAX_BUSY_RETRIES = 25;

function isBusyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    BUSY_CODES.has((error as { code: string }).code)
  );
}

function sleepBusy(attempt: number): void {
  // Synchronous back-off: better-sqlite3 is a synchronous driver, so the only
  // way to yield to another *process* holding the write lock is to block here.
  const ms = Math.min(2 ** attempt, 40);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `work` inside a single `BEGIN IMMEDIATE` transaction.
 *
 * IMMEDIATE acquires the write lock up front rather than on first write, so two
 * concurrent seat operations serialise at `BEGIN` instead of discovering the
 * conflict half way through and having to roll back. If the lock cannot be
 * acquired the transaction is retried with back-off.
 */
export function withTransaction<T>(work: (db: Db) => T, db: Db = getDb()): T {
  const runner = db.transaction(work);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return runner.immediate(db);
    } catch (error) {
      if (isBusyError(error) && attempt < MAX_BUSY_RETRIES) {
        sleepBusy(attempt);
        continue;
      }
      throw error;
    }
  }
}
