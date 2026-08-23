import { expect, test } from '@playwright/test';
import { findBranch, findFreeTable, seatGuest } from './helpers';

/**
 * The guest half of the demo story, driven on a phone-sized viewport:
 * scan → verify → browse → customise → cart → order → follow it live →
 * call a waiter → ask for the bill.
 */
test.describe('guest journey', () => {
  test('scans a table, orders a customised dish and follows it live', async ({ page, request }) => {
    const branch = await findBranch(request);
    const table = await findFreeTable(request, branch);

    await test.step('the location gate blocks the menu until it is cleared', async () => {
      await page.goto(`/t/${table.token}`);
      await expect(page.getByRole('heading', { name: /confirm you're at the table/i })).toBeVisible();
      // Nothing about the menu is reachable yet.
      await expect(page.getByRole('heading', { name: /what can we get you/i })).toHaveCount(0);
    });

    await test.step('clearing the gate opens the menu', async () => {
      await page.getByRole('button', { name: /simulate being at the restaurant/i }).click();
      await expect(page).toHaveURL(/\/menu$/);
      await expect(page.getByText(`Table ${table.number}`).first()).toBeVisible();
    });

    await test.step('a dish opens with its options and prices them live', async () => {
      await page.getByRole('button', { name: /Double Beef Burger/ }).first().click();

      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading', { name: 'Double Beef Burger' })).toBeVisible();

      // The cooking group is required, so one option is preselected.
      await expect(sheet.getByText('Cooking')).toBeVisible();

      const addButton = sheet.getByRole('button', { name: /add to cart/i });
      const priceBefore = await addButton.innerText();

      // Adding a paid extra must change the price shown on the button.
      await sheet.getByText('Extra cheese slice').click();
      await expect(addButton).not.toHaveText(priceBefore);

      await addButton.click();
      await expect(sheet).toHaveCount(0);
    });

    await test.step('the cart bar appears and the cart totals up', async () => {
      const cartBar = page.getByRole('button', { name: /view cart/i });
      await expect(cartBar).toBeVisible();
      await cartBar.click();

      await expect(page).toHaveURL(/\/cart$/);
      await expect(page.getByRole('heading', { name: 'Your cart' })).toBeVisible();
      await expect(page.getByText('Order summary')).toBeVisible();
      await expect(page.getByText('Total', { exact: true })).toBeVisible();
    });

    await test.step('placing the order lands on live tracking', async () => {
      await page.getByRole('button', { name: /^place order/i }).click();

      await expect(page).toHaveURL(/\/order\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByText('Order received')).toBeVisible();
      await expect(page.getByText('Preparing')).toBeVisible();
      await expect(page.getByText('Estimated time')).toBeVisible();
    });

    await test.step('the order also shows in the orders tab', async () => {
      await page.getByRole('link', { name: 'Orders' }).click();
      await expect(page).toHaveURL(/\/orders$/);
      await expect(page.getByText('In progress')).toBeVisible();
    });
  });

  test('calls a waiter and folds a repeat tap into one request', async ({ page, request }) => {
    const branch = await findBranch(request);
    const table = await findFreeTable(request, branch);
    await seatGuest(page, table);

    await page.getByRole('link', { name: 'Service' }).click();
    await expect(page).toHaveURL(/\/services$/);

    await page.getByRole('button', { name: /call waiter/i }).click();
    await expect(page.getByText(/waiter has been notified|already requested/i)).toBeVisible();

    // The request is now tracked for the guest.
    await expect(page.getByRole('heading', { name: /your requests/i })).toBeVisible();
    await expect(page.getByText('Call waiter').last()).toBeVisible();

    // Tapping again must not queue a second job for the same table.
    await page.getByRole('button', { name: /call waiter/i }).click();
    await expect(page.getByText(/already requested/i)).toBeVisible();
  });

  test('shows an honest error for a QR code that is not recognised', async ({ page }) => {
    await page.goto(`/t/${'z'.repeat(43)}`);
    await expect(page.getByRole('heading', { name: /do not recognise this code/i })).toBeVisible();
    await expect(page.getByText(/scan the code printed on your table/i)).toBeVisible();
  });

  test('an empty cart explains itself instead of showing a dead screen', async ({ page, request }) => {
    const branch = await findBranch(request);
    const table = await findFreeTable(request, branch);
    await seatGuest(page, table);

    await page.goto(`/t/${table.token}/cart`);
    await expect(page.getByText('Your cart is empty')).toBeVisible();
    await expect(page.getByRole('button', { name: /browse the menu/i })).toBeVisible();
  });
});
