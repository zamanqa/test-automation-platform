import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { readCssData } from '@data/css';
import { payments } from '@data/static/checkout';
import { findNewestPaymentMethod, getNewestPaymentMethodId } from '@db/queries/hub/payment-methods';

// Hub → the CSS test order → menu "update payment method" → "Click here" → checkout page
// → card 4242 4242 4242 4242 → "Update payment method" → a new saved card for that customer and order.
// Needs: .auth/css-data.json from 01-css-login.spec.ts.
// Changes data: saves a new card for the order.
test.describe('Hub - update payment method of the CSS test order', () => {
  test('update payment method by card → new enabled entry for the order', async ({ page, orderWorkflowPage, db }) => {
    // SETUP: newest payment method before the update
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json, run 01-css-login.spec.ts first');
    const before = await findNewestPaymentMethod(db.hub, data!.customerId, data!.orderId);

    // ACTION: hub order page → menu "update payment method" → "Click here" (same tab)
    await page.goto(`${env.hub.HUB_URL}en/cms/orders/${data!.orderId}`);
    await orderWorkflowPage.openPaymentUpdateLink();

    // ACTION: card 4242 4242 4242 4242 → Update payment method
    await orderWorkflowPage.updatePaymentMethodByCard(payments.stripeCard);

    // CHECK: the newest payment method is a new one, enabled, card ending 4242
    await expect
      .poll(() => getNewestPaymentMethodId(db.hub, data!.customerId, data!.orderId), {
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
