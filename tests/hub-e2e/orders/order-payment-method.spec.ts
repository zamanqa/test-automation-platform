import { test, expect } from '@fixtures';
import { payments } from '@data/static/checkout';
import { findLatestCheckoutCardOrder } from '@db/queries/hub/orders';
import { findNewestPaymentMethod, getNewestPaymentMethodId } from '@db/queries/hub/payment-methods';

// Hub → order → menu "update payment method" → "Click here" → checkout page
// → card 4242 4242 4242 4242 → "Update payment method" → a new saved card for that customer and order.
// Needs: the latest checkout order paid by Stripe card (not qa_auto).
// Changes data: saves a new card for the order.
test.describe('Hub - update payment method', () => {
  test('updates the payment method by card', async ({ orderListPage, orderWorkflowPage, page, db, hubCompanyId }) => {
    // SETUP: latest checkout order and its customer
    const order = await findLatestCheckoutCardOrder(db.hub, hubCompanyId);
    test.skip(!order, 'no checkout order paid by Stripe card (not qa_auto)');
    test.info().annotations.push({ type: 'order', description: `${order!.order_id} (customer ${order!.customer_id})` });

    // SETUP: newest payment method before the update
    const before = await findNewestPaymentMethod(db.hub, order!.customer_id, order!.order_id);

    // ACTION: open the order → menu "update payment method" → "Click here" (same tab)
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);
    await orderWorkflowPage.openPaymentUpdateLink();

    // CHECK: the update payment method page of this order
    await expect(page).toHaveURL(new RegExp(`update-payment-method\\?order_id=${order!.order_id}`));

    // ACTION: card 4242 4242 4242 4242 → Update payment method
    await orderWorkflowPage.updatePaymentMethodByCard(payments.stripeCard);

    // CHECK: the newest payment method is a new one, enabled, card ending 4242
    await expect
      .poll(() => getNewestPaymentMethodId(db.hub, order!.customer_id, order!.order_id), {
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
