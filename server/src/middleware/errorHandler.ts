import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../domain/errors.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}` },
  });
};

/**
 * The single exit point for every failure. Deliberate failures (AppError) keep
 * their status and message; anything else is logged with its stack and reported
 * as a generic 500, so internal details never leak to clients.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error('request failed', { path: req.path, code: error.code, message: error.message });
    } else {
      logger.debug('request rejected', {
        path: req.path,
        status: error.statusCode,
        code: error.code,
      });
    }
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    });
    return;
  }

  logger.error('unhandled error', {
    path: req.path,
    method: req.method,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
};
