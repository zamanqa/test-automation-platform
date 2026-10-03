import { test, expect } from '@fixtures';
import { countOrders, findCheckoutOrderWithoutSubscription, findLatestOrder } from '@db/queries/hub/orders';

// Hub → Orders list: filters, search, count, export, mark fulfilled, pagination, tabs.
// Changes data: requests an export, fulfils one order.
test.describe('Hub - order list', () => {
  // open the list without old filters
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open();
  });

  test('filters by status and clears the filter', async ({ orderListPage }) => {
    // ACTION: pick "open" in the Status filter
    await orderListPage.selectStatusFilter('open');

    // CHECK: the URL has status=open
    await orderListPage.expectUrlParam('status', 'open');

    // ACTION: clear it again
    await orderListPage.clearAllFilters();
  });

  test('finds the latest order by searching its id', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: newest order of the company
    const order = await findLatestOrder(db.hub, hubCompanyId);

    // ACTION + CHECK: search the id, the row shows
    await orderListPage.searchByOrderId(order.order_id);
  });

  test('clearing the filter shows orders again', async ({ orderListPage }) => {
    // ACTION: filter, then clear
    await orderListPage.selectStatusFilter('open');
    await orderListPage.clearAllFilters();

    // CHECK: the table has rows
    await expect(orderListPage.rows.first()).toBeVisible();
  });

  test('shows the same order count as the database', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: number of orders of the company
    const dbCount = await countOrders(db.hub, hubCompanyId);

    // CHECK: N in "1-10 of N"
    await expect.poll(() => orderListPage.totalCount()).toBe(dbCount);
  });

  test('exports selected orders', async ({ orderListPage }) => {
    // ACTION + CHECK: tick the first 3 rows → Export → confirm → "Successfully requested!"
    await orderListPage.selectRows([0, 1, 2]);
    await orderListPage.exportSelected();
  });

  test('marks a searched order as fulfilled', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: newest open or fulfilled checkout order without subscription
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No open/fulfilled checkout order without subscription');

    // ACTION + CHECK: search → tick the row → "Mark fulfilled" → confirm → success message
    await orderListPage.searchByOrderId(order!.order_id);
    await orderListPage.selectOrder(order!.order_id);
    await orderListPage.markSelectedFulfilled();
  });

  test('pages forward, back, to the end and to the start', async ({ orderListPage }) => {
    // ACTION + CHECK: the label shows which rows are on the page
    await expect(orderListPage.paginationText).toContainText('1-10');
    await orderListPage.goToPage('next');
    await expect(orderListPage.paginationText).toContainText('11-20');
    await orderListPage.goToPage('prev');
    await expect(orderListPage.paginationText).toContainText('1-10');
    await orderListPage.goToPage('last');
    await orderListPage.goToPage('first');
    await expect(orderListPage.paginationText).toContainText('1-10');
  });

  test('filters by status=open', async ({ orderListPage }) => {
    // ACTION + CHECK: the URL has the filter
    await orderListPage.selectStatusFilter('open');
    await orderListPage.expectUrlParam('status', 'open');
  });

  test('filters by payment_status=paid', async ({ orderListPage }) => {
    // ACTION + CHECK: the URL has the filter
    await orderListPage.selectPaymentStatusFilter('paid');
    await orderListPage.expectUrlParam('payment_status', 'paid');
  });

  test('opens the Draft tab', async ({ orderListPage }) => {
    // ACTION + CHECK: the URL contains "draft"
    await orderListPage.openTab('Draft');
  });

  test('opens the Consumable tab', async ({ orderListPage }) => {
    // ACTION + CHECK: the URL contains "consumable"
    await orderListPage.openTab('Consumable');
  });
});
