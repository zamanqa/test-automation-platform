import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { readCssData } from '@data/css';
import { payments } from '@data/static/checkout';
import { findNewestPaymentMethod } from '@db/queries/hub/payment-methods';

/**
 * WHAT:   Hub → the CSS test order → 3-dot menu "update payment method" → "Click here" → the checkout's Update payment method page
 *         → card 4242 4242 4242 4242 (owner: always this card) → "Update payment method"
 *         → a new customer_payment_methods row for that customer and order, enabled = true.
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts (the checkout order + customer); hub login (hub-setup).
 * CHANGES DATA: yes — a new saved card (customer_payment_methods) for the order.
 */
test.describe('Hub - update payment method of the CSS test order', () => {
  test('update payment method by card → new enabled entry for the order', async ({ page, orderWorkflowPage, db }) => {
    // SETUP: order + customer ← css-data.json; the customer's newest payment method before ← hub db
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    const before = await findNewestPaymentMethod(db.hub, data!.customerId, data!.orderId);

    // ACTION: hub order page → menu "update payment method" → "Click here" (same tab)
    await page.goto(`${env.hub.HUB_URL}en/cms/orders/${data!.orderId}`);
    await orderWorkflowPage.openPaymentUpdateLink();

    // ACTION: checkout "Update payment method" page → card 4242 4242 4242 4242 → Update payment method
    await orderWorkflowPage.updatePaymentMethodByCard(payments.stripeCard);

    // CHECK (DB): newest customer_payment_methods row of this customer + order (id desc) is a NEW one, enabled, card ending 4242
    await expect
      .poll(async () => (await findNewestPaymentMethod(db.hub, data!.customerId, data!.orderId))?.id, {
        message: `new payment method of ${data!.customerId} for order ${data!.orderId}`,
        timeout: 60_000,
      })
      .not.toBe(before?.id);
    const newest = await findNewestPaymentMethod(db.hub, data!.customerId, data!.orderId);
    test.info().annotations.push({ type: 'payment method', description: `id ${newest!.id}` });
    expect(newest!.enabled, 'enabled of the new payment method').toBe(true);
    expect(newest!.last_4_digit, 'last 4 digits').toBe('4242');
  });
});
