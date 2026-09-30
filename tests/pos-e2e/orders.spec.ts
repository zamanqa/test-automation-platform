import { test, expect } from '@fixtures';
import { env } from '@config/env';
import {
  countRetailerQuotes,
  countRetailerQuotesByStatus,
  findDraftOrder,
  findNewestRetailerQuote,
  findRetailer,
} from '@db/queries/hub/pos';

/**
 * WHAT:   POS Order list: count = DB, columns, search by quote id, Status filter (Open, Completed = DB), paging,
 *         and the order page of a quote (its data + checkout link = draft_orders).
 * NEEDS:  quotes of the POS retailer in draft_orders (not made for a qa_auto customer).
 * CHANGES DATA: no.
 * posPage methods ← src/pages/pos/PosPage.ts
 */
test.describe('POS - order list', () => {
  test.beforeEach(async ({ posPage }) => {
    await posPage.login();
  });

  test('shows the order list with the number of quotes from the DB', async ({ posPage, db }) => {
    // SETUP: quotes of the retailer (not deleted) ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const total = await countRetailerQuotes(db.hub, retailer.retailer_id, retailer.company_id);

    // ACTION: open the Order list
    await posPage.openOrderList();

    // CHECK: tab "Order list (<total>)", the columns, and "... of <total> results"
    expect(await posPage.tabCount('Order list')).toBe(total);
    for (const column of ['ID', 'Created at', 'Customer', 'Amount', 'Status']) {
      await expect(posPage.page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    await expect(posPage.pageInfo()).toContainText(`of ${total} results`);
  });

  test('finds a quote by its id', async ({ posPage, db }) => {
    // SETUP: newest quote of the retailer ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const quote = await findNewestRetailerQuote(db.hub, retailer.retailer_id, retailer.company_id);
    test.skip(!quote, 'no quote for this retailer');

    // ACTION: search the quote id
    await posPage.openOrderList();
    await posPage.search(quote!.draft_id);

    // CHECK: one row, with that quote id
    await expect(posPage.rows()).toHaveCount(1);
    await expect(posPage.rows().first().getByRole('link', { name: quote!.draft_id })).toBeVisible();
  });

  test('Status filter "Open" shows only open quotes, as many as in the DB', async ({ posPage, db }) => {
    // SETUP: number of open quotes ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const open = await countRetailerQuotesByStatus(db.hub, retailer.retailer_id, retailer.company_id, 'open');

    // ACTION: Status → Open
    await posPage.openOrderList();
    await posPage.filterStatus('Open');

    // CHECK: URL has status=open, "... of <open> results", no "completed" row
    await expect(posPage.page).toHaveURL(/status=open/);
    await expect(posPage.pageInfo()).toContainText(`of ${open} results`);
    await expect(posPage.page.getByRole('cell', { name: 'completed', exact: true })).toHaveCount(0);
  });

  test('Status filter "Completed" shows only completed quotes, as many as in the DB', async ({ posPage, db }) => {
    // SETUP: number of completed quotes ← hub db
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const completed = await countRetailerQuotesByStatus(db.hub, retailer.retailer_id, retailer.company_id, 'completed');

    // ACTION: Status → Completed
    await posPage.openOrderList();
    await posPage.filterStatus('Completed');

    // CHECK: URL has status=completed, "... of <completed> results", no "open" row
    await expect(posPage.page).toHaveURL(/status=completed/);
    await expect(posPage.pageInfo()).toContainText(`of ${completed} results`);
    await expect(posPage.page.getByRole('cell', { name: 'open', exact: true })).toHaveCount(0);
  });

  test('goes to the next page of the list', async ({ posPage }) => {
    // ACTION: open the list, click "next page"
    await posPage.openOrderList();
    await expect(posPage.pageInfo()).toContainText('Showing 1 to 5');
    await posPage.pagingButton(2).click();

    // CHECK: the second page is shown
    await expect(posPage.pageInfo()).toContainText('Showing 6 to 10');
  });

  test('shows a quote with its customer, items and checkout link', async ({ posPage, db }) => {
    // SETUP: newest quote of the retailer ← hub db (draft_orders)
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const quote = await findNewestRetailerQuote(db.hub, retailer.retailer_id, retailer.company_id);
    test.skip(!quote, 'no quote for this retailer');
    const row = await findDraftOrder(db.hub, quote!.draft_id);

    // ACTION: open the quote from the list
    await posPage.openOrderList();
    await posPage.search(quote!.draft_id);
    await posPage.rows().first().getByRole('link', { name: quote!.draft_id }).click();

    // CHECK: order page with customer, addresses, total, and the checkout link from the DB
    await expect(posPage.page.getByRole('heading', { name: `#${quote!.draft_id}` })).toBeVisible();
    await expect(posPage.page.getByText('Shipping information')).toBeVisible();
    await expect(posPage.page.getByText('Billing information')).toBeVisible();
    await expect(posPage.page.getByText('Total price')).toBeVisible();
    await expect(posPage.checkoutLink()).toHaveAttribute('href', row!.order_checkout_link);
  });
});
