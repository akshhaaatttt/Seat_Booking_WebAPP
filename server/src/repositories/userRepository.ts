import type { Db } from '../db/index.js';
import { getDb } from '../db/index.js';
import type { PublicUser, UserRole, UserRow } from '../domain/models.js';

export function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, createdAt: row.created_at };
}

export function findByEmail(email: string, db: Db = getDb()): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').get(email);
}

export function findById(id: string, db: Db = getDb()): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
}

export function insertUser(
  user: { id: string; email: string; passwordHash: string; name: string; role: UserRole; createdAt: number },
  db: Db = getDb(),
): UserRow {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at)
     VALUES (@id, @email, @passwordHash, @name, @role, @createdAt)`,
  ).run(user);
  return findById(user.id, db)!;
}

export function listUsers(db: Db = getDb()): UserRow[] {
  return db.prepare<[], UserRow>('SELECT * FROM users ORDER BY created_at DESC').all();
}
