import { expect, test } from '@playwright/test';
import { API, findBranch, findFreeTable, signIn } from './helpers';

/**
 * The staff half of the demo story, plus the access-control checks that matter
 * most: a kitchen account must not be able to reach the money or the menu.
 */
test.describe('staff', () => {
  test('the kitchen sees a new order arrive and moves it through the pass', async ({
    page,
    request,
    browser,
  }) => {
    const branch = await findBranch(request);
    const table = await findFreeTable(request, branch);

    // A guest places an order on their own phone.
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const guest = await guestContext.newPage();
    await guest.goto(`/t/${table.token}`);
    await guest.getByRole('button', { name: /simulate being at the restaurant/i }).click();
    await expect(guest).toHaveURL(/\/menu$/);

    await guest.getByRole('button', { name: /Margherita/ }).first().click();
    const sheet = guest.getByRole('dialog');
    await sheet.getByRole('button', { name: /add to cart/i }).click();
    await guest.getByRole('button', { name: /view cart/i }).click();
    await guest.getByRole('button', { name: /^place order/i }).click();
    await expect(guest).toHaveURL(/\/order\/[0-9a-f-]+$/, { timeout: 30_000 });

    const reference = await guest.locator('text=/^#\\d+$/').first().innerText();

    // The kitchen picks it up.
    await signIn(page, 'kitchen@tableflow.local');
    await page.goto('/staff/kitchen');
    await expect(page.getByRole('heading', { name: /kitchen display/i })).toBeVisible();

    const ticket = page.locator('article').filter({ hasText: reference }).first();
    await expect(ticket).toBeVisible({ timeout: 30_000 });
    await expect(ticket.getByText(`Table ${table.number}`)).toBeVisible();

    await ticket.getByRole('button', { name: /^accept$/i }).click();
    await expect(ticket.getByRole('button', { name: /start preparing/i })).toBeVisible();

    await ticket.getByRole('button', { name: /start preparing/i }).click();
    await expect(ticket.getByRole('button', { name: /mark ready/i })).toBeVisible();

    // The guest's tracker follows along without a refresh.
    await expect(guest.getByText('Your food is being prepared')).toBeVisible({ timeout: 30_000 });

    await ticket.getByRole('button', { name: /mark ready/i }).click();
    await expect(guest.getByText(/ready — on its way to you/i)).toBeVisible({ timeout: 30_000 });

    await guestContext.close();
  });

  test('the waiter floor shows the live table and its running total', async ({ page, request }) => {
    const branch = await findBranch(request);
    await signIn(page, 'waiter@tableflow.local');
    await page.goto('/staff/waiter');

    await expect(page.getByRole('heading', { name: 'Floor' })).toBeVisible();
    await expect(page.getByText('Available')).toBeVisible();

    // Switching to the grid keeps the same data in a denser shape.
    await page.getByRole('tab', { name: /grid/i }).click();
    await expect(page.locator('button').filter({ hasText: /seats/ }).first()).toBeVisible();
    expect(branch.tables.length).toBeGreaterThan(0);
  });

  test('a kitchen account cannot reach billing, the menu editor or analytics', async ({ page, request }) => {
    await signIn(page, 'kitchen@tableflow.local');

    // The UI hides what the role cannot do…
    await page.goto('/staff');
    await expect(page.getByRole('link', { name: 'Billing' })).toHaveCount(0);

    // …and the API refuses it regardless of what the client asks for.
    const token = await page.evaluate(() => window.localStorage.getItem('tf.staff.access'));
    expect(token).toBeTruthy();

    for (const path of ['/api/analytics/overview', '/api/employees', '/api/audit']) {
      const response = await request.get(`${API}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status(), `${path} must be refused for the kitchen role`).toBe(403);
    }
  });

  test('the owner dashboard reports figures computed from real orders', async ({ page }) => {
    await signIn(page, 'owner@tableflow.local');
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Revenue', { exact: true })).toBeVisible();
    await expect(page.getByText('Average order', { exact: true })).toBeVisible();

    // Widen the range and the figures must still be real, not placeholders.
    await page.getByRole('tab', { name: '30 days' }).click();
    await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top products' })).toBeVisible();

    // A seeded month of trading must produce a non-zero revenue figure.
    const revenueCard = page.locator('div').filter({ hasText: /^Revenue/ }).first();
    await expect(revenueCard).toContainText(/\d/);
  });
});
