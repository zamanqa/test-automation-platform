import { expect, type Locator, type Page } from '@playwright/test';

// Hub → Payments (transactions): list and payment page.
export class PaymentPage {
  readonly searchInput: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.locator('main').getByRole('textbox', { name: 'Search...' });
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
  }

  /** Opens the payment list without the default date filter, optionally with more URL filters. */
  async openList(filters: Record<string, string> = {}) {
    const query = new URLSearchParams(filters);
    if (!query.has('created_at')) query.set('created_at', '');
    await this.page.goto(`en/cms/transactions?${query.toString()}`);
    await expect(this.paginationText).toBeVisible();
  }

  /** N from "1-10 of N". */
  async total(): Promise<number> {
    const label = (await this.paginationText.textContent()) ?? '';
    return Number(label.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /** Opens the payment page of a transaction id. */
  async openPayment(transactionId: string) {
    await this.page.goto(`en/cms/transactions/${transactionId}`);
    await expect(this.page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible();
  }

  /** Value cell of a row in the Details table, e.g. 'Amount:'. */
  detail(label: string): Locator {
    return this.page.getByRole('row', { name: label }).getByRole('cell').nth(1);
  }

  /** Clicks "PDF" and returns the status of the invoice request it triggers. */
  async downloadPdf(): Promise<number> {
    const response = this.page.waitForResponse((r) => r.request().method() === 'GET' && /\/invoices\//.test(r.url()));
    await this.page.getByRole('button', { name: 'PDF', exact: true }).click();
    return (await response).status();
  }

  /** Changes "Items per page" of the list. */
  async changePageSize(size: number) {
    await this.page.getByTestId('select-page-size').first().locator('button[aria-haspopup="listbox"]').click();
    await this.page.getByRole('listbox').getByRole('option').filter({ hasText: String(size) }).first().click();
  }
}
