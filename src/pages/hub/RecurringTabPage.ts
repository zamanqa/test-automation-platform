import { expect, type Locator, type Page } from '@playwright/test';

// Hub → Recurring payments tab: list, search, row menu actions.
export class RecurringTabPage {
  readonly searchInput: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly dialog: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.locator('main').getByRole('textbox', { name: 'Search...' });
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.dialog = page.getByRole('dialog');
  }

  /** Opens the list without the default "billing date next 30 days" filter, optionally with more URL filters. */
  async openList(filters: Record<string, string> = {}) {
    const query = new URLSearchParams(filters);
    if (!query.has('billing_date')) query.set('billing_date', '');
    await this.page.goto(`en/cms/recurring-payments?${query.toString()}`);
    await expect(this.paginationText).toBeVisible();
  }

  /** N from "1-10 of N". */
  async total(): Promise<number> {
    const label = (await this.paginationText.textContent()) ?? '';
    return Number(label.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /** Row of a recurring payment by its id (the ID column). */
  row(id: string): Locator {
    return this.rows.filter({ has: this.page.locator('td', { hasText: new RegExp(`^\\s*${id}\\s*$`) }) });
  }

  /** Opens the row menu and waits until `loadedItem` is enabled (the items are disabled while the row loads); the menu stays open. */
  async openRowMenuLoaded(id: string, loadedItem: string) {
    const menuItem = this.page.getByRole('menuitem', { name: loadedItem, exact: true });
    await expect(async () => {
      await this.page.keyboard.press('Escape');
      await this.row(id).locator('td').last().locator('button').click();
      await expect(menuItem).toBeEnabled({ timeout: 3_000 });
    }, `recurring payment ${id}: menu loaded`).toPass({ timeout: 30_000 });
  }

  /** A menu item of the open row menu. */
  menuItem(name: string): Locator {
    return this.page.getByRole('menuitem', { name, exact: true });
  }

  /** Row menu → item, waiting until the item is enabled (max 30 s). */
  async runRowAction(id: string, item: string) {
    const menuItem = this.page.getByRole('menuitem', { name: item, exact: true });
    await expect(async () => {
      await this.page.keyboard.press('Escape');
      await this.row(id).locator('td').last().locator('button').click();
      await expect(menuItem).toBeEnabled({ timeout: 3_000 });
    }, `recurring payment ${id}: "${item}" should be enabled`).toPass({ timeout: 30_000 });
    await menuItem.click();
  }

  /** Edit dialog: types the Item Amount (without "Change all future payments"). */
  async setAmount(amount: string) {
    await this.dialog.getByRole('spinbutton', { name: 'Item Amount' }).fill(amount);
  }

  /** Quantity field of the edit dialog (locked for normal subscriptions). */
  get quantityInput(): Locator {
    return this.dialog.getByRole('spinbutton', { name: 'Quantity' });
  }

  /** "Submit changes" button of the edit dialog. */
  get submitChangesButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Submit changes' });
  }

  /** Dialogs with "I understand the consequences." → Submit. */
  async confirmConsequences() {
    await this.page.getByText('I understand the consequences.').click();
    await this.dialog.getByRole('button', { name: 'Submit' }).click();
  }

  /** Waits for `message` and clicks Close. */
  async closeDialog(message = 'Successfully requested!') {
    await expect(this.page.getByText(message)).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Close' }).click();
  }
}
