import 'dotenv/config';
import path from 'node:path';

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, received "${raw}"`);
  }
  return parsed;
}

const nodeEnv = str('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const jwtSecret = str('JWT_SECRET', 'dev-only-insecure-secret-change-me');

if (isProduction && jwtSecret === 'dev-only-insecure-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong secret when NODE_ENV=production');
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: int('PORT', 4000),
  databasePath: path.resolve(process.cwd(), str('DATABASE_PATH', './data/seatbooking.db')),
  jwt: {
    secret: jwtSecret,
    expiresIn: str('JWT_EXPIRES_IN', '7d'),
    cookieName: 'sb_session',
  },
  clientOrigin: str('CLIENT_ORIGIN', 'http://localhost:5173'),
  holds: {
    durationSeconds: int('HOLD_DURATION_SECONDS', 300),
    sweepIntervalSeconds: int('HOLD_SWEEP_INTERVAL_SECONDS', 30),
    maxSeatsPerHold: int('MAX_SEATS_PER_HOLD', 8),
  },
  bookings: {
    cancellationCutoffMinutes: int('CANCELLATION_CUTOFF_MINUTES', 60),
  },
  realtime: {
    heartbeatIntervalSeconds: 25,
  },
  security: {
    bcryptRounds: nodeEnv === 'test' ? 4 : 12,
  },
} as const;

export type AppConfig = typeof config;
