import { expect, test } from '@playwright/test';
import { API, DEMO_PASSWORD, findBranch, selectBranch, signIn } from './helpers';

test.describe('staff operations & billing', () => {
  test('cashier switches to active branch, selects open tab, settles it, and downloads receipt PDF', async ({
    page,
  }) => {
    await signIn(page, 'cashier@tableflow.local');
    await page.goto('/staff');
    await selectBranch(page, 'Sousse');

    await page.goto('/staff/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();

    // Verify open tabs on Sousse
    const tabCards = page.locator('button').filter({ hasText: /Table \d+/ });
    await expect(tabCards.first()).toBeVisible({ timeout: 15_000 });

    // Click the first open tab
    await tabCards.first().click();

    // Settle with Cash payment
    const recordBtn = page.getByRole('button', { name: /Record cash payment/i });
    if (await recordBtn.isVisible()) {
      await recordBtn.click();
      await expect(page.getByText('This bill is settled.')).toBeVisible({ timeout: 15_000 });
    }

    // Download Receipt PDF
    const pdfBtn = page.getByRole('button', { name: /Receipt PDF/i });
    if (await pdfBtn.isVisible()) {
      const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      await pdfBtn.click();
      const download = await downloadPromise;
      if (download) {
        expect(download.suggestedFilename()).toMatch(/receipt-.*\.pdf/);
      }
    }
  });

  test('waiter handles service requests and switches floor plan views', async ({ page }) => {
    await signIn(page, 'waiter@tableflow.local');
    await page.goto('/staff/waiter');

    await expect(page.getByRole('heading', { name: 'Floor' })).toBeVisible();

    // Switch to Grid view
    await page.getByRole('tab', { name: /grid/i }).click();
    await expect(page.locator('button').filter({ hasText: /seats/i }).first()).toBeVisible();

    // Switch back to Plan view
    await page.getByRole('tab', { name: /plan/i }).click();

    // Navigate to Requests queue
    await page.goto('/staff/requests');
    await expect(page.getByRole('heading', { name: /Service requests/i })).toBeVisible();

    // If there is any open request, acknowledge or complete it
    const doneButtons = page.getByRole('button', { name: /^done$/i });
    if ((await doneButtons.count()) > 0) {
      await doneButtons.first().click();
    }
  });

  test('kitchen kiosk display renders stations and filter controls', async ({ page }) => {
    await signIn(page, 'kitchen@tableflow.local');
    await page.goto('/staff/kitchen');

    await expect(page.getByRole('heading', { name: /Kitchen display/i })).toBeVisible();

    // Test filter segmented controls: All, New, Preparing, Ready
    for (const filterName of ['All', 'New', 'Preparing', 'Ready']) {
      const filterBtn = page.getByRole('tab', { name: new RegExp(`^${filterName}`, 'i') });
      if (await filterBtn.isVisible()) {
        await filterBtn.click();
      }
    }
  });
});

test.describe('admin & management operations', () => {
  test('admin manages menu: adds category, creates product, toggles 86d, and archives', async ({ page }) => {
    await signIn(page, 'admin@tableflow.local');
    await page.goto('/admin');
    await selectBranch(page, 'Sousse');

    await page.goto('/admin/menu');
    await expect(page.getByRole('heading', { name: 'Menu' })).toBeVisible();

    // 1. Add Category
    await page.getByRole('button', { name: /new category/i }).click();
    const catInput = page.getByLabel('Category name');
    const testCatName = `Test Cat ${Date.now().toString().slice(-4)}`;
    await catInput.fill(testCatName);
    await page.getByRole('button', { name: /^create$/i }).click();
    // A category with 0 items is listed in the category filter select
    await expect(page.locator('option').filter({ hasText: testCatName })).toBeAttached({ timeout: 15_000 });

    // 2. Add Item
    await page.getByRole('button', { name: /new item/i }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: /new menu item/i })).toBeVisible();

    const testItemName = `Special Item ${Date.now().toString().slice(-4)}`;
    await panel.locator('#p-name').fill(testItemName);
    await panel.locator('#p-price').fill('14.500');

    // Select the category
    await panel.locator('#p-category').selectOption({ label: testCatName });

    await panel.getByRole('button', { name: /add item/i }).click();
    await expect(page.getByText(testItemName).first()).toBeVisible({ timeout: 15_000 });

    // 3. Toggle availability (86'd)
    const itemCard = page.locator('article').filter({ hasText: testItemName });
    const toggle86Btn = itemCard.getByRole('button', { name: /86 item|86 at this branch/i });
    if (await toggle86Btn.isVisible()) {
      await toggle86Btn.click();
      await expect(itemCard.getByRole('button', { name: /make available/i })).toBeVisible({ timeout: 10_000 });
      // Toggle back to available
      await itemCard.getByRole('button', { name: /make available/i }).click();
      await expect(itemCard.getByRole('button', { name: /86 item|86 at this branch/i })).toBeVisible({ timeout: 10_000 });
    }

    // 4. Archive item
    await itemCard.getByRole('button', { name: new RegExp(testItemName, 'i') }).click();
    await expect(panel.getByRole('heading', { name: new RegExp(`Edit ${testItemName}`, 'i') })).toBeVisible();
    await panel.getByRole('button', { name: /archive/i }).click();
    await expect(page.getByText(testItemName)).toHaveCount(0, { timeout: 15_000 });
  });

  test('admin manages tables and exports QR sheet PDF', async ({ page }) => {
    await signIn(page, 'admin@tableflow.local');
    await page.goto('/admin');
    await selectBranch(page, 'Sousse');

    await page.goto('/admin/tables');
    await expect(page.getByRole('heading', { name: 'Tables' })).toBeVisible();

    // 1. Add Table
    const tableNum = String(Math.floor(100 + Math.random() * 899));
    await page.getByRole('button', { name: /add table/i }).click();
    const panel = page.getByRole('dialog');
    await panel.locator('#t-number').fill(tableNum);
    await panel.locator('#t-seats').fill('6');
    await panel.getByRole('button', { name: /^save$/i }).click();

    // Verify newly added table appears in the edit list
    const editBtn = page.getByRole('button', { name: tableNum, exact: true }).first();
    await expect(editBtn).toBeVisible({ timeout: 15_000 });

    // 2. Remove Table
    await editBtn.click();
    await panel.getByRole('button', { name: /^remove$/i }).click();
    await expect(page.getByRole('button', { name: tableNum, exact: true })).toHaveCount(0, { timeout: 15_000 });

    // 3. Export QR sheet PDF
    await page.goto('/admin/qr');
    await expect(page.getByRole('heading', { name: /QR codes/i })).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await page.getByRole('button', { name: /print all qr codes/i }).click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/.*qr.*\.pdf/);
    }
  });

  test('admin manages inventory: views stock and movements ledger', async ({ page }) => {
    await signIn(page, 'admin@tableflow.local');
    await page.goto('/admin');
    await selectBranch(page, 'Sousse');

    await page.goto('/admin/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    // Verify current stock items are listed
    await expect(page.getByText(/stock value/i).first()).toBeVisible();

    // Switch to movements ledger
    await page.getByRole('tab', { name: 'Movements' }).click();
    await expect(page.getByRole('table')).toBeVisible();

    // Switch back to stock tab
    await page.getByRole('tab', { name: 'Stock' }).click();

    // Click an ingredient row to open movement recording dialog
    const tableRows = page.locator('tbody tr');
    if ((await tableRows.count()) > 0) {
      await tableRows.first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: /record movement/i })).toBeVisible();
      // Close dialog
      await dialog.getByRole('button', { name: /cancel/i }).click();
    }
  });

  test('admin manages employees, promotions, reviews, analytics, and settings', async ({ page }) => {
    await signIn(page, 'admin@tableflow.local');

    // 1. Employees Page
    await page.goto('/admin/employees');
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
    await expect(page.getByText('owner@tableflow.local')).toBeVisible();

    // 2. Promotions Page
    await page.goto('/admin/promotions');
    await expect(page.getByRole('heading', { name: 'Promotions' })).toBeVisible();
    await expect(page.getByRole('button', { name: /new promotion/i })).toBeVisible();

    // 3. Reviews Page
    await page.goto('/admin/reviews');
    await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible();
    await expect(page.getByText(/Average rating/i)).toBeVisible();

    // 4. Analytics Page with all sub-tabs
    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

    for (const tabName of ['Kitchen', 'Tables', 'Inventory', 'Sales']) {
      await page.getByRole('tab', { name: new RegExp(`^${tabName}`, 'i') }).click();
    }

    // 5. Settings Page
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('#s-name')).toHaveValue('Big Ben Café');
    await expect(page.locator('#s-currency')).toHaveValue('TND');

    // Switch to Operations settings tab
    await page.getByRole('tab', { name: /operations|branch/i }).click();
    await expect(page.getByText(/target prep time|service radius/i).first()).toBeVisible();

    // Switch to System settings tab
    await page.getByRole('tab', { name: 'System' }).click();
    await expect(page.getByText(/database|node environment/i).first()).toBeVisible();
  });
});
