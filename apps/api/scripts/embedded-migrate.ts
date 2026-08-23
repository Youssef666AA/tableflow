import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

/**
 * Applies Prisma migrations directly against an in-process PGlite instance.
 *
 * `prisma migrate deploy` opens two connections at once — one for its query
 * engine and one for the schema engine — while PGlite serves a single backend,
 * so running it over the socket deadlocks. Doing it in-process sidesteps that
 * entirely, and writes the same `_prisma_migrations` bookkeeping so the Prisma
 * CLI still reports the schema as up to date.
 */

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum"              VARCHAR(64) NOT NULL,
  "finished_at"           TIMESTAMPTZ,
  "migration_name"        VARCHAR(255) NOT NULL,
  "logs"                  TEXT,
  "rolled_back_at"        TIMESTAMPTZ,
  "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

export async function applyMigrations(db: PGlite, migrationsDir: string): Promise<MigrationResult> {
  await db.exec(MIGRATIONS_TABLE);

  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const existing = await db.query<{ migration_name: string }>(
    'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL',
  );
  const done = new Set(existing.rows.map((row) => row.migration_name));

  const applied: string[] = [];

  for (const name of names) {
    if (done.has(name)) continue;

    const file = path.join(migrationsDir, name, 'migration.sql');
    let sql: string;
    try {
      sql = await fs.readFile(file, 'utf8');
    } catch {
      continue; // Not a migration directory.
    }

    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const id = crypto.randomUUID();

    await db.query(
      'INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","started_at","applied_steps_count") VALUES ($1,$2,$3,now(),0)',
      [id, checksum, name],
    );

    try {
      await db.exec(sql);
    } catch (error) {
      await db.query('UPDATE "_prisma_migrations" SET "logs" = $1 WHERE "id" = $2', [
        String(error),
        id,
      ]);
      throw new Error(`Migration ${name} failed: ${String(error)}`);
    }

    await db.query(
      'UPDATE "_prisma_migrations" SET "finished_at" = now(), "applied_steps_count" = 1 WHERE "id" = $1',
      [id],
    );
    applied.push(name);
  }

  return { applied, alreadyApplied: done.size };
}
