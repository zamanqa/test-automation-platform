import { test, expect } from '@fixtures';
import { findCheckoutOrderWithoutSubscription, getOrderItemSubscriptionType, type OrderRow } from '@db/queries/hub/orders';
import { countRecurringPaymentsOf } from '@db/queries/hub/recurring-payments';
import { findSubscriptionRow } from '@db/queries/hub/subscriptions';

// Hub → order page: open it, add a note, create a subscription for each product.
// Needs: an open or fulfilled checkout order without subscription.
// Changes data: adds a note; creates subscriptions for every product row that has none.
test.describe.configure({ mode: 'default' });

test.describe('Hub - order detail', () => {
  let order: OrderRow;

  // pick the order once for the whole file
  test.beforeAll(async ({ db, hubCompanyId }) => {
    const found = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    expect(found, 'Needs an open/fulfilled checkout order without subscription').toBeDefined();
    order = found!;
  });

  // open the order
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open(order.order_id);
    await orderListPage.openFirstOrder(order.order_id);
  });

  test('opens the order detail page', async ({ orderDetailPage }) => {
    // CHECK
    await orderDetailPage.expectOrder(order.order_id);
  });

  test('creates a note', async ({ orderDetailPage }) => {
    // SETUP: unique note text
    const message = `Automated test note - ${Date.now()}`;

    // ACTION: "Create note" → type → submit
    await orderDetailPage.createNote(message);

    // CHECK: the note is shown on the page
    await orderDetailPage.expectNote(message);
  });

  test('creates a subscription for every product without one', async ({ orderDetailPage, db }) => {
    // SETUP: wait for the product list (it loads after the order info), then the rows with "Create subscription"
    await orderDetailPage.waitForCreateSubscriptionButtons();
    const rows = await orderDetailPage.rowsWithoutSubscription();

    for (const row of rows) {
      await test.step(`row ${row}`, async () => {
        // SETUP: subscription type of the row from order_items (normal / consumable / digital)
        const sku = await orderDetailPage.skuOf(row);
        const type = await getOrderItemSubscriptionType(db.hub, order.order_id, sku);
        expect(type, `order_items row of ${order.order_id} with SKU ${sku}`).toBeDefined();

        // ACTION: open the dialog, generate a serial (normal / consumable only), submit, close
        await orderDetailPage.createSubscription(row, type!);

        // CHECK: the row now links to a subscription, and it is in the database
        const subscriptionId = await orderDetailPage.subscriptionIdOf(row);
        const subscription = await findSubscriptionRow(db.hub, subscriptionId);
        expect(subscription, `Subscription ${subscriptionId} in the database`).toBeDefined();

        // INFO only: number of recurring payments, shown in the report
        const rps = await countRecurringPaymentsOf(db.hub, subscription!.id);
        test.info().annotations.push({ type: 'recurring payments', description: `${subscriptionId}: ${rps}` });
      });
    }
  });
});
