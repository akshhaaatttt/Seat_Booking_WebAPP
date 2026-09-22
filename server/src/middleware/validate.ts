import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../domain/errors.js';

function formatIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Parses and *replaces* the request body with the validated, typed value. */
export function validateBody<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(badRequest('Please check the submitted values.', formatIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    throw badRequest('Invalid query parameters.', formatIssues(result.error));
  }
  return result.data;
}

/**
 * Express 4 does not forward rejected promises to the error handler, so every
 * async handler is wrapped once here instead of try/catching in each route.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Reads a route parameter. `noUncheckedIndexedAccess` types params as possibly
 * undefined; a missing one means the route was mounted wrongly, so it is a
 * programming error surfaced as a 400 rather than an unchecked cast.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`Missing "${name}" in the request path.`);
  }
  return value;
}
