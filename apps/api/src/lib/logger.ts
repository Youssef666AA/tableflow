import pino from 'pino';
import { env } from '../env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'tableflow-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.refreshToken',
      'req.body.token',
      'req.body.cardNumber',
      'req.body.cvc',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  transport:
    env.isDevelopment && !env.isTest
      ? { target: 'pino/file', options: { destination: 1 } }
      : undefined,
});

export type Logger = typeof logger;
