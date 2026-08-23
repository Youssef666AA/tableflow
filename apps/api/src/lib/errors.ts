export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'GONE'
  | 'RATE_LIMITED'
  | 'UNPROCESSABLE'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE'
  // Domain-specific codes the client branches on.
  | 'QR_INVALID'
  | 'QR_REVOKED'
  | 'SESSION_EXPIRED'
  | 'SESSION_CLOSED'
  | 'SESSION_BLOCKED'
  | 'LOCATION_REQUIRED'
  | 'LOCATION_OUT_OF_RANGE'
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'ORDER_LIMIT_REACHED'
  | 'DUPLICATE_ORDER'
  | 'INVALID_TRANSITION'
  | 'INSUFFICIENT_STOCK'
  | 'ALREADY_PAID'
  | 'DEMO_DISABLED';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
  QR_INVALID: 404,
  QR_REVOKED: 410,
  SESSION_EXPIRED: 410,
  SESSION_CLOSED: 410,
  SESSION_BLOCKED: 403,
  LOCATION_REQUIRED: 403,
  LOCATION_OUT_OF_RANGE: 403,
  RESTAURANT_CLOSED: 409,
  ITEM_UNAVAILABLE: 409,
  ORDER_LIMIT_REACHED: 429,
  DUPLICATE_ORDER: 409,
  INVALID_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  ALREADY_PAID: 409,
  DEMO_DISABLED: 403,
};

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;
  expose: boolean;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.details = details;
    this.expose = this.status < 500;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError('BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required.') {
    return new AppError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have access to this resource.') {
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Not found.') {
    return new AppError('NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError('CONFLICT', message, details);
  }
  static internal(message = 'Something went wrong on our side.') {
    return new AppError('INTERNAL', message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
