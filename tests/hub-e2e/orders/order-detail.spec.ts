import { test, expect } from '@fixtures';
import { findCheckoutOrderWithoutSubscription, type OrderRow } from '@db/queries/hub/orders';
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
    // SETUP: product rows that still have a "Create subscription" button
    const rows = await orderDetailPage.rowsWithoutSubscription();
    test.skip(rows.length === 0, `Order ${order.order_id} has no product without subscription`);

    for (const row of rows) {
      await test.step(`row ${row}`, async () => {
        // SETUP: subscription type of the row (normal / consumable / digital)
        const type = await orderDetailPage.subscriptionTypeOf(row);

        // ACTION: open the dialog, generate a serial (not for digital), submit, close
        await orderDetailPage.createSubscription(row, type);

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
