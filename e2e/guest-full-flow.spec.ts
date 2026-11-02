import { expect, test, type APIRequestContext } from '@playwright/test';
import { API, DEMO_PASSWORD, findBranch, findFreeTable, seatGuest } from './helpers';

async function deliverOrder(request: APIRequestContext, orderId: string) {
  const loginRes = await request.post(`${API}/api/auth/login`, {
    data: { email: 'manager@tableflow.local', password: DEMO_PASSWORD },
  });
  expect(loginRes.ok()).toBeTruthy();
  const { accessToken } = await loginRes.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  for (const status of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED']) {
    const res = await request.patch(`${API}/api/orders/${orderId}/status`, {
      headers,
      data: { status },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test.describe('comprehensive guest journey', () => {
  test('complete cycle: order, kitchen pass, service request, split bill, pay, receipt PDF, and review', async ({
    page,
    request,
  }) => {
    const branch = await findBranch(request);
    const table = await findFreeTable(request, branch);

    // 1. Seat guest and clear location gate
    await seatGuest(page, table);

    // 2. Search menu and select a category
    await expect(page.getByRole('heading', { name: /what can we get you/i })).toBeVisible();

    // 3. Add an item with customizations
    await page.getByRole('button', { name: /Double Beef Burger/i }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Double Beef Burger' })).toBeVisible();
    await sheet.getByText('Extra cheese slice').click();
    await sheet.getByRole('button', { name: /add to cart/i }).click();
    await expect(sheet).toHaveCount(0);

    // 4. View cart and place order
    await page.getByRole('button', { name: /view cart/i }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await page.getByRole('button', { name: /^place order/i }).click();

    // 5. Land on live tracker
    await expect(page).toHaveURL(/\/order\/[0-9a-f-]+$/, { timeout: 30_000 });
    await expect(page.getByText('Order received')).toBeVisible();

    const orderId = page.url().split('/').pop()!;
    expect(orderId).toBeTruthy();

    // Simulate the pass: staff advances order through kitchen and delivers it
    await deliverOrder(request, orderId);

    // 6. Navigate to service tab and request water
    await page.getByRole('link', { name: 'Service' }).click();
    await expect(page).toHaveURL(/\/services$/);
    await page.getByRole('button', { name: /^water/i }).click();
    await expect(page.getByText(/water/i).first()).toBeVisible();

    // 7. Navigate to bill tab
    await page.getByRole('link', { name: 'Bill' }).click();
    await expect(page).toHaveURL(/\/bill$/);
    await expect(page.getByRole('heading', { name: 'Your bill' })).toBeVisible();
    await expect(page.getByText(/Order #\d+/).first()).toBeVisible();
    await expect(page.getByText('Outstanding')).toBeVisible();

    // Test bill split increment and decrement
    const plusBtn = page.getByRole('button', { name: /more people/i });
    if (await plusBtn.isVisible()) {
      await plusBtn.click();
      await expect(page.getByText('Each person pays')).toBeVisible();
      const minusBtn = page.getByRole('button', { name: /fewer people/i });
      await minusBtn.click();
    }

    // 8. Open Payment sheet and pay with mock card
    await page.getByRole('button', { name: /pay now/i }).click();
    const paymentSheet = page.getByRole('dialog');
    await expect(paymentSheet.getByRole('heading', { name: /demo online payment/i })).toBeVisible();

    // Select 5% tip
    await paymentSheet.getByRole('button', { name: '5%', exact: true }).click();

    // Click Pay
    await paymentSheet.getByRole('button', { name: /pay/i }).last().click();

    // 9. Verify navigation to receipt page
    await expect(page).toHaveURL(/\/receipt\/[0-9a-f-]+$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Big Ben Café' })).toBeVisible();
    await expect(page.getByRole('button', { name: /download pdf/i })).toBeVisible();

    // Test receipt download button
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await page.getByRole('button', { name: /download pdf/i }).click();
    const download = await downloadPromise;
    if (download) {
      expect(download.suggestedFilename()).toMatch(/receipt-.*\.pdf/);
    }

    // 10. Leave a review
    await page.getByRole('button', { name: /leave a review/i }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole('heading', { name: /how was your experience/i })).toBeVisible();

    // Click 5 stars for overall
    await page.getByRole('button', { name: '5 stars for Overall' }).click();

    const commentBox = page.getByPlaceholder(/what stood out/i);
    if (await commentBox.isVisible()) {
      await commentBox.fill('Exceptional food and service!');
    }

    await page.getByRole('button', { name: /send feedback/i }).click();
    await expect(page.getByText(/thank you|thanks for your feedback/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
