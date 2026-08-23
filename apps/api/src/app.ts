import express, { type Express, type RequestHandler } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { errorHandler, notFoundHandler, rateLimits, requestId } from './middleware/common.js';
import { queueKind } from './queue/index.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { billingRouter } from './routes/billing.js';
import { customerRouter } from './routes/customer.js';
import { devRouter } from './routes/dev.js';
import { employeesRouter } from './routes/employees.js';
import { inventoryRouter } from './routes/inventory.js';
import { kitchenRouter } from './routes/kitchen.js';
import { menuRouter } from './routes/menu.js';
import { auditRouter, notificationsRouter, promotionsRouter, reviewsRouter } from './routes/misc.js';
import { ordersRouter } from './routes/orders.js';
import { serviceRequestsRouter } from './routes/service-requests.js';
import { settingsRouter } from './routes/settings.js';
import { tablesRouter } from './routes/tables.js';

export function createApp(): Express {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON, PDFs and QR images — never HTML — so a strict
      // default CSP is safe here. The web app ships its own headers.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  /** Any loopback origin is fine outside production — dev servers move ports. */
  const isLoopback = (origin: string) =>
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and originless requests (curl, health checks) pass through.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        if (!env.isProduction && isLoopback(origin)) return callback(null, true);
        // Refuse the CORS headers without throwing: an unexpected origin is a
        // client mistake, not a server fault, and must not surface as a 500.
        callback(null, false);
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(requestId);

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as unknown as { requestId?: string }).requestId ?? '',
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }) as unknown as RequestHandler,
    );
  }

  app.get('/api/health', async (_req, res) => {
    let database = 'down';
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = 'up';
    } catch {
      database = 'down';
    }
    res.status(database === 'up' ? 200 : 503).json({
      status: database === 'up' ? 'ok' : 'degraded',
      service: 'tableflow-api',
      environment: env.NODE_ENV,
      demoMode: env.demoMode,
      database,
      queue: queueKind(),
      time: new Date().toISOString(),
    });
  });

  app.use('/api', rateLimits.global);

  // Public + customer surface
  app.use('/api', customerRouter);
  app.use('/api/auth', authRouter);

  // Staff & management surface
  app.use('/api/tables', tablesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/kitchen', kitchenRouter);
  app.use('/api/service-requests', serviceRequestsRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/promotions', promotionsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/dev', devRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
