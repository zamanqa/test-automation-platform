// test, expect                     ← src/fixtures/index.ts
// findCheckoutOrderWithoutSubscription, OrderRow ← src/db/queries/hub/orders.ts
// countRecurringPaymentsOf         ← src/db/queries/hub/recurring-payments.ts
// findSubscriptionRow              ← src/db/queries/hub/subscriptions.ts
import { test, expect } from '@fixtures';
import { findCheckoutOrderWithoutSubscription, type OrderRow } from '@db/queries/hub/orders';
import { countRecurringPaymentsOf } from '@db/queries/hub/recurring-payments';
import { findSubscriptionRow } from '@db/queries/hub/subscriptions';

/**
 * WHAT:   Hub UI → Order detail page: open it, add a note, create subscriptions per product.
 * FROM:   hub-e2e-automation cypress/e2e/01-order-page/orderDetail.cy.js (3 tests).
 * NEEDS:  an open/fulfilled checkout order without subscription.
 * CHANGES DATA: yes — adds a note; creates subscriptions for every product row that has none.
 * Page objects: orderListPage ← src/pages/hub/OrderListPage.ts, orderDetailPage ← OrderDetailPage.ts
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - order detail', () => {
  let order: OrderRow; // set once in beforeAll, used by all 3 tests

  // Runs ONCE for the file (like the Cypress before()): pick the order ← hub db.
  // db and hubCompanyId are worker fixtures, so they are allowed in beforeAll.
  test.beforeAll(async ({ db, hubCompanyId }) => {
    const found = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    expect(found, 'Needs an open/fulfilled checkout order without subscription').toBeDefined();
    order = found!;
  });

  // Before each test: orders list → search the order → open it (openFirstOrder waits for its URL)
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open(order.order_id);
    await orderListPage.openFirstOrder(order.order_id);
  });

  test('opens the order detail page', async ({ orderDetailPage }) => {
    // CHECK: URL contains /orders/{order_id}
    await orderDetailPage.expectOrder(order.order_id);
  });

  test('creates a note', async ({ orderDetailPage }) => {
    // SETUP: unique note text (timestamp)
    const message = `Automated test note - ${Date.now()}`;

    // ACTION: "Create note" → type → submit
    await orderDetailPage.createNote(message);

    // CHECK: the note is shown on the page
    await orderDetailPage.expectNote(message);
  });

  test('creates a subscription for every product without one', async ({ orderDetailPage, db }) => {
    // SETUP: product rows that still show a "Create subscription" button (none → skipped)
    const rows = await orderDetailPage.rowsWithoutSubscription();
    test.skip(rows.length === 0, `Order ${order.order_id} has no product without subscription`);

    // For each of those rows (the number of rows depends on the order) ...
    for (const row of rows) {
      await test.step(`row ${row}`, async () => {
        // SETUP: subscription type shown in the row's 9th column (normal / consumable / digital)
        const type = await orderDetailPage.subscriptionTypeOf(row);

        // ACTION: open the dialog, generate a serial (not for digital), submit, close
        await orderDetailPage.createSubscription(row, type);

        // CHECK: the row now links to /subscriptions/{id} → that id exists in the database
        const subscriptionId = await orderDetailPage.subscriptionIdOf(row);
        const subscription = await findSubscriptionRow(db.hub, subscriptionId);
        expect(subscription, `Subscription ${subscriptionId} in the database`).toBeDefined();

        // INFO only (Cypress only logged it): number of open recurring payments,
        // shown in the HTML report under "annotations" — not a pass/fail check.
        const rps = await countRecurringPaymentsOf(db.hub, subscription!.id);
        test.info().annotations.push({ type: 'recurring payments', description: `${subscriptionId}: ${rps}` });
      });
    }
  });
});
