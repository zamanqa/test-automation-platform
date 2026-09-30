import { test, expect } from '@fixtures';
import { payments } from '@data/static/checkout';
import { findLatestCheckoutCardOrder } from '@db/queries/hub/orders';
import { findNewestPaymentMethod } from '@db/queries/hub/payment-methods';

/**
 * WHAT:   Hub → order → 3-dot menu "update payment method" → "Click here" → the checkout's Update payment method page
 *         → card 4242 4242 4242 4242 (owner: always this card) → "Update payment method"
 *         → a new customer_payment_methods row for that customer and order (newest by id desc), enabled = true.
 * NEEDS:  a checkout order paid by Stripe card with a customer (owner: the latest checkout order), not qa_auto.
 * CHANGES DATA: yes — a new saved card (customer_payment_methods) for the order.
 * orderWorkflowPage methods ← src/pages/hub/OrderWorkflowPage.ts
 */
test.describe('Hub - update payment method', () => {
  test('updates the payment method by card', async ({ orderListPage, orderWorkflowPage, page, db, hubCompanyId }) => {
    // SETUP: latest checkout order + its customer ← hub db
    const order = await findLatestCheckoutCardOrder(db.hub, hubCompanyId);
    test.skip(!order, 'no checkout order paid by Stripe card (not qa_auto)');
    test.info().annotations.push({ type: 'order', description: `${order!.order_id} (customer ${order!.customer_id})` });

    // SETUP: newest payment method of customer + order before ← hub db
    const before = await findNewestPaymentMethod(db.hub, order!.customer_id, order!.order_id);

    // ACTION: open the order → menu "update payment method" → "Click here" (same tab)
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);
    await orderWorkflowPage.openPaymentUpdateLink();

    // CHECK: the checkout's update-payment-method page for the order
    await expect(page).toHaveURL(new RegExp(`update-payment-method\\?order_id=${order!.order_id}`));

    // ACTION: card 4242 4242 4242 4242 → Update payment method
    await orderWorkflowPage.updatePaymentMethodByCard(payments.stripeCard);

    // CHECK (DB): newest customer_payment_methods row of customer + order (id desc) is a NEW one, enabled, card ending 4242
    await expect
      .poll(async () => (await findNewestPaymentMethod(db.hub, order!.customer_id, order!.order_id))?.id, {
        message: `new payment method of ${order!.customer_id} for order ${order!.order_id}`,
        timeout: 60_000,
      })
      .not.toBe(before?.id);
    const newest = await findNewestPaymentMethod(db.hub, order!.customer_id, order!.order_id);
    test.info().annotations.push({ type: 'payment method', description: `id ${newest!.id}` });
    expect(newest!.enabled, 'enabled of the new payment method').toBe(true);
    expect(newest!.last_4_digit, 'last 4 digits').toBe('4242');
  });
});
