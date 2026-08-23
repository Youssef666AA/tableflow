import jwt from 'jsonwebtoken';
import type { Role } from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from './errors.js';

export interface AccessTokenPayload {
  sub: string;
  restaurantId: string;
  membershipId: string;
  role: Role;
  branchIds: string[];
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  familyId: string;
  typ: 'refresh';
}

/**
 * The customer's bearer credential for a table session. It carries no table
 * number a client could tamper with — only an opaque session id the server
 * re-resolves (and re-validates) on every request.
 */
export interface SessionTokenPayload {
  sid: string;
  /** Device row id — location is proven per phone, not per table. */
  did: string;
  tv: number;
  typ: 'session';
}

const ISSUER = 'tableflow';

export function signAccessToken(payload: Omit<AccessTokenPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'access' }, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: 'staff',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: 'staff',
    }) as AccessTokenPayload;
    if (decoded.typ !== 'access') throw new Error('wrong token type');
    return decoded;
  } catch {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: ISSUER,
    audience: 'staff-refresh',
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: ISSUER,
      audience: 'staff-refresh',
    }) as RefreshTokenPayload;
    if (decoded.typ !== 'refresh') throw new Error('wrong token type');
    return decoded;
  } catch {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }
}

export function signSessionToken(
  sessionId: string,
  deviceId: string,
  tokenVersion: number,
  ttlSeconds: number,
): string {
  return jwt.sign({ sid: sessionId, did: deviceId, tv: tokenVersion, typ: 'session' }, env.JWT_SESSION_SECRET, {
    expiresIn: Math.max(60, Math.floor(ttlSeconds)),
    issuer: ISSUER,
    audience: 'table-session',
  } as jwt.SignOptions);
}

export function verifySessionToken(token: string): SessionTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SESSION_SECRET, {
      issuer: ISSUER,
      audience: 'table-session',
    }) as SessionTokenPayload;
    if (decoded.typ !== 'session') throw new Error('wrong token type');
    return decoded;
  } catch {
    throw new AppError('SESSION_EXPIRED', 'Your table session has expired. Please scan the QR code again.');
  }
}
