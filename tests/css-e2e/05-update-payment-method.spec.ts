import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { payments } from '@data/static/checkout';
import { findNewestPaymentMethod, getNewestPaymentMethodId } from '@db/queries/hub/payment-methods';

// CSS "Update payment method", always with card 4242 4242 4242 4242:
// 1. profile → "Update payment methods" (all orders) → Payment page → card → "Save payment method"
// 2. delivery details → "Update payment method" (that order) → Payment page → card → "Save payment method"
// Each time the newest payment method of the customer and order must be a new, enabled one.
// Needs: .auth/css-data.json from 01-css-login.spec.ts.
// Changes data: saves new cards.
test.describe('CSS - update payment method', () => {
  test.beforeEach(async ({ cssPage }) => {
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json, run 01-css-login.spec.ts first');
    await cssPage.loginFromHub(data!.customerId);
  });

  test('profile → update payment method by card → new enabled entry for the checkout order', async ({ cssPage, db }) => {
    // SETUP: newest payment method before the update
    const data = readCssData()!;
    const before = await findNewestPaymentMethod(db.hub, data.customerId, data.orderId);

    // ACTION: Your profile → Update payment methods
    await cssPage.page.getByRole('button', { name: 'Your profile' }).click();
    await cssPage.page.getByRole('link', { name: /Update payment method/ }).click();

    // CHECK: Update payment method page
    await expect(cssPage.page).toHaveURL(/\/css\/update-payment-method/);
    await expect(cssPage.page.getByRole('heading', { name: 'Update payment method', level: 1 })).toBeVisible();

    // ACTION: "Update payment method" → Payment page → card 4242 4242 4242 4242 → Save payment method
    await cssPage.page.getByRole('button', { name: 'Update payment method' }).click();
    await expect(cssPage.page).toHaveURL(/\/en\/pay\//, { timeout: 30_000 });
    await cssPage.saveCard(payments.stripeCard);

    // CHECK: the newest payment method is a new one, enabled, card ending 4242
    await expect
      .poll(() => getNewestPaymentMethodId(db.hub, data.customerId, data.orderId), {
        message: `new payment method of ${data.customerId} for order ${data.orderId}`,
        timeout: 60_000,
      })
      .not.toBe(before?.id);
    const newest = await findNewestPaymentMethod(db.hub, data.customerId, data.orderId);
    test.info().annotations.push({ type: 'payment method', description: `id ${newest!.id}` });
    expect(newest!.enabled, 'enabled of the new payment method').toBe(true);
    expect(newest!.last_4_digit, 'last 4 digits').toBe('4242');
  });

  test('delivery details → update payment method by card → new enabled entry for the order', async ({ cssPage, db }) => {
    const data = readCssData()!;

    // SETUP: the "Upcoming deliveries" tab only shows while there is an active consumable subscription
    // (99-cancel-and-report cancels it, so 05 must run before 99)
    await expect(cssPage.page.getByRole('tab', { name: 'Your Orders' })).toBeVisible();
    test.skip((await cssPage.page.getByRole('tab', { name: 'Upcoming deliveries' }).count()) === 0, 'no upcoming deliveries (subscriptions cancelled by 99)');

    // ACTION: Upcoming deliveries → first delivery → Delivery details
    await cssPage.openFirstDelivery();

    // SETUP: the order of this delivery, and its newest payment method before the update
    const link = cssPage.page.getByRole('link', { name: /Update payment method/ });
    const orderId = new URL((await link.getAttribute('href'))!, cssPage.page.url()).searchParams.get('order_id')!;
    test.info().annotations.push({ type: 'order', description: orderId });
    const before = await findNewestPaymentMethod(db.hub, data.customerId, orderId);

    // ACTION: Update payment method
    await link.click();

    // CHECK: Update payment method page for that order
    await expect(cssPage.page).toHaveURL(new RegExp(`/css/update-payment-method\\?order_id=${orderId}`));

    // ACTION: "Update payment method" → Payment page → card 4242 4242 4242 4242 → Save payment method
    await cssPage.page.getByRole('button', { name: 'Update payment method' }).click();
    await expect(cssPage.page).toHaveURL(/\/en\/pay\//, { timeout: 30_000 });
    await cssPage.saveCard(payments.stripeCard);

    // CHECK: the newest payment method is a new one, enabled, card ending 4242
    await expect
      .poll(() => getNewestPaymentMethodId(db.hub, data.customerId, orderId), {
        message: `new payment method of ${data.customerId} for order ${orderId}`,
        timeout: 60_000,
      })
      .not.toBe(before?.id);
    const newest = await findNewestPaymentMethod(db.hub, data.customerId, orderId);
    test.info().annotations.push({ type: 'payment method', description: `id ${newest!.id}` });
    expect(newest!.enabled, 'enabled of the new payment method').toBe(true);
    expect(newest!.last_4_digit, 'last 4 digits').toBe('4242');
  });
});
