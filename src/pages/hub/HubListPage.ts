import { expect, type Locator, type Page } from '@playwright/test';

// Any hub list page (orders, subscriptions, transactions, invoices, assets ...).
// Filters are opened by URL, the same way the filter panel writes them: field=mode:value
// (no mode = "Is", contains:, matches:a||b, greater:, between:2026-01-01and2026-01-31).
export class HubListPage {
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly clearFiltersButton: Locator;

  constructor(private readonly page: Page) {
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.clearFiltersButton = page.locator('button', { hasText: 'Clear' }).first();
  }

  /** Opens {HUB_URL}en/cms/<path>?<filters> and waits for the "1-10 of N" label. */
  async open(path: string, filters: Record<string, string>) {
    const query = new URLSearchParams(filters).toString();
    await this.page.goto(`en/cms/${path}?${query}`);
    await expect(this.paginationText).toBeVisible({ timeout: 30_000 });
  }

  /** N from "1-10 of N" (0 when the label has no number). */
  async total(): Promise<number> {
    const label = (await this.paginationText.textContent()) ?? '';
    return Number(label.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /** Waits until the list shows this total (the list loads a moment after the page). */
  async expectTotal(expected: number, message: string) {
    await expect.poll(() => this.total(), { message, timeout: 30_000 }).toBe(expected);
  }

  /** Value of one filter in the current URL ('' when it is not there). */
  urlFilter(name: string): string {
    return new URL(this.page.url()).searchParams.get(name) ?? '';
  }
}
