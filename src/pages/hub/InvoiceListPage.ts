import { expect, type Locator, type Page } from '@playwright/test';

/** Hub → Invoices list and invoice page. */
export class InvoiceListPage {
  readonly searchInput: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly successMessage: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.locator('.w-64 input[placeholder="Search..."]');
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.successMessage = page.getByText('Successfully requested!');
  }

  /** Opens {HUB_URL}en/cms/invoices and waits for the "1-10 of N" label. */
  async goto() {
    await this.page.goto('en/cms/invoices');
    await expect(this.paginationText).toBeVisible();
  }

  /** Clicks "Clear" if a filter is active (does nothing otherwise). */
  async clearAllFilters() {
    const clear = this.page.locator('button', { hasText: 'Clear' }).first();
    if (await clear.isVisible()) await clear.click();
  }

  /** N from the label "1-10 of N" (0 if not readable). Use with expect.poll while the list loads. */
  async totalCount(): Promise<number> {
    return Number((((await this.paginationText.textContent()) ?? '').match(/of\s+(\d+)/) ?? [])[1] ?? 0);
  }

  /** Types the invoice number into the search box and waits until the first row shows it. */
  async search(invoiceNumber: string) {
    await this.searchInput.fill(invoiceNumber);
    await expect(this.rows.first()).toContainText(invoiceNumber);
  }

  /** Searches for an invoice and opens its detail page. */
  async openInvoice(invoiceNumber: string) {
    await this.clearAllFilters();
    await this.search(invoiceNumber);
    await this.rows.first().locator('a[href*="/invoices/"]').first().click({ force: true });
    await expect(this.page).toHaveURL(/\/invoices\//);
  }

  // ---------- filters ----------
  // generated headlessui ids, may break when the hub UI changes

  async filterByType(type: string) {
    await this.page.locator('#headlessui-listbox-button-v-0-2-3').click();
    await this.page.getByRole('option').filter({ hasText: type }).first().click();
    await expect(this.paginationText).toBeVisible();
  }

  /** Multi-select: opens the dropdown once, picks every status, then closes it. */
  async filterByStatus(...statuses: string[]) {
    await this.page.locator('#headlessui-listbox-button-v-0-2-5').click();
    for (const status of statuses) {
      await this.page.getByRole('option').filter({ hasText: status }).first().click();
    }
    await this.page.mouse.click(0, 0);
    await expect(this.paginationText).toBeVisible();
  }

  /** Payment status dropdown → option (e.g. 'Paid'). */
  async filterByPaymentStatus(status: string) {
    await this.page.locator('#headlessui-listbox-button-v-0-2-7').click();
    await this.page.getByRole('option').filter({ hasText: status }).first().click();
    await expect(this.paginationText).toBeVisible();
  }

  // ---------- detail actions ----------

  async fullRefund() {
    await this.page.locator('button', { hasText: 'Refund' }).first().click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('[role="switch"][aria-label="Full refund"]').click();
    await dialog.locator('button', { hasText: /^\s*refund/i }).last().click();
    await expect(this.successMessage).toBeVisible();
  }

  /** Cancels the invoice and asks for a new one with updated information. */
  async cancelAndRegenerate() {
    await this.page.locator('button', { hasText: 'Cancel invoice' }).click();
    await expect(this.page).toHaveURL(/\/cancel/);
    // wait for the invoice preview (iframe): its HTML is sent with the cancel - too early = "The html field is required."
    await expect(this.page.frameLocator('iframe').first().locator('body'), 'invoice preview on the cancel page').not.toBeEmpty({ timeout: 30_000 });
    await this.page.locator('span', { hasText: 'Cancel invoice' }).click();
    await this.page.getByText('Yes, I also want to generate a new invoice with updated information.').click();
    await this.page.getByRole('dialog').locator('button', { hasText: 'Cancel' }).click();
    await expect(this.successMessage).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
  }

  // ---------- more detail actions (tests/hub-e2e/invoices/invoice-actions.spec.ts) ----------

  /** Opens an invoice's page directly by its numeric id and waits for its buttons. */
  async openById(id: string) {
    await this.page.goto(`en/cms/invoices/${id}`);
    await expect(this.page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  }

  /** The dialog that is open now. */
  private dialog() {
    return this.page.getByRole('dialog').last();
  }

  /** "Successfully requested!" → Close. */
  private async closeSuccess() {
    await expect(this.successMessage.first()).toBeVisible({ timeout: 30_000 });
    await this.dialog().getByRole('button', { name: 'Close' }).click();
  }

  /**
   * "Refund invoice" → tick the FIRST line → lower its refund amount → "Refund x €" → success.
   * Since v2.21 refunds are per line: a ticked line is refunded in full unless its amount is lowered.
   */
  async refundFirstLine(amount: string) {
    await this.page.getByRole('button', { name: 'Refund invoice' }).click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Refund invoice' })).toBeVisible();
    const firstLine = dialog.locator('tbody tr').first();
    await firstLine.getByRole('checkbox').check();
    await firstLine.getByRole('textbox').or(firstLine.getByRole('spinbutton')).first().fill(amount);
    await dialog.getByRole('button', { name: /^Refund\s/ }).click();
    await this.closeSuccess();
  }

  /** "Mark as paid" → optional offline transaction id → Submit → success. */
  async markAsPaid(offlineTransactionId: string) {
    await this.page.getByRole('button', { name: 'Mark as paid' }).click();
    const dialog = this.dialog();
    await dialog.getByRole('textbox', { name: 'Offline transaction ID (Optional)' }).fill(offlineTransactionId);
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await this.closeSuccess();
  }

  /** "Block auto-claim" → reason → Submit (the invoice is skipped by automatic debt collection). */
  async blockAutoClaim(reason: string) {
    await this.page.getByRole('button', { name: 'Block auto-claim' }).click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Block auto claim' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Reason (optional)' }).fill(reason);
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }

  /** Clicks an action button (must be enabled) and confirms its dialog with the last, non-Close button. */
  async runAndConfirm(action: 'Charge invoice' | 'Claim unpaid invoice') {
    const button = this.page.getByRole('button', { name: action, exact: true });
    await expect(button, `"${action}" button enabled`).toBeEnabled();
    await button.click();
    // the page keeps hidden dialogs too → take the one with this action's title
    // (its outer box has no size, so check the title is visible, not the box)
    const title = this.page.getByRole('heading', { name: action });
    await expect(title, `"${action}" dialog`).toBeVisible();
    const dialog = this.page.getByRole('dialog').filter({ has: title });
    await dialog.getByRole('button', { name: 'Submit' }).click();
  }

  /** Clicks "PDF" and returns the status of the invoice request it triggers. */
  async downloadPdf(): Promise<number> {
    const response = this.page.waitForResponse((r) => r.request().method() === 'GET' && /\/invoices\//.test(r.url()));
    // exact name: the page also has a "Regenerate pdf" button
    await this.page.getByRole('button', { name: 'PDF', exact: true }).click();
    return (await response).status();
  }
}
