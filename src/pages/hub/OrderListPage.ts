import { expect, type Locator, type Page } from '@playwright/test';

// Hub → Orders list.
// Like every page object: the fixture creates it with the browser page, the constructor sets up
// the locators, and Playwright waits for an element when a method clicks or checks it.
export class OrderListPage {
  readonly searchInput: Locator;
  readonly clearFiltersButton: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly exportButton: Locator;
  readonly markFulfilledButton: Locator;
  readonly successMessage: Locator;

  // `private readonly page` = TypeScript shorthand: stores the argument as this.page.
  constructor(private readonly page: Page) {
    this.searchInput = page.locator('.w-64 input[placeholder="Search..."]');
    this.clearFiltersButton = page.locator('button', { hasText: 'Clear' }).first();
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.exportButton = page.locator('button', { hasText: 'Export' });
    this.markFulfilledButton = page.locator('button', { hasText: 'Mark fulfilled' }).first();
    this.successMessage = page.locator('p', { hasText: 'Successfully requested!' });
  }

  /** Opens {HUB_URL}en/cms/orders and waits for the first table row. */
  async goto() {
    await this.page.goto('en/cms/orders');
    await expect(this.rows.first()).toBeVisible();
  }

  /** Opens the list with no filters and (optionally) searches for one order. */
  async open(orderId?: string) {
    await this.goto();
    await this.clearAllFilters();
    if (orderId) await this.searchByOrderId(orderId);
  }

  /** Clicks "Clear" if a filter is active (does nothing otherwise). */
  async clearAllFilters() {
    if (await this.clearFiltersButton.isVisible()) {
      await this.clearFiltersButton.click();
    }
  }

  // ---------- filters ----------

  private filterButton(name: string) {
    return this.page.locator('button[aria-haspopup="listbox"]', { hasText: name }).first();
  }

  /** In an open filter dropdown, clicks the option whose text equals `value` (case-insensitive). */
  private async pickOption(value: string) {
    await expect(this.page.locator('div[role="listbox"][aria-labelledby]')).toBeVisible();
    await this.page
      .locator('div[role="listbox"] div[role="option"]')
      .filter({ has: this.page.locator('span.block', { hasText: new RegExp(`^\\s*${value}\\s*$`, 'i') }) })
      .first()
      .click();
  }

  /** Status dropdown → option, e.g. 'open'. The page then adds status=open to the URL. */
  async selectStatusFilter(status: string) {
    await this.filterButton('Status').click();
    await this.pickOption(status);
  }

  /** Payment status dropdown → option, e.g. 'paid'. */
  async selectPaymentStatusFilter(paymentStatus: string) {
    await this.filterButton('Payment status').click();
    await this.pickOption(paymentStatus);
  }

  /** Checks the URL contains name=value (e.g. status=open). */
  async expectUrlParam(name: string, value: string) {
    await expect(this.page).toHaveURL(new RegExp(`${name}=${value}`));
  }

  // ---------- tabs ----------

  async openTab(name: 'Draft' | 'Consumable') {
    await this.page.locator('a', { hasText: name }).first().click();
    await expect(this.page).toHaveURL(new RegExp(name.toLowerCase()));
    await expect(this.rows.first(), `rows on the "${name}" tab`).toBeVisible();
  }

  // ---------- search + table ----------

  async searchByOrderId(orderId: string) {
    await this.searchInput.fill(orderId);
    await this.expectOrderInTable(orderId);
  }

  /** Checks the order id is visible in the table. */
  async expectOrderInTable(orderId: string) {
    await expect(this.page.locator('tbody').getByText(orderId).first()).toBeVisible();
  }

  /**
   * Opens the searched order: checks it is in the search result, then loads its page directly.
   * (A click in the list can leave the previous record loaded behind the new URL,
   * so actions could hit the wrong order.)
   */
  async openFirstOrder(orderId: string) {
    const link = this.page.locator(`tbody a[href*="/cms/orders/${orderId}"]`).first();
    await expect(link, `order ${orderId} in the search result`).toBeVisible();
    await this.page.goto(`en/cms/orders/${orderId}`);
    await expect(this.page).toHaveURL(new RegExp(`/orders/${orderId}`));
    await expect(this.page.getByRole('tab', { name: 'General' })).toBeVisible();
  }

