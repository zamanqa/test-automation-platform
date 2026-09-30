// test, expect ← src/fixtures/index.ts
// billingAddress ← src/data/static/hub.ts
// order queries ← src/db/queries/hub/orders.ts, notes ← src/db/queries/hub/notes.ts
import { test, expect } from '@fixtures';
import { billingAddress } from '@data/static/hub';
import { countOrderNotes } from '@db/queries/hub/notes';
import { findProductForOrderItem } from '@db/queries/hub/products';
import {
  countSubscriptionsOfOrder,
  findCheckoutOrderWithSubscription,
  findCheckoutOrderWithoutSubscription,
  findLatestOrder,
  countOrderItems,
  findOrderItems,
  findPayByInvoiceOrderWithoutInvoice,
  getOrderCustomerId,
  getOrderStatus,
  getOrderTag,
  getOrderTransactionId,
  setOrderTag,
} from '@db/queries/hub/orders';

/**
 * WHAT:   Hub UI → order actions and order pages that the Cypress suite did not cover (added 2026-09-28):
 *         cancel + reopen, edit order, create invoice, view customer, tag, Process subscriptions,
 *         edit + delete note, detail tabs, advanced filter, Draft tab checkout link, Consumable tab.
 * NEEDS:  a checkout order without subscription, a checkout order with subscriptions,
 *         a pay-by-invoice order without invoice (else that test is skipped).
 * CHANGES DATA: yes — creates 2 orders (cancel/reopen, edit), creates an invoice, sets a tag (put back),
 *         creates subscriptions for one order, creates + edits + deletes a note.
 * Page objects: orderListPage, orderDetailPage, orderWorkflowPage, orderCreationPage ← src/pages/hub/
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - more order actions', () => {
  // Product for "Add item" ← hub db: active, has an active variant, never qa_auto test data (owner, 2026-09-29)
  let product: { id: string; title: string };
  test.beforeEach(async ({ db, hubCompanyId }) => {
    const found = await findProductForOrderItem(db.hub, hubCompanyId);
    test.skip(!found, 'No active product with an active variant (not qa_auto) in the database');
    product = found!;
  });

  test('cancels a new order and reopens it', async ({ orderCreationPage, orderWorkflowPage, db, page }) => {
    // SETUP: a fresh hub order with one item, so no real test order is touched
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '1', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    const orderId = await orderCreationPage.submitOrder();
    test.info().annotations.push({ type: 'order', description: orderId });

    // ACTION: menu → Cancel order → message → consent → Cancel order
    await orderWorkflowPage.cancelOrder('QA automation: cancel test');

    // CHECK: database status 'cancelled'
    await expect.poll(() => getOrderStatus(db.hub, orderId), { message: `status of order ${orderId}` }).toBe('cancelled');

    // ACTION: reload (the menu still shows the old state after cancelling) → menu → Reopen order → consent → Submit
    await page.reload();
    await orderWorkflowPage.reopenOrder();

    // CHECK: database status 'open' again
    await expect.poll(() => getOrderStatus(db.hub, orderId), { message: `status of order ${orderId}` }).toBe('open');
  });

  test('edits an order: changes the existing item and adds a new one', async ({ orderCreationPage, orderWorkflowPage, db }) => {
    // SETUP: a fresh hub order with one item (quantity 1)
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '1', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    const orderId = await orderCreationPage.submitOrder();
    test.info().annotations.push({ type: 'order', description: orderId });

    // ACTION: menu → Edit order → Confirm → edit form
    await orderWorkflowPage.startEditOrder();
    // ACTION: existing item quantity 1 → 2, add a second item
    await orderCreationPage.changeFirstItemQuantity('2');
    await orderCreationPage.addItem({ product: product.title, type: 'consumable', price: '15', quantity: '1', duration: '10' });
    await orderCreationPage.fillStreetNumberIfEmpty(billingAddress.streetNumber);
    const editedOrderId = await orderCreationPage.submitEditOrder();
    test.info().annotations.push({ type: 'order after edit', description: editedOrderId });

    // CHECK: the order after the edit has 2 items in the database, the first with quantity 2
    await expect
      .poll(() => countOrderItems(db.hub, editedOrderId), { message: `items of order ${editedOrderId}`, timeout: 30_000 })
      .toBe(2);
    const items = await findOrderItems(db.hub, editedOrderId);
    expect(items[0].quantity, `quantity of the changed item of order ${editedOrderId}`).toBe(2);
    expect(items[1].quantity, `quantity of the new item of order ${editedOrderId}`).toBe(1);
  });

  test('creates an invoice for a pay-by-invoice order', async ({ orderListPage, orderWorkflowPage, db, hubCompanyId }) => {
    // SETUP: pay-by-invoice order without invoice yet ← hub db (else skipped)
    const order = await findPayByInvoiceOrderWithoutInvoice(db.hub, hubCompanyId);
    test.skip(!order, 'No pay-by-invoice order without invoice in the database');
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);

    // ACTION: menu → Create invoice → Submit
    await orderWorkflowPage.createInvoice();

    // CHECK: the order now has a transaction (its invoice) in the database
    await expect
      .poll(() => getOrderTransactionId(db.hub, order!.order_id), { message: `transaction_id of order ${order!.order_id}`, timeout: 30_000 })
      .toBeTruthy();
  });

  test('opens the customer from the order list', async ({ orderListPage, page, db, hubCompanyId }) => {
    // SETUP: an order and its customer id ← hub db
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order in the database');
    const customerId = await getOrderCustomerId(db.hub, order!.order_id);

    // ACTION: search the order → row menu → View customer
    await orderListPage.open(order!.order_id);
    await orderListPage.viewCustomerOf(order!.order_id);

    // CHECK: the customer page of that customer is open
    await expect(page).toHaveURL(new RegExp(`/cms/customers/${customerId}`));
  });

  test('sets a tag on an order', async ({ orderListPage, orderDetailPage, db, hubCompanyId, cleanup }) => {
    // SETUP: an order and its current tag ← hub db; put the old tag back afterwards
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order in the database');
    const oldTag = (await getOrderTag(db.hub, order!.order_id)) ?? null;
    cleanup.add('restore tag', () => setOrderTag(db.hub, order!.order_id, oldTag));
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);

    // SETUP: new tag from the hub's fixed list — "test order", or "verified" if it already is "test order"
    let newTag = 'test order';
    if (oldTag === 'test order') newTag = 'verified';

    // ACTION: tag button → pick the new tag → Save changes
    await orderDetailPage.setTag(newTag);

    // CHECK: database tag is the new one
    await expect.poll(() => getOrderTag(db.hub, order!.order_id), { message: `tag of order ${order!.order_id}` }).toBe(newTag);
  });

  test('creates the subscriptions of an order with "Process subscriptions"', async ({ orderListPage, orderDetailPage, db, hubCompanyId }) => {
    // SETUP: checkout order that has no subscription yet ← hub db
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order without subscription in the database');
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);

    // ACTION: Process subscriptions → first product: Generate serial → Submit
    await orderDetailPage.processFirstSubscription();

    // CHECK: the order now has a subscription in the database
    await expect
      .poll(() => countSubscriptionsOfOrder(db.hub, order!.order_id), { message: `subscriptions of order ${order!.order_id}`, timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test('creates, edits and deletes a note', async ({ orderListPage, orderDetailPage, db, hubCompanyId }) => {
    // SETUP: an order; unique note texts
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order in the database');
    const note = `qa_auto note ${Date.now()}`;
    const edited = `${note} (edited)`;
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);

    // ACTION + CHECK: create
    await orderDetailPage.createNote(note);
    await orderDetailPage.expectNote(note);

    // ACTION + CHECK: edit → new text on the page and in the database
    await orderDetailPage.editNote(note, edited);
    await orderDetailPage.expectNote(edited);
    await expect.poll(() => countOrderNotes(db.hub, order!.order_id, edited), { message: 'edited note in the database' }).toBe(1);

    // ACTION + CHECK: delete → gone from the database
    await orderDetailPage.deleteNote(edited);
    await expect.poll(() => countOrderNotes(db.hub, order!.order_id, edited), { message: 'deleted note in the database' }).toBe(0);
  });

  test('shows data on the Payment methods, History, Products and Subscriptions tabs', async ({ orderListPage, orderDetailPage, db, hubCompanyId }) => {
    // SETUP: checkout order that already has subscriptions (so the Subscriptions tab has rows)
    const order = await findCheckoutOrderWithSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order with subscriptions in the database');
    await orderListPage.open(order!.order_id);
    await orderListPage.openFirstOrder(order!.order_id);

    // ACTION + CHECK: each tab shows at least one row.
    // "Products" and "Subscriptions" are sub-tabs inside the General tab → check them first.
    await orderDetailPage.expectTabHasRows('Products');
    await orderDetailPage.expectTabHasRows('Subscriptions');
    await orderDetailPage.expectTabHasRows('Payment methods');
    await orderDetailPage.expectTabHasRows('History');
  });

  test('filters the order list with the advanced filter (ID is an order id)', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: newest order ← hub db; order list without filters
    const order = await findLatestOrder(db.hub, hubCompanyId);
    await orderListPage.open();

    // ACTION: Filter → key "ID", operator "Is" (default), value = the order id → Add new filter → Search
    await orderListPage.addAdvancedFilter('ID', order.order_id);

    // CHECK: exactly that order is listed
    await expect(orderListPage.rows, `rows for ID is ${order.order_id}`).toHaveCount(1);
    await orderListPage.expectOrderInTable(order.order_id);
  });

  test('opens the checkout link of a quote on the Draft tab', async ({ orderListPage, page }) => {
    // SETUP: order list → Draft tab
    await orderListPage.open();
    await orderListPage.openTab('Draft');

    // ACTION: open the first quote's "Checkout link"
    const checkoutLink = await orderListPage.firstQuoteCheckoutLink();
    await page.goto(checkoutLink);

    // CHECK: the checkout shows the quote's cart (total and a continue button)
    await expect(page.locator('[data-test-id="cart-sum"]').first(), 'cart total in the checkout').toBeVisible({ timeout: 30_000 });
  });

  test('shows consumable orders and the Process dialog on the Consumable tab', async ({ orderListPage }) => {
    // SETUP: order list → Consumable tab (openTab checks rows are shown)
    await orderListPage.open();
    await orderListPage.openTab('Consumable');

    // ACTION + CHECK: Process on the first row opens "Process consumable order"; closed without processing
    await orderListPage.openAndCloseConsumableProcess();
  });
});
