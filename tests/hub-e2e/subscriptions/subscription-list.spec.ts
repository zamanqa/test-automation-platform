// test, expect        ← src/fixtures/index.ts
// countSubscriptions  ← src/db/queries/hub/subscriptions.ts
import { test, expect } from '@fixtures';
import { countSubscriptions } from '@db/queries/hub/subscriptions';

/**
 * WHAT:   Hub UI → Subscriptions list: totals vs database, filters, export, pagination.
 * FROM:   hub-e2e-automation cypress/e2e/02-subscription-page/subscriptionListpage.cy.js (9 tests).
 * CHANGES DATA: only "export" (requests an export file).
 * subscriptionListPage methods ← src/pages/hub/SubscriptionListPage.ts
 * totalCount()  = N from the label "1-10 of N" right now
 * stableTotal() = N once the list stopped reloading (use it right after a filter or reload)
 */
test.describe('Hub - subscription list', () => {
  // Before each test: open /en/cms/subscriptions and wait for the pagination label
  test.beforeEach(async ({ subscriptionListPage }) => {
    await subscriptionListPage.goto();
  });

  test('shows a total after clearing all filters', async ({ subscriptionListPage, db, hubCompanyId }) => {
    // ACTION: clear filters
    await subscriptionListPage.clearAllFilters();

    // CHECK: the list shows at least one subscription
    expect(await subscriptionListPage.stableTotal()).toBeGreaterThan(0);
    // INFO only (Cypress only logged it): database total → report annotation
    const dbTotal = await countSubscriptions(db.hub, hubCompanyId);
    test.info().annotations.push({ type: 'database total', description: String(dbTotal) });
  });

  test('filters by status Active and matches the database count', async ({ subscriptionListPage, db, hubCompanyId, page }) => {
    // ACTION: clear, then Status = Active
    await subscriptionListPage.clearAllFilters();
    await subscriptionListPage.filterByStatus('Active');
    // SETUP for the check: active subscriptions of the company ← hub db
    const dbTotal = await countSubscriptions(db.hub, hubCompanyId, { status: 'active' });

    // CHECK: UI total equals the database count; the table shows "active" rows
    await expect.poll(() => subscriptionListPage.totalCount()).toBe(dbTotal);
    await expect(page.locator('tbody td', { hasText: /^\s*active\s*$/i }).first()).toBeVisible();
  });

  test('filters by type Consumable and matches the database count', async ({ subscriptionListPage, db, hubCompanyId }) => {
    // ACTION: clear, then Type = Consumable
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
    // CHECK: every row checkbox is ticked
    await subscriptionListPage.expectAllRowsChecked();
    // exportSelected() also checks "Successfully requested!"
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
      // ACTION: next page → CHECK: range starts after 1, back buttons enabled
      await subscriptionListPage.nextPageButton.click();
      await expect.poll(() => subscriptionListPage.rangeStart()).toBeGreaterThan(1);
      await expect(subscriptionListPage.prevPageButton).toBeEnabled();
      await expect(subscriptionListPage.firstPageButton).toBeEnabled();

      // ACTION: previous page → CHECK: back on "1-", back buttons disabled
      await subscriptionListPage.prevPageButton.click();
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-/);
      await expect(subscriptionListPage.prevPageButton).toBeDisabled();
      await expect(subscriptionListPage.firstPageButton).toBeDisabled();
    });

    test('jumps to the last page and back to the first', async ({ subscriptionListPage }) => {
      // SETUP: expected first record of the last page, e.g. total 523 → 521 (page size 10)
      const total = await subscriptionListPage.stableTotal();
      const lastPageStart = (Math.ceil(total / 10) - 1) * 10 + 1; // default page size 10

      // ACTION: last page → CHECK: correct range, forward buttons disabled
      await subscriptionListPage.lastPageButton.click();
      await expect.poll(() => subscriptionListPage.rangeStart()).toBe(lastPageStart);
      await expect(subscriptionListPage.nextPageButton).toBeDisabled();
      await expect(subscriptionListPage.lastPageButton).toBeDisabled();

      // ACTION: first page → CHECK: back on "1-"
      await subscriptionListPage.firstPageButton.click();
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-/);
    });

    test('changes the page size to 25 and back to 10', async ({ subscriptionListPage }) => {
      // ACTION: 25 per page → CHECK: range ends at 25 (or at the total if smaller)
      await subscriptionListPage.changePageSize(25);
      const total = await subscriptionListPage.stableTotal();
      await expect.poll(() => subscriptionListPage.rangeEnd()).toBe(Math.min(25, total));

      // ACTION: back to 10 → CHECK
      await subscriptionListPage.changePageSize(10);
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*1-10 of/);
    });

    test('keeps the filtered total when paging', async ({ subscriptionListPage }) => {
      // SETUP: filter Active; needs more than 10 results (else skipped)
      await subscriptionListPage.filterByStatus('Active');
      const total = await subscriptionListPage.stableTotal();
      test.skip(total <= 10, 'Needs more than one page of active subscriptions');

      // ACTION: next page
      await subscriptionListPage.nextPageButton.click();

      // CHECK: page 2 ("11-...") and the total did not change
      await expect(subscriptionListPage.paginationText).toHaveText(/^\s*11-/);
      expect(await subscriptionListPage.totalCount()).toBe(total);
    });
  });
});
