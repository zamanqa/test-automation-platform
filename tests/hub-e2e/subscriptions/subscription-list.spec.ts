import { test, expect } from '@fixtures';
import { countSubscriptions } from '@db/queries/hub/subscriptions';

// Hub → Subscriptions list: totals, filters, export, pagination.
// Changes data: requests an export file.
// totalCount() = N from "1-10 of N" right now, stableTotal() = N once the list stopped reloading.
test.describe('Hub - subscription list', () => {
  test.beforeEach(async ({ subscriptionListPage }) => {
    await subscriptionListPage.goto();
  });

  test('shows a total after clearing all filters', async ({ subscriptionListPage, db, hubCompanyId }) => {
    // ACTION: clear filters
    await subscriptionListPage.clearAllFilters();

    // CHECK: the list shows at least one subscription
    expect(await subscriptionListPage.stableTotal()).toBeGreaterThan(0);

    // INFO only: the database total is shown in the report
    const dbTotal = await countSubscriptions(db.hub, hubCompanyId);
    test.info().annotations.push({ type: 'database total', description: String(dbTotal) });
  });

  test('filters by status Active and matches the database count', async ({ subscriptionListPage, db, hubCompanyId, page }) => {
    // ACTION: Status = Active
    await subscriptionListPage.clearAllFilters();
    await subscriptionListPage.filterByStatus('Active');
    const dbTotal = await countSubscriptions(db.hub, hubCompanyId, { status: 'active' });

    // CHECK: the total on the page = the database count, and the rows are active
    await expect.poll(() => subscriptionListPage.totalCount()).toBe(dbTotal);
    await expect(page.locator('tbody td', { hasText: /^\s*active\s*$/i }).first()).toBeVisible();
  });

  test('filters by type Consumable and matches the database count', async ({ subscriptionListPage, db, hubCompanyId }) => {
    // ACTION: Type = Consumable
    await subscriptionListPage.clearAllFilters();
    await subscriptionListPage.filterByType('Consumable');
    const dbTotal = await countSubscriptions(db.hub, hubCompanyId, { type: 'consumable' });

    // CHECK
    await expect.poll(() => subscriptionListPage.totalCount()).toBe(dbTotal);
  });

  test('selects all filtered rows and exports them', async ({ subscriptionListPage }) => {
    // ACTION: Active + Consumable → header checkbox → Export → Export in dialog → close
    await subscriptionListPage.clearAllFilters();
    await subscriptionListPage.filterByStatus('Active');
    await subscriptionListPage.filterByType('Consumable');
    await subscriptionListPage.selectAllRows();

    // CHECK: every row is ticked, and the export says "Successfully requested!"
    await subscriptionListPage.expectAllRowsChecked();
    await subscriptionListPage.exportSelected();
  });

  test.describe('pagination', () => {
    test('starts on page 1 with back buttons disabled', async ({ subscriptionListPage }) => {
      // CHECK: label "1-<n> of <N>", first/prev disabled, next/last enabled
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-\d+ of \d+\s*$/);
      await expect(subscriptionListPage.firstPageButton).toBeDisabled();
      await expect(subscriptionListPage.prevPageButton).toBeDisabled();
      await expect(subscriptionListPage.nextPageButton).toBeEnabled();
      await expect(subscriptionListPage.lastPageButton).toBeEnabled();
    });

    test('goes to the next page and back', async ({ subscriptionListPage }) => {
      // ACTION + CHECK: next page, the back buttons are enabled
      await subscriptionListPage.nextPageButton.click();
      await expect.poll(() => subscriptionListPage.rangeStart()).toBeGreaterThan(1);
      await expect(subscriptionListPage.prevPageButton).toBeEnabled();
      await expect(subscriptionListPage.firstPageButton).toBeEnabled();

      // ACTION + CHECK: previous page, back on "1-", the back buttons are disabled
      await subscriptionListPage.prevPageButton.click();
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-/);
      await expect(subscriptionListPage.prevPageButton).toBeDisabled();
      await expect(subscriptionListPage.firstPageButton).toBeDisabled();
    });

    test('jumps to the last page and back to the first', async ({ subscriptionListPage }) => {
      // SETUP: first row number of the last page, e.g. total 523 → 521 (10 per page)
      const total = await subscriptionListPage.stableTotal();
      const lastPageStart = (Math.ceil(total / 10) - 1) * 10 + 1;

      // ACTION + CHECK: last page, the forward buttons are disabled
      await subscriptionListPage.lastPageButton.click();
      await expect.poll(() => subscriptionListPage.rangeStart()).toBe(lastPageStart);
      await expect(subscriptionListPage.nextPageButton).toBeDisabled();
      await expect(subscriptionListPage.lastPageButton).toBeDisabled();

      // ACTION + CHECK: first page
      await subscriptionListPage.firstPageButton.click();
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-/);
    });

    test('changes the page size to 25 and back to 10', async ({ subscriptionListPage }) => {
      // ACTION + CHECK: 25 per page, the range ends at 25 (or at the total if smaller)
      await subscriptionListPage.changePageSize(25);
      const total = await subscriptionListPage.stableTotal();
      await expect.poll(() => subscriptionListPage.rangeEnd()).toBe(Math.min(25, total));

      // ACTION + CHECK: back to 10
      await subscriptionListPage.changePageSize(10);
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-10 of/);
    });

    test('keeps the filtered total when paging', async ({ subscriptionListPage }) => {
      // SETUP: filter Active; needs more than 10 results
      await subscriptionListPage.filterByStatus('Active');
      const total = await subscriptionListPage.stableTotal();
      test.skip(total <= 10, 'Needs more than one page of active subscriptions');

      // ACTION: next page
      await subscriptionListPage.nextPageButton.click();

      // CHECK: page 2 and the total did not change
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*11-/);
      expect(await subscriptionListPage.totalCount()).toBe(total);
    });
  });
});
