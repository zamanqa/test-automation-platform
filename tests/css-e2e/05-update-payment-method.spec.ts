import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { payments } from '@data/static/checkout';
import { findNewestPaymentMethod } from '@db/queries/hub/payment-methods';

/**
 * WHAT:   CSS "Update payment method", always with card 4242 4242 4242 4242 (owner):
 *         1. profile → "Update payment methods" (for all orders) → … → Payment page → card → "Save payment method"
 *            → a new customer_payment_methods row for the customer + the checkout order, enabled = true.
 *         2. delivery details → "Update payment method" (for that delivery's order) → … → Payment page → card
 *            → "Save payment method" → a new row for the customer + that order, enabled = true.
 *         (the newest row of customer + order by id desc must be new and enabled — owner)
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts.
 * CHANGES DATA: yes — new saved cards (customer_payment_methods).
 */
test.describe('CSS - update payment method', () => {
  test.beforeEach(async ({ cssPage }) => {
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    await cssPage.loginFromHub(data!.customerId);
  });

  test('profile → update payment method by card → new enabled entry for the checkout order', async ({ cssPage, db }) => {
    // SETUP: customer + checkout order ← css-data.json; newest payment method of that pair before ← hub db
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

    // CHECK (DB): newest row of customer + checkout order (id desc) is a NEW one, enabled, card ending 4242
    await expect
      .poll(async () => (await findNewestPaymentMethod(db.hub, data.customerId, data.orderId))?.id, {
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
    // SETUP: customer ← css-data.json
    const data = readCssData()!;

    // SETUP: the "Upcoming deliveries" tab is only shown while the customer has an active consumable subscription
    //        (99-cancel-and-report cancels it → run 05 before 99, as the full suite does)
    await expect(cssPage.page.getByRole('tab', { name: 'Your Orders' })).toBeVisible();
    test.skip((await cssPage.page.getByRole('tab', { name: 'Upcoming deliveries' }).count()) === 0, 'no upcoming deliveries (subscriptions cancelled by 99)');

    // ACTION: Upcoming deliveries → first delivery → Delivery details
    await cssPage.openFirstDelivery();

    // SETUP: the order of this delivery ← the link's ?order_id= (the checkout order or an "Add new product" order);
    //        newest payment method of customer + that order before ← hub db
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

    // CHECK (DB): newest row of customer + that order (id desc) is a NEW one, enabled, card ending 4242
    await expect
      .poll(async () => (await findNewestPaymentMethod(db.hub, data.customerId, orderId))?.id, {
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
