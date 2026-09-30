import { expect, type Locator, type Page } from '@playwright/test';

/** Hub → Subscriptions list. Selectors carried over from hub-e2e-automation SubscriptionListPage.js. */
export class SubscriptionListPage {
  readonly searchInput: Locator;
  readonly clearFiltersButton: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly firstPageButton: Locator;
  readonly prevPageButton: Locator;
  readonly nextPageButton: Locator;
  readonly lastPageButton: Locator;

  /** Created per test by the fixture of the same name (src/fixtures/index.ts); `page` = Playwright's browser tab. */
  constructor(private readonly page: Page) {
    this.searchInput = page.locator('.w-64 input[placeholder="Search..."]');
    this.clearFiltersButton = page.locator('button', { hasText: 'Clear' }).first();
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.firstPageButton = page.getByTestId('btn-go-to-first').first();
    this.prevPageButton = page.getByTestId('btn-prev-page').first();
    this.nextPageButton = page.getByTestId('btn-next-page').first();
    this.lastPageButton = page.getByTestId('btn-go-to-last').first();
  }

  /** Opens {HUB_URL}en/cms/subscriptions and waits for the "1-10 of N" label. */
  async goto() {
    await this.page.goto('en/cms/subscriptions');
    await expect(this.paginationText).toBeVisible();
  }

  /** Clicks "Clear" if a filter is active (does nothing otherwise). */
  async clearAllFilters() {
    if (await this.clearFiltersButton.isVisible()) {
      await this.clearFiltersButton.click();
    }
  }

  /**
   * Opens a subscription's detail page directly by its URL (a fresh page load).
   * Not via list search + click: after the click the hub showed the new URL but kept the
   * PREVIOUS subscription loaded, so an action went to the wrong subscription (2026-09-28).
   * The list search itself is tested in subscription-list.spec.ts.
   */
  async openSubscription(subscriptionId: string) {
    await this.page.goto(`en/cms/subscriptions/${subscriptionId}`);
    await expect(this.page).toHaveURL(new RegExp(`/subscriptions/${subscriptionId}`));
    await expect(this.page.getByRole('tab', { name: 'General' })).toBeVisible();
  }

  // ---------- counts ----------

  async paginationLabel(): Promise<string> {
    return ((await this.paginationText.textContent()) ?? '').trim();
  }

  /** N from "1-10 of N". */
  async totalCount(): Promise<number> {
    return Number((await this.paginationLabel()).match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /**
   * Total once the list has finished (re)loading: non-zero and the same on two reads
   * half a second apart. Use this instead of totalCount() right after a filter/reload.
   */
  async stableTotal(): Promise<number> {
    let previous = -1;
    await expect
      .poll(
        async () => {
          const current = await this.totalCount();
          const settled = current > 0 && current === previous;
          previous = current;
          return settled;
        },
        { intervals: [500], timeout: 20_000 },
      )
      .toBe(true);
    return previous;
  }

  /** First record number shown, e.g. 11 from "11-20 of N". */
  async rangeStart(): Promise<number> {
    return Number((await this.paginationLabel()).split('-')[0]);
  }

  /** Last record number shown, e.g. 20 from "11-20 of N". */
  async rangeEnd(): Promise<number> {
    return Number((await this.paginationLabel()).split('-')[1]?.split(' ')[0]);
  }

  // ---------- filters ----------
  // The Cypress page object used these generated headlessui ids; kept as-is.

  async filterByStatus(status: string) {
    await this.applyFilter('#headlessui-listbox-button-v-0-2-3', status);
  }

  /** Type dropdown → option (e.g. 'Consumable'); waits until the list reloads. */
  async filterByType(type: string) {
    await this.applyFilter('#headlessui-listbox-button-v-0-2-5', type);
  }

  /**
   * Picks a filter option, then waits until the "1-10 of N" label changes — i.e. the
   * filtered list has loaded (Cypress waited a fixed 3s). A filter that does not change
   * the count is accepted after 10s.
   */
  private async applyFilter(dropdown: string, option: string) {
    const before = await this.paginationLabel();
    await this.page.locator(dropdown).click();
    await this.page.getByRole('option').filter({ hasText: option }).first().click();
    await expect(this.paginationText).not.toHaveText(before, { timeout: 10_000 }).catch(() => undefined);
  }

  // ---------- selection + export ----------

  async selectAllRows() {
    await this.page.locator('thead input[type="checkbox"]').check({ force: true });
  }

  /** Checks every row checkbox in the table is ticked. */
  async expectAllRowsChecked() {
    const boxes = this.page.locator('tbody input[type="checkbox"]');
    for (let i = 0; i < (await boxes.count()); i++) {
      await expect(boxes.nth(i)).toBeChecked();
    }
  }

  /** Export → Export in the dialog → "Successfully requested!" → Close. */
  async exportSelected() {
    await this.page.locator('button', { hasText: 'Export' }).first().click();
    await this.page.getByRole('dialog').locator('button', { hasText: 'Export' }).click();
    await expect(this.page.getByText('Successfully requested!')).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
  }

  // ---------- paging ----------

  async changePageSize(size: number) {
    await this.page.getByTestId('select-page-size').first().locator('button[aria-haspopup="listbox"]').click();
    await this.page.getByRole('listbox').getByRole('option').filter({ hasText: String(size) }).first().click();
    await expect(this.paginationText).toBeVisible();
  }
}
