/**
 * Drops every table, re-applies the migrations and re-seeds.
 *
 *   npm run db:reset
 *
 * Works against any PostgreSQL — the Docker Compose service or the embedded
 * PGlite server — because it only issues SQL and then shells out to Prisma.
 * Refuses to run in production.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/env.js';
import { prisma } from '../src/lib/prisma.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  if (env.isProduction) {
    process.stderr.write('Refusing to reset the database with NODE_ENV=production.\n');
    process.exit(1);
  }

  process.stdout.write('· dropping the public schema\n');
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  await prisma.$disconnect();

  const run = (args: string[]) => {
    process.stdout.write(`· ${args.join(' ')}\n`);
    execFileSync('npx', args, { cwd: appRoot, stdio: 'inherit', shell: process.platform === 'win32' });
  };

  process.env.FORCE_SEED = 'true';
  run(['prisma', 'migrate', 'deploy']);
  run(['tsx', 'src/seed/index.ts']);
}

main().catch(async (error) => {
  process.stderr.write(`Reset failed: ${String(error)}\n`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
