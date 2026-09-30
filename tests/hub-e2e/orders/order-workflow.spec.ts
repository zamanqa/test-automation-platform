// test, expect ← src/fixtures/index.ts
// findCmsOrderAwaitingPayment, findOpenPaidOrder, getOrderStatus, getOrderTransactionId, OrderRow ← src/db/queries/hub/orders.ts
import { test, expect } from '@fixtures';
import { findCmsOrderAwaitingPayment, findOpenPaidOrder, getOrderStatus, getOrderTransactionId, type OrderRow } from '@db/queries/hub/orders';

/**
 * WHAT:   Hub UI → actions on an order (3-dot menu, edit customer, tabs, payment link).
 * FROM:   hub-e2e-automation cypress/e2e/01-order-page/orderWorkflow.cy.js (6 tests).
 * NEEDS:  a hub-created (cms) order that still waits for its first payment.
 * CHANGES DATA: yes — one-time payment, mark fulfilled, charge initial payment, customer name/street.
 * orderWorkflowPage methods ← src/pages/hub/OrderWorkflowPage.ts
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - order actions', () => {
  let order: OrderRow; // set once in beforeAll

  // Once for the file (like Cypress before()): pick the order ← hub db
  test.beforeAll(async ({ db, hubCompanyId }) => {
    order = await findCmsOrderAwaitingPayment(db.hub, hubCompanyId);
  });

  // Before each test: open that order's detail page
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open(order.order_id);
    await orderListPage.openFirstOrder(order.order_id);
  });

  test('charges a one-time payment', async ({ orderWorkflowPage }) => {
    // ACTION + CHECK: menu → "one-time payment" → one product line + message → Charge
    //                 → success notification → close (all inside chargeOneTimePayment)
    await orderWorkflowPage.chargeOneTimePayment(
      { title: 'Premium Support Package', price: '199.99', vat: '19' }, // test data from Cypress
      'Thank you for your order. Please proceed with payment.',
    );
  });

  test('charges the initial payment', async ({ orderWorkflowPage, db }) => {
    // ACTION + CHECK: menu → "charge initial" → message → Charge → success notification
    await orderWorkflowPage.chargeInitialPayment('Your initial payment has been processed. Invoice attached.');

    // CHECK: the order gets a transaction id in the database (Cypress only logged it)
    await expect
      .poll(() => getOrderTransactionId(db.hub, order.order_id), { message: `transaction_id of order ${order.order_id}` })
      .toBeTruthy();
  });

  // Uses its OWN order: the hub offers "Mark as fulfilled" only on an open, PAID order, and
  // "Charge initial payment" above already fulfils the cms order by itself (2026-09-28).
  test('marks an open paid order as fulfilled', async ({ orderListPage, orderWorkflowPage, db, hubCompanyId }) => {
    // SETUP: open, paid order ← hub db (else skipped); open its page
    const paidOrder = await findOpenPaidOrder(db.hub, hubCompanyId);
    test.skip(!paidOrder, 'No open paid order in the database');
    await orderListPage.open(paidOrder!.order_id);
    await orderListPage.openFirstOrder(paidOrder!.order_id);

    // ACTION: menu → "Mark as fulfilled" → confirm → close
    await orderWorkflowPage.markFulfilled();
    await orderWorkflowPage.closeNotification();

    // CHECK: order status in the database becomes 'fulfilled'
    await expect
      .poll(() => getOrderStatus(db.hub, paidOrder!.order_id), { message: `status of order ${paidOrder!.order_id}` })
      .toBe('fulfilled');
  });

  test('updates the billing customer', async ({ orderWorkflowPage, page }) => {
    // ACTION: edit → new first name, surname, street → consent → save
    await orderWorkflowPage.editBillingCustomer({ givenName: 'Max', surname: 'Mustermann', street: 'Hauptstraße 42' });
    // CHECK: new name shown ...
    await orderWorkflowPage.expectCustomer('Max', 'Mustermann');

    // ... and still shown after a page reload (= really saved)
    await page.reload();
    await orderWorkflowPage.expectCustomer('Max', 'Mustermann');
  });

  test('switches between all tabs', async ({ orderWorkflowPage, page }) => {
    // ACTION: click a tab → CHECK: the URL ends with that tab's #hash
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
    // CHECK: we are on the update-payment-method page
    await expect(page).toHaveURL(/update-payment-method/);

    // ACTION + CHECK: browser back → order page again
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/orders/${order.order_id}`));
  });
});
