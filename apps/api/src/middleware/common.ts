import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { ZodError, type ZodSchema } from 'zod';
import { Prisma } from '@prisma/client';
import { PricingError } from '@tableflow/shared';
import { env } from '../env.js';
import { AppError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

type Source = 'body' | 'query' | 'params';

/** Validates and *replaces* the request payload with the parsed, typed value. */
export function validate<T>(schema: ZodSchema<T>, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError('VALIDATION_ERROR', 'Please check the highlighted fields.', formatZod(result.error)),
      );
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      // req.query and req.params are getter-only in Express 5-style setups.
      Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    }
    next();
  };
}

function formatZod(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_',
    message: issue.message,
    code: issue.code,
  }));
}

/** Identifies a customer by table session when present, otherwise by IP. */
function customerKey(req: Request): string {
  if (req.customer?.sessionId) return `session:${req.customer.sessionId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

function limiter(options: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Rate limiting is a safety net, not a test obstacle.
    skip: () => env.isTest,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.'));
    },
    ...options,
  });
}

export const rateLimits = {
  /** Broad protection for the whole API surface. */
  global: limiter({ windowMs: 60_000, limit: 600 }),
  /** Credential stuffing protection. */
  login: limiter({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}:${String((req.body as { email?: string })?.email ?? '')}`,
  }),
  /** QR scans — generous, but stops someone brute-forcing table tokens. */
  scan: limiter({ windowMs: 60_000, limit: 30 }),
  /** Section 10: at most 10 order submissions per minute per session. */
  orderCreate: limiter({ windowMs: 60_000, limit: 10, keyGenerator: customerKey }),
  /** Stops a customer spamming the waiter call button. */
  serviceRequest: limiter({ windowMs: 60_000, limit: 8, keyGenerator: customerKey }),
  /** Everything else a customer device can do. */
  customer: limiter({ windowMs: 60_000, limit: 240, keyGenerator: customerKey }),
  /** Write operations from the admin console. */
  write: limiter({ windowMs: 60_000, limit: 180 }),
};

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`No route matches ${req.method} ${req.path}`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let appError: AppError;

  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError('VALIDATION_ERROR', 'Please check the highlighted fields.', formatZod(error));
  } else if (error instanceof PricingError) {
    appError = new AppError('ITEM_UNAVAILABLE', error.message, { pricingCode: error.code, ...error.details });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    appError = mapPrismaError(error);
  } else {
    appError = AppError.internal();
  }

  if (appError.status >= 500) {
    logger.error({ err: error, requestId: req.requestId, path: req.path }, 'unhandled error');
  } else {
    logger.debug({ code: appError.code, requestId: req.requestId, path: req.path }, 'request rejected');
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? undefined,
      requestId: req.requestId,
    },
  });
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string | undefined) ?? [];
      const fields = Array.isArray(target) ? target.join(', ') : String(target);
      return AppError.conflict(`That value is already taken${fields ? ` (${fields})` : ''}.`);
    }
    case 'P2003':
      return AppError.conflict('This record is still referenced by other data.');
    case 'P2025':
      return AppError.notFound('That record no longer exists.');
    default:
      logger.error({ err: error }, 'unmapped prisma error');
      return AppError.internal();
  }
}
