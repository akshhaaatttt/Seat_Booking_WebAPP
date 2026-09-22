import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { newId } from '../domain/ids.js';
import { badRequest, conflict, unauthorized } from '../domain/errors.js';
import type { PublicUser, UserRole } from '../domain/models.js';
import * as userRepository from '../repositories/userRepository.js';
import { toPublicUser } from '../repositories/userRepository.js';

export interface SessionToken {
  token: string;
  expiresInSeconds: number;
}

interface TokenPayload {
  sub: string;
  role: UserRole;
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function issueToken(user: PublicUser): SessionToken {
  const payload: TokenPayload = { sub: user.id, role: user.role };
  const token = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
  const decoded = jwt.decode(token);
  const expiresInSeconds =
    decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
      ? decoded.exp - Math.floor(Date.now() / 1000)
      : SEVEN_DAYS_SECONDS;
  return { token, expiresInSeconds };
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ user: PublicUser; session: SessionToken }> {
  const email = normaliseEmail(input.email);
  if (userRepository.findByEmail(email)) {
    throw conflict('An account with this email already exists.');
  }

  const passwordHash = await bcrypt.hash(input.password, config.security.bcryptRounds);

  let row;
  try {
    row = userRepository.insertUser({
      id: newId(),
      email,
      passwordHash,
      name: input.name.trim(),
      // Role is never taken from the request body: self-service signup is always
      // a plain USER. Admins are created by seeding or by another admin.
      role: 'USER',
      createdAt: Date.now(),
    });
  } catch (error) {
    // The unique index is the real guarantee; the lookup above is only a nicety.
    if (isUniqueViolation(error)) throw conflict('An account with this email already exists.');
    throw error;
  }

  const user = toPublicUser(row);
  return { user, session: issueToken(user) };
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: PublicUser; session: SessionToken }> {
  const email = normaliseEmail(input.email);
  const row = userRepository.findByEmail(email);

  // Always run a hash comparison so that a missing account and a wrong password
  // take the same amount of time.
  const hash = row?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const matches = await bcrypt.compare(input.password, hash);

  if (!row || !matches) throw unauthorized('Incorrect email or password.');

  const user = toPublicUser(row);
  return { user, session: issueToken(user) };
}

export function verifyToken(token: string): { userId: string; role: UserRole } {
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw unauthorized('Invalid session token.');
    }
    return { userId: payload.sub, role: (payload as TokenPayload).role };
  } catch {
    throw unauthorized('Your session is invalid or has expired.');
  }
}

/** Loads the user afresh so a deleted or role-changed account cannot keep using an old token. */
export function currentUser(userId: string): PublicUser {
  const row = userRepository.findById(userId);
  if (!row) throw unauthorized('Your session is no longer valid.');
  return toPublicUser(row);
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) throw badRequest('Password must be at least 8 characters long.');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}
