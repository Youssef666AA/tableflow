import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../env.js';

const BCRYPT_ROUNDS = env.isTest ? 4 : 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * QR table tokens are 256-bit URL-safe random strings. At that entropy an
 * attacker cannot enumerate tables, which is the whole point of never putting
 * /table/3 in the QR code.
 */
export function generateQrToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateOpaqueToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Stable pseudonymous identifier for an IP — enough to rate-limit, not enough to track. */
export function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return crypto.createHmac('sha256', env.JWT_SECRET).update(ip).digest('hex').slice(0, 32);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomId(prefix = ''): string {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

/** Deterministic fingerprint of an order payload, used to catch double-taps. */
export function fingerprintOrder(lines: unknown): string {
  return sha256(JSON.stringify(lines));
}
