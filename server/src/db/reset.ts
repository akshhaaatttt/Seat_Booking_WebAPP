import fs from 'node:fs';
import { config } from '../config/index.js';
import { closeDb } from './index.js';
import { seed } from './seed.js';

/** Deletes the database file (and its WAL sidecars) before reseeding. */
function dropDatabaseFile(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.databasePath}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

closeDb();
dropDatabaseFile();
console.log(`Removed ${config.databasePath}`);

seed()
  .then(() => closeDb())
  .catch((error) => {
    console.error('Reset failed:', error);
    process.exitCode = 1;
    closeDb();
  });