  /** Total from the "1-10 of N" pagination label. */
  async totalCount(): Promise<number> {
    const text = (await this.paginationText.textContent()) ?? '';
    return Number(text.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  // ---------- pagination ----------

  async goToPage(which: 'first' | 'prev' | 'next' | 'last') {
    const testId = { first: 'btn-go-to-first', prev: 'btn-prev-page', next: 'btn-next-page', last: 'btn-go-to-last' }[which];
    await this.page.getByTestId(testId).first().click();
  }

  // ---------- row menu ----------

  /** Row menu (…) of the order with this id → "View customer" → customer page opens. */
  async viewCustomerOf(orderId: string) {
    const row = this.rows.filter({ has: this.page.locator(`a[href*="/cms/orders/${orderId}"]`) }).first();
    await row.locator('button[aria-haspopup="menu"]').click();
    await this.page.getByRole('menuitem', { name: 'View customer', exact: true }).dispatchEvent('click');
    await expect(this.page).toHaveURL(/\/cms\/customers\//);
  }

  // ---------- advanced filter ("Filter" button → Add new filter) ----------

  /** Filter → Filter key → (default operator of that key, e.g. "Is" for ID) → Value → "Add new filter" → Search. */
  async addAdvancedFilter(key: string, value: string) {
    await this.page.getByRole('button', { name: /^Filter/ }).first().click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Add new filter' })).toBeVisible();
    await dialog.getByRole('button', { name: /^Filter key/ }).click();
    await this.page.getByRole('option', { name: key, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Value' }).fill(value);
    await dialog.getByRole('button', { name: 'Add new filter' }).click();
    await dialog.getByRole('button', { name: 'Search' }).click();
  }

  // ---------- Draft tab (quotes) and Consumable tab ----------

  /** Link of the first quote's "Checkout link" on the Draft tab. */
  async firstQuoteCheckoutLink(): Promise<string> {
    const link = this.page.getByRole('link', { name: 'Checkout link' }).first();
    await expect(link).toBeVisible();
    return (await link.getAttribute('href')) ?? '';
  }

  /** Consumable tab: "Process" on the first row → the "Process consumable order" dialog shows → Close (nothing processed). */
  async openAndCloseConsumableProcess() {
    await this.rows.first().getByRole('button', { name: 'Process', exact: true }).click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Process consumable order' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Process order' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
  }

  // ---------- selection + bulk actions ----------

  async selectRows(indices: number[]) {
    const boxes = this.page.locator('tbody input[type="checkbox"]');
    for (const index of indices) {
      await boxes.nth(index).check({ force: true });
    }
  }

  /** Ticks the checkbox of the row that contains this order id. */
  async selectOrder(orderId: string) {
    const row = this.rows.filter({ has: this.page.locator(`a[href*="/cms/orders/${orderId}"]`) });
    await row.getByRole('checkbox').click();
    // ticking a row enables the bulk buttons
    await expect(this.markFulfilledButton, `"Mark fulfilled" after ticking order ${orderId}`).toBeEnabled();
  }

  /** Bulk action confirm dialog: submit → "Successfully requested!" → close. */
  private async confirmBulkAction() {
    await this.page.locator('button[data-cy="btn-submit"]').click();
    await expect(this.successMessage).toBeVisible();
    await this.page.locator('button[data-cy="btn-close"]').click();
  }

  /** Export → confirm → "Successfully requested!" → close. Tick rows first (selectRows). */
  async exportSelected() {
    await this.exportButton.click();
    await this.confirmBulkAction();
  }

  /** "Mark fulfilled" → confirm → "Successfully requested!" → close. Tick rows first. */
  async markSelectedFulfilled() {
    await this.markFulfilledButton.click();
    await this.confirmBulkAction();
  }
}
