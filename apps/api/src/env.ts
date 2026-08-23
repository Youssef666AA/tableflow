import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..', '..');

// App-level .env wins, repo root fills in the gaps.
for (const candidate of [path.join(appRoot, '.env'), path.join(repoRoot, '.env')]) {
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_URL: z.string().default('http://localhost:4000'),
  WEB_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : null)),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_SESSION_SECRET: z.string().min(16, 'JWT_SESSION_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  DEMO_MODE: bool(false),
  SEED_PASSWORD: z.string().min(8).default('TableFlow!2024'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  RUN_WORKER_IN_PROCESS: bool(true),

  INTEGRATION_EMAIL_ENABLED: bool(false),
  INTEGRATION_WHATSAPP_ENABLED: bool(false),
  INTEGRATION_STRIPE_ENABLED: bool(false),
  INTEGRATION_MAPS_ENABLED: bool(false),
  INTEGRATION_AI_ENABLED: bool(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

if (isProduction) {
  const weak = ['change-me', 'dev-only', 'secret', 'password'];
  for (const [key, value] of Object.entries({
    JWT_SECRET: raw.JWT_SECRET,
    JWT_REFRESH_SECRET: raw.JWT_REFRESH_SECRET,
    JWT_SESSION_SECRET: raw.JWT_SESSION_SECRET,
  })) {
    if (weak.some((w) => value.toLowerCase().includes(w))) {
      throw new Error(`${key} still contains a development placeholder. Refusing to start in production.`);
    }
  }
}

export const env = {
  ...raw,
  isProduction,
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  /**
   * Demo mode unlocks the QR Test Center and the "simulate location" shortcut.
   * It can never be on in production, whatever the .env file says.
   */
  demoMode: raw.DEMO_MODE && !isProduction,
  corsOrigins: [raw.WEB_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'].filter(
    (v, i, arr) => v && arr.indexOf(v) === i,
  ),
  integrations: {
    email: raw.INTEGRATION_EMAIL_ENABLED,
    whatsapp: raw.INTEGRATION_WHATSAPP_ENABLED,
    stripe: raw.INTEGRATION_STRIPE_ENABLED,
    maps: raw.INTEGRATION_MAPS_ENABLED,
    ai: raw.INTEGRATION_AI_ENABLED,
  },
} as const;

export type Env = typeof env;
