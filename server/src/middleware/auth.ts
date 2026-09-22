import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config/index.js';
import { forbidden, unauthorized } from '../domain/errors.js';
import type { PublicUser } from '../domain/models.js';
import * as authService from '../services/authService.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

function readToken(req: Request): string | null {
  const cookieToken = req.cookies?.[config.jwt.cookieName];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  const header = req.get('authorization');
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return null;
}

/** Populates req.user when a valid session exists; never rejects. */
export const attachUser: RequestHandler = (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    const { userId } = authService.verifyToken(token);
    // Re-read from the database so a deleted or demoted account cannot keep
    // acting on a token that was issued earlier.
    req.user = authService.currentUser(userId);
  } catch {
    // An invalid token is treated as "not signed in" for optional-auth routes.
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') return next(forbidden('Administrator access required.'));
  next();
};

/** Narrowing helper so handlers do not have to re-check `req.user`. */
export function authedUser(req: Request): PublicUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.cookie(config.jwt.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: maxAgeSeconds * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.jwt.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}

export function noop(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
