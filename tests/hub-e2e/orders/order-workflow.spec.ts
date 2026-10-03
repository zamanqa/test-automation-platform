import { test, expect } from '@fixtures';
import { findCmsOrderAwaitingPayment, findOpenPaidOrder, getOrderStatus, getOrderTransactionId, type OrderRow } from '@db/queries/hub/orders';

// Hub → order actions: menu actions, edit customer, tabs, payment link.
// Needs: an order made in the hub (cms) that still waits for its first payment.
// Changes data: one-time payment, mark fulfilled, charge initial payment, customer name and street.
test.describe.configure({ mode: 'default' });

test.describe('Hub - order actions', () => {
  let order: OrderRow;

  // pick the order once for the whole file
  test.beforeAll(async ({ db, hubCompanyId }) => {
    order = await findCmsOrderAwaitingPayment(db.hub, hubCompanyId);
  });

  // open the order
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open(order.order_id);
    await orderListPage.openFirstOrder(order.order_id);
  });

  test('charges a one-time payment', async ({ orderWorkflowPage }) => {
    // ACTION + CHECK: menu → "one-time payment" → one product line + message → Charge → success message
    await orderWorkflowPage.chargeOneTimePayment(
      { title: 'Premium Support Package', price: '199.99', vat: '19' },
      'Thank you for your order. Please proceed with payment.',
    );
  });

  test('charges the initial payment', async ({ orderWorkflowPage, db }) => {
    // ACTION + CHECK: menu → "charge initial" → message → Charge → success message
    await orderWorkflowPage.chargeInitialPayment('Your initial payment has been processed. Invoice attached.');

    // CHECK: the order gets a transaction id in the database
    await expect
      .poll(() => getOrderTransactionId(db.hub, order.order_id), { message: `transaction_id of order ${order.order_id}` })
      .toBeTruthy();
  });

  // Uses its own order: "Mark as fulfilled" is only offered on an open, paid order,
  // and "Charge initial payment" above already fulfils the cms order by itself.
  test('marks an open paid order as fulfilled', async ({ orderListPage, orderWorkflowPage, db, hubCompanyId }) => {
    // SETUP: open, paid order
    const paidOrder = await findOpenPaidOrder(db.hub, hubCompanyId);
    test.skip(!paidOrder, 'No open paid order in the database');
    await orderListPage.open(paidOrder!.order_id);
    await orderListPage.openFirstOrder(paidOrder!.order_id);

    // ACTION: menu → "Mark as fulfilled" → confirm → close
    await orderWorkflowPage.markFulfilled();
    await orderWorkflowPage.closeNotification();

    // CHECK: status 'fulfilled' in the database
    await expect
      .poll(() => getOrderStatus(db.hub, paidOrder!.order_id), { message: `status of order ${paidOrder!.order_id}` })
      .toBe('fulfilled');
  });

  test('updates the billing customer', async ({ orderWorkflowPage, page }) => {
    // ACTION: edit → new first name, surname, street → consent → save
    await orderWorkflowPage.editBillingCustomer({ givenName: 'Max', surname: 'Mustermann', street: 'Hauptstraße 42' });

    // CHECK: the new name is shown, also after a reload
    await orderWorkflowPage.expectCustomer('Max', 'Mustermann');
    await page.reload();
    await orderWorkflowPage.expectCustomer('Max', 'Mustermann');
  });

  test('switches between all tabs', async ({ orderWorkflowPage, page }) => {
    // ACTION + CHECK: each tab changes the #hash in the URL
    await orderWorkflowPage.openTab('General');
    await expect(page).toHaveURL(/#general/);

    await orderWorkflowPage.openTab('Payments');
    await expect(page).toHaveURL(/#payments/);

    await orderWorkflowPage.openTab('Payment methods');
    await expect(page).toHaveURL(/#paymentMethods/);

    await orderWorkflowPage.openTab('History');
    await expect(page).toHaveURL(/#history/);

    await orderWorkflowPage.openTab('General');
    await expect(page).toHaveURL(/#general/);
  });

  test('opens the payment method update page', async ({ orderWorkflowPage, page }) => {
    // ACTION: menu → "update payment method" → "Click here" (opened in the same tab)
    await orderWorkflowPage.openPaymentUpdateLink();

    // CHECK
    await expect(page).toHaveURL(/update-payment-method/);

    // ACTION + CHECK: browser back opens the order again
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/orders/${order.order_id}`));
  });
});
