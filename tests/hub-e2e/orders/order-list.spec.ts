// test, expect ← src/fixtures/index.ts (gives: orderListPage, db, hubCompanyId ...)
// count/find... ← src/db/queries/hub/orders.ts
import { test, expect } from '@fixtures';
import { countOrders, findCheckoutOrderWithoutSubscription, findLatestOrder } from '@db/queries/hub/orders';

/**
 * WHAT:   Hub UI → Orders list: filters, search, count vs database, export, bulk fulfil,
 *         pagination, tabs.
 * FROM:   hub-e2e-automation cypress/e2e/01-order-page/orderList.cy.js (11 tests).
 * CHANGES DATA: yes — "export" requests an export; "marks as fulfilled" fulfils one order.
 * The browser is already logged in (tests/hub-e2e/auth.setup.ts).
 * orderListPage methods ← src/pages/hub/OrderListPage.ts
 * hubCompanyId ← company uid of HUB_COMPANY_NAME (.env), looked up once in the database.
 */
test.describe('Hub - order list', () => {
  // Before each test: open /en/cms/orders and clear any filter left from earlier
  test.beforeEach(async ({ orderListPage }) => {
    await orderListPage.open();
  });

  test('filters by status and clears the filter', async ({ orderListPage }) => {
    // ACTION: pick "open" in the Status filter
    await orderListPage.selectStatusFilter('open');
    // CHECK: the URL now carries status=open
    await orderListPage.expectUrlParam('status', 'open');
    // then clear it again
    await orderListPage.clearAllFilters();
  });

  test('finds the latest order by searching its id', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: newest order of the company ← hub db
    const order = await findLatestOrder(db.hub, hubCompanyId);

    // ACTION + CHECK: type the id in the search box; searchByOrderId() also waits until the row shows
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
    // SETUP: number of orders of the company ← hub db
    const dbCount = await countOrders(db.hub, hubCompanyId);

    // CHECK: "N" in the "1-10 of N" label ← totalCount(); poll until the list has loaded
    await expect.poll(() => orderListPage.totalCount()).toBe(dbCount);
  });

  test('exports selected orders', async ({ orderListPage }) => {
    // ACTION: tick rows 1-3 (index 0,1,2) → Export → confirm; exportSelected() waits for "Successfully requested!"
    await orderListPage.selectRows([0, 1, 2]);
    await orderListPage.exportSelected();
  });

  test('marks a searched order as fulfilled', async ({ orderListPage, db, hubCompanyId }) => {
    // SETUP: newest open/fulfilled checkout order without subscription ← hub db (else skipped)
    const order = await findCheckoutOrderWithoutSubscription(db.hub, hubCompanyId);
    test.skip(!order, 'No open/fulfilled checkout order without subscription');

    // ACTION: search it → tick its row → "Mark fulfilled" → confirm (waits for the success message)
    await orderListPage.searchByOrderId(order!.order_id);
    await orderListPage.selectOrder(order!.order_id);
    await orderListPage.markSelectedFulfilled();
  });

  test('pages forward, back, to the end and to the start', async ({ orderListPage }) => {
    // CHECK at each step: the "from-to" part of the pagination label
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
    // ACTION + CHECK: status filter → URL parameter
    await orderListPage.selectStatusFilter('open');
    await orderListPage.expectUrlParam('status', 'open');
  });

  test('filters by payment_status=paid', async ({ orderListPage }) => {
    // ACTION + CHECK: payment status filter → URL parameter
    await orderListPage.selectPaymentStatusFilter('paid');
    await orderListPage.expectUrlParam('payment_status', 'paid');
  });

  test('opens the Draft tab', async ({ orderListPage }) => {
    // ACTION + CHECK: click "Draft"; openTab() checks the URL contains "draft"
    await orderListPage.openTab('Draft');
  });

  test('opens the Consumable tab', async ({ orderListPage }) => {
    // ACTION + CHECK: click "Consumable"; URL contains "consumable"
    await orderListPage.openTab('Consumable');
  });
});
