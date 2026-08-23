/**
 * Zero-install PostgreSQL for local development.
 *
 * Docker Compose remains the recommended way to run TableFlow, but not every
 * machine has Docker. This script boots PGlite — a real PostgreSQL build
 * compiled to WebAssembly — and exposes it on a TCP port speaking the genuine
 * Postgres wire protocol, so Prisma, psql and the API all talk to it unmodified.
 *
 *   npm run db:local        # keeps running; leave it in its own terminal
 *
 * PGlite is a single-backend database, so clients are served strictly one at a
 * time and the rest queue. That is enough for development and for the demo, and
 * it is why the API's DATABASE_URL carries connection_limit=1.
 *
 * Data is persisted under apps/api/.pgdata.
 */
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketHandler } from '@electric-sql/pglite-socket';
import { applyMigrations } from './embedded-migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.EMBEDDED_PG_DIR ?? path.resolve(__dirname, '..', '.pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const host = process.env.EMBEDDED_PG_HOST ?? '127.0.0.1';
const verbose = process.env.EMBEDDED_PG_VERBOSE === 'true';
const queueTimeoutMs = Number(process.env.EMBEDDED_PG_QUEUE_TIMEOUT_MS ?? 8000);
const idleTimeoutMs = Number(process.env.EMBEDDED_PG_IDLE_TIMEOUT_MS ?? 120_000);

function log(message: string) {
  process.stdout.write(`[db:local] ${message}\n`);
}

async function main() {
  log(`booting embedded PostgreSQL in ${dataDir}`);
  const db = await PGlite.create({ dataDir });
  await db.waitReady;

  // Migrations run here rather than through `prisma migrate deploy`, which
  // needs two concurrent connections that a single PGlite backend cannot give.
  const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');
  const { applied, alreadyApplied } = await applyMigrations(db, migrationsDir);
  if (applied.length > 0) {
    log(`applied ${applied.length} migration(s): ${applied.join(', ')}`);
  } else {
    log(`schema up to date (${alreadyApplied} migration(s) already applied)`);
  }

  let connectionCount = 0;

  /**
   * Serves one client to completion. A socket is created paused (no 'data'
   * listener yet), so bytes that arrive while a client waits its turn are
   * buffered by Node rather than dropped.
   */
  function serve(socket: net.Socket, id: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const handler = new PGLiteSocketHandler({ db, closeOnDetach: true, debug: verbose });

      let attached = false;
      let released = false;
      let deathReason: string | null = null;

      /**
       * A client that never gets its turn is closed rather than left hanging.
       * Without this one tool that opens two connections at once (the Prisma
       * CLI does) would wedge the server for everything that follows.
       */
      const queueTimer = setTimeout(() => {
        if (attached || released) return;
        deathReason ??= 'waited too long for the single backend';
        log(`connection ${id} refused — another client holds the database`);
        if (!socket.destroyed) socket.destroy();
      }, queueTimeoutMs);

      const release = (reason: string) => {
        if (released) return;
        released = true;
        clearTimeout(queueTimer);
        if (verbose) log(`connection ${id} closed (${reason})`);
        try {
          handler.detach(true);
        } catch {
          // The handler may already have released the socket.
        }
        if (!socket.destroyed) socket.destroy();
        resolve();
      };

      /**
       * A socket can die *before* attach() has finished acquiring PGlite's
       * exclusive lock. Detaching at that point is worse than useless: the
       * handler's release callback does not exist yet, so the lock it later
       * takes is never given back and every subsequent client waits forever.
       * When that happens we record the reason and tear down once attach lands.
       */
      const finish = (reason: string) => {
        if (released) return;
        if (!attached) {
          deathReason ??= reason;
          return;
        }
        release(reason);
      };

      socket.once('close', () => finish('close'));
      socket.once('error', (error) => finish(`error: ${error.message}`));
      // A client that sends FIN and waits (as Prisma does after Terminate)
      // leaves the socket half-open: 'close' never fires, so without this the
      // handler would keep the lock and block every later client.
      socket.once('end', () => finish('end'));
      socket.once('timeout', () => {
        log(`connection ${id} idle for too long — reclaiming the database`);
        if (!socket.destroyed) socket.destroy();
        finish('idle timeout');
      });

      // attach() resolves once the handler holds the lock and is wired up — not
      // when the client leaves. The socket's own events end the connection.
      handler
        .attach(socket)
        .then(() => {
          attached = true;
          clearTimeout(queueTimer);
          if (deathReason) release(deathReason);
        })
        .catch((error: Error) => {
          attached = true;
          release(`attach failed: ${error.message}`);
        });
    });
  }

  // Each client gets its own handler. PGlite serialises them internally with an
  // exclusive lock, so a second client simply waits — no queue of our own, which
  // would deadlock a tool (such as the Prisma schema engine) that legitimately
  // opens two connections at once.
  const server = net.createServer((socket) => {
    const id = ++connectionCount;
    socket.setNoDelay(true);
    // A client killed mid-connection never sends FIN, so without keepalive the
    // server-side socket stays ESTABLISHED forever and holds the only backend.
    socket.setKeepAlive(true, 10_000);
    socket.setTimeout(idleTimeoutMs);
    if (verbose) log(`connection ${id} accepted`);
    void serve(socket, id);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  log(`ready on postgresql://postgres:postgres@${host}:${port}/postgres`);
  log('one client is served at a time; others queue automatically');
  log('migrations are applied on boot — use `npm run db:seed` for demo data');
  log('press Ctrl+C to stop');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, closing…`);
    server.close();
    try {
      await db.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`[db:local] failed to start: ${String(error)}\n`);
  process.exit(1);
});
