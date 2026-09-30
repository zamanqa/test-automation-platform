import { expect, type Locator, type Page } from '@playwright/test';

/** Hub → Order detail. Selectors carried over from hub-e2e-automation OrderDetailPage.js. */
export class OrderDetailPage {
  readonly productRows: Locator;
  readonly successMessage: Locator;

  /** Created per test by the fixture of the same name (src/fixtures/index.ts); `page` = Playwright's browser tab. */
  constructor(private readonly page: Page) {
    this.productRows = page.locator('tbody tr.v-data-table__tr');
    this.successMessage = page.locator('p', { hasText: 'Successfully requested!' });
  }

  /** Checks the URL is /orders/{orderId}. */
  async expectOrder(orderId: string) {
    await expect(this.page).toHaveURL(new RegExp(`/orders/${orderId}`));
  }

  // ---------- notes ----------

  async createNote(message: string) {
    await this.page.locator('button', { hasText: 'Create note' }).click();
    await this.page.locator('textarea[path="message"]').fill(message);
    await this.page.locator('[data-cy="btn-submit"]').click();
  }

  /** Checks a note with this text is visible in the notes list. */
  async expectNote(message: string) {
    await expect(this.page.locator('[data-test-id="note-message"]').filter({ hasText: message })).toBeVisible();
  }

  /** Opens the menu (…) of the note with this text and picks "Edit note" or "Delete note". */
  private async noteMenu(message: string, action: 'Edit note' | 'Delete note') {
    const note = this.page.locator('[data-test-id="note-message"]').filter({ hasText: message }).first();
    // the note's menu button sits a few levels above the message text
    await note.locator('xpath=ancestor::*[4]').locator('button[aria-haspopup="menu"]').first().click();
    await this.page.getByRole('menuitem', { name: action }).click();
  }

  /** Note menu → "Edit note" → new text → Edit. */
  async editNote(oldMessage: string, newMessage: string) {
    await this.noteMenu(oldMessage, 'Edit note');
    const dialog = this.page.getByRole('dialog').last();
    await dialog.getByRole('textbox', { name: 'Message' }).fill(newMessage);
    await dialog.getByRole('button', { name: 'Edit' }).click();
  }

  /** Note menu → "Delete note" (deletes straight away, no confirm dialog) → the note disappears. */
  async deleteNote(message: string) {
    await this.noteMenu(message, 'Delete note');
    await expect(this.page.locator('[data-test-id="note-message"]').filter({ hasText: message })).toHaveCount(0);
  }

  // ---------- tag ----------

  /**
   * The small "tag" button next to the order title → "Create tag" dialog → pick a tag → Save changes.
   * The tags are a fixed list (delivered, delivery, ..., test order, verified).
   */
  async setTag(tag: string) {
    await this.page.getByRole('button', { name: 'tag', exact: true }).first().click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Create tag' })).toBeVisible();
    await dialog.getByRole('combobox').first().click(); // opens the list (the inner input cannot be typed in)
    await this.page.getByRole('option', { name: tag, exact: true }).click();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
  }

  // ---------- "Process subscriptions" (one dialog for all products of the order) ----------

  /**
   * "Process subscriptions" → the dialog lists every product of the order, each with its own
   * "Generate" (serial number) and "Submit". Submits the FIRST product only; returns nothing.
   */
  async processFirstSubscription() {
    await this.page.getByRole('button', { name: 'Process subscriptions' }).click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Create subscriptions' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Submit' }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Generate' }).first().click();
    await dialog.getByRole('button', { name: 'Submit' }).first().click();
  }

  // ---------- tabs ----------

  /** Clicks a tab on the order page and checks its table shows at least one row. */
  async expectTabHasRows(name: 'Payment methods' | 'History' | 'Products' | 'Subscriptions') {
    // "Products" and "Subscriptions" are sub-tabs inside the General tab and appear a few seconds later
    await expect(this.page.getByRole('tab', { name, exact: true }), `"${name}" tab`).toBeVisible({ timeout: 30_000 });
    await this.page.getByRole('tab', { name, exact: true }).click();
    await expect(this.page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(this.page.locator('main tbody tr:visible').first(), `rows on the "${name}" tab`).toBeVisible();
  }

  // ---------- subscriptions per product row ----------

  /** Row indexes that still show a "Create subscription" button. */
  async rowsWithoutSubscription(): Promise<number[]> {
    const indexes: number[] = [];
    const count = await this.productRows.count();
    for (let i = 0; i < count; i++) {
      if (await this.productRows.nth(i).locator('button', { hasText: 'Create subscription' }).count()) indexes.push(i);
    }
    return indexes;
  }

  /** Subscription type shown in column 9 of a product row (normal / consumable / digital ...). */
  async subscriptionTypeOf(rowIndex: number): Promise<string> {
    return ((await this.productRows.nth(rowIndex).locator('td').nth(8).textContent()) ?? '').trim().toLowerCase();
  }

  /** Waits until the "Product list" shows its "Create subscription" buttons (it loads after the order info). */
  async waitForCreateSubscriptionButtons() {
    await expect(this.page.getByRole('button', { name: 'Create subscription' }).first()).toBeVisible({ timeout: 60_000 });
  }

  /** Index of the first product row of this type (normal / consumable ...) that still has "Create subscription", or -1. */
  async firstRowWithoutSubscription(type: string): Promise<number> {
    for (const row of await this.rowsWithoutSubscription()) {
      if ((await this.subscriptionTypeOf(row)) === type) return row;
    }
    return -1;
  }

  /** Product name shown in the "Product" column of a product row (first line; the SKU is the second line). */
  async productNameOf(rowIndex: number): Promise<string> {
    const text = (await this.productRows.nth(rowIndex).locator('td').nth(2).innerText()).trim();
    return text.split('\n')[0].trim();
  }

  /** Clicks the customer id link (cus_…) on the order page; returns that id. */
  async openCustomer(): Promise<string> {
    const link = this.page.locator('a[href*="/cms/customers/cus_"]').first();
    const customerId = (await link.innerText()).trim();
    await link.click();
    await expect(this.page).toHaveURL(new RegExp(`/cms/customers/${customerId}`));
    return customerId;
  }

  /** Opens the dialog, generates a serial number (not for digital), submits and closes. */
  async createSubscription(rowIndex: number, type: string) {
    await this.productRows.nth(rowIndex).locator('button', { hasText: 'Create subscription' }).click();
    await expect(this.page.getByText('Create a subscription for the order to start charging recurring payments')).toBeVisible();
    if (type !== 'digital') {
      await this.page.locator('[data-cy="btn-serial-number-generate"]').click();
    }
    await this.page.locator('button', { hasText: 'Submit' }).click();
    await expect(this.successMessage).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
  }

  /** Subscription id from the link in the first cell of a product row. */
  async subscriptionIdOf(rowIndex: number): Promise<string> {
    const link = this.productRows.nth(rowIndex).locator('td').first().locator('a[href*="/subscriptions/"]');
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    return href.split('/subscriptions/')[1];
  }
}
