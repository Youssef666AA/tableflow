import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000';
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'TableFlow!2024';

export interface DevTable {
  id: string;
  number: string;
  token: string | null;
  qrUrl: string | null;
}

export interface DevBranch {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  tables: DevTable[];
}

/**
 * Reads the QR Test Center to find a real table token, exactly as a developer
 * would when they cannot print a code. Fails loudly if the demo data is absent.
 */
export async function findBranch(request: APIRequestContext, nameFragment = 'Sousse'): Promise<DevBranch> {
  const response = await request.get(`${API}/api/dev/qr-test-center`);
  expect(
    response.ok(),
    'The QR Test Center is unavailable. Is the API running with DEMO_MODE=true and the database seeded?',
  ).toBeTruthy();

  const body = (await response.json()) as { restaurants: Array<{ branches: DevBranch[] }> };
  const branch = body.restaurants[0]?.branches.find((b) => b.name.includes(nameFragment));
  expect(branch, `No branch matching "${nameFragment}" — run \`npm run db:seed\`.`).toBeTruthy();
  return branch!;
}

/** A table with no live session, so each test starts from a clean seat. */
export async function findFreeTable(request: APIRequestContext, branch: DevBranch): Promise<DevTable> {
  const response = await request.get(`${API}/api/dev/qr-test-center`);
  const body = (await response.json()) as {
    restaurants: Array<{ branches: Array<DevBranch & { tables: Array<DevTable & { activeSession: unknown }> }> }>;
  };
  const live = body.restaurants[0].branches.find((b) => b.id === branch.id)!;
  const free = live.tables.find((table) => table.token && !table.activeSession);
  expect(free, 'Every table already has a live session — reseed with `npm run db:reset`.').toBeTruthy();
  return free!;
}

/** Scans into a table and clears the location gate using the demo shortcut. */
export async function seatGuest(page: Page, table: DevTable): Promise<void> {
  await page.goto(`/t/${table.token}`);

  const simulate = page.getByRole('button', { name: /simulate being at the restaurant/i });
  await expect(simulate).toBeVisible();
  await simulate.click();

  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.getByRole('heading', { name: /what can we get you/i })).toBeVisible();
}

/** Signs a staff member in through the real login form. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/staff/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/staff\/login/);
}
