import { env } from '../env.js';
import { logger } from '../lib/logger.js';

/**
 * Background work runs on BullMQ + Redis when a REDIS_URL is configured, and on
 * an in-process scheduler when it is not.
 *
 * The fallback is a real scheduler, not a stub: the same handlers run on the
 * same cadence. What it gives up is durability and cross-process fan-out, which
 * is exactly the trade a single-node dev or demo box should make. Nothing in the
 * product requires Redis to be present.
 */

export type JobName =
  | 'sessions:sweep-expired'
  | 'inventory:scan-low-stock'
  | 'kitchen:check-sla'
  | 'maintenance:prune';

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

interface RepeatSpec {
  name: JobName;
  everyMs: number;
}

const REPEATING_JOBS: RepeatSpec[] = [
  { name: 'sessions:sweep-expired', everyMs: 60_000 },
  { name: 'inventory:scan-low-stock', everyMs: 5 * 60_000 },
  { name: 'kitchen:check-sla', everyMs: 60_000 },
  { name: 'maintenance:prune', everyMs: 60 * 60_000 },
];

const handlers = new Map<JobName, JobHandler>();

export function registerJob(name: JobName, handler: JobHandler): void {
  handlers.set(name, handler);
}

async function runHandler(name: JobName, data: Record<string, unknown> = {}): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ job: name }, 'no handler registered for job');
    return;
  }
  const startedAt = Date.now();
  try {
    await handler(data);
    logger.debug({ job: name, ms: Date.now() - startedAt }, 'job completed');
  } catch (error) {
    logger.error({ job: name, err: error }, 'job failed');
  }
}

interface Driver {
  readonly kind: 'redis' | 'in-process';
  enqueue(name: JobName, data?: Record<string, unknown>, delayMs?: number): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
}

class InProcessDriver implements Driver {
  readonly kind = 'in-process' as const;
  private timers: NodeJS.Timeout[] = [];
  private started = false;

  async enqueue(name: JobName, data: Record<string, unknown> = {}, delayMs = 0): Promise<void> {
    if (delayMs > 0) {
      const timer = setTimeout(() => void runHandler(name, data), delayMs);
      timer.unref?.();
      this.timers.push(timer);
      return;
    }
    // Yield to the event loop so enqueueing never blocks the request that triggered it.
    setImmediate(() => void runHandler(name, data));
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const spec of REPEATING_JOBS) {
      const timer = setInterval(() => void runHandler(spec.name, {}), spec.everyMs);
      timer.unref?.();
      this.timers.push(timer);
    }
    logger.info({ jobs: REPEATING_JOBS.map((j) => j.name) }, 'in-process scheduler started');
  }

  async close(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];
    this.started = false;
  }
}

class RedisDriver implements Driver {
  readonly kind = 'redis' as const;
  private queue: import('bullmq').Queue | null = null;
  private worker: import('bullmq').Worker | null = null;
  private connection: import('ioredis').Redis | null = null;

  constructor(private readonly url: string) {}

  private async ensureQueue() {
    if (this.queue) return this.queue;
    const { Queue } = await import('bullmq');
    const { Redis } = await import('ioredis');
    const connection = new Redis(this.url, { maxRetriesPerRequest: null });
    this.connection = connection;
    this.queue = new Queue('tableflow', { connection });
    return this.queue;
  }

  async enqueue(name: JobName, data: Record<string, unknown> = {}, delayMs = 0): Promise<void> {
    const queue = await this.ensureQueue();
    await queue.add(name, data, {
      delay: delayMs,
      removeOnComplete: 500,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  async start(): Promise<void> {
    const queue = await this.ensureQueue();
    const { Worker } = await import('bullmq');

    for (const spec of REPEATING_JOBS) {
      await queue.add(
        spec.name,
        {},
        {
          repeat: { every: spec.everyMs },
          jobId: `repeat:${spec.name}`,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    }

    const connection = this.connection;
    if (!connection) throw new Error('Redis connection was not established');

    this.worker = new Worker(
      'tableflow',
      async (job) => runHandler(job.name as JobName, job.data as Record<string, unknown>),
      { connection, concurrency: 4 },
    );
    logger.info('bullmq worker started');
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }
}

let driver: Driver = new InProcessDriver();
let initialised = false;

export async function initQueue(options: { startWorker: boolean }): Promise<void> {
  if (initialised) return;
  initialised = true;

  if (env.REDIS_URL) {
    try {
      const redisDriver = new RedisDriver(env.REDIS_URL);
      // Probe now so we fail over immediately rather than at first use.
      const { Redis } = await import('ioredis');
      const probe = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      await probe.connect();
      await probe.ping();
      probe.disconnect();
      driver = redisDriver;
      logger.info('queue driver: redis (bullmq)');
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : error },
        'redis unreachable — falling back to the in-process scheduler',
      );
      driver = new InProcessDriver();
    }
  } else {
    logger.info('queue driver: in-process (no REDIS_URL configured)');
  }

  if (options.startWorker) {
    await driver.start();
  }
}

export function queueKind(): 'redis' | 'in-process' {
  return driver.kind;
}

export async function enqueueJob(
  name: JobName,
  data: Record<string, unknown> = {},
  delayMs = 0,
): Promise<void> {
  await driver.enqueue(name, data, delayMs);
}

export async function closeQueue(): Promise<void> {
  await driver.close();
  initialised = false;
}
