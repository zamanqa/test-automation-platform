import { expect, type Locator, type Page } from '@playwright/test';

// Hub → Assets: list, asset page, "Change asset status", CSV import and export.
export class AssetPage {
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

  /** Opens the asset list without the default date filter, optionally with more URL filters. */
  async openList(filters: Record<string, string> = {}) {
    const query = new URLSearchParams(filters);
    if (!query.has('created_at')) query.set('created_at', '');
    await this.page.goto(`en/cms/assets?${query.toString()}`);
    await expect(this.paginationText).toBeVisible();
  }

  /** N from "1-10 of N". */
  async total(): Promise<number> {
    const label = (await this.paginationText.textContent()) ?? '';
    return Number(label.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /** Opens the asset page of a serial number. */
  async openAsset(serialNumber: string) {
    await this.page.goto(`en/cms/assets/${serialNumber}`);
    await expect(this.page.getByRole('heading', { name: 'Asset', exact: true })).toBeVisible();
  }

  /** The 3-dot menu item "Change asset status" (open the menu first with openMenu). */
  get changeStatusItem(): Locator {
    return this.page.getByRole('menuitem', { name: 'Change asset status' });
  }

  /** Opens the 3-dot menu of the asset page. */
  async openMenu() {
    await this.page.locator('button[aria-haspopup="menu"]:not(.header-btn)').last().click();
  }

  /** Menu → "Change asset status" → opens the status list (current status is the button text). */
  async openStatusList(currentStatus: string) {
    await this.openMenu();
    await this.changeStatusItem.click();
    await expect(this.dialog.getByRole('heading', { name: 'Change asset status' })).toBeVisible();
    await this.dialog.getByRole('button', { name: currentStatus, exact: true }).click();
  }

  /** Names of the status options in the open list. */
  statusOptions(): Locator {
    return this.page.getByRole('option');
  }

  /** Change asset status: current → new status → Submit → success. */
  async changeStatus(currentStatus: string, newStatus: string) {
    await this.openStatusList(currentStatus);
    await this.page.getByRole('option', { name: newStatus, exact: true }).click();
    await expect(this.dialog.getByText(`This action will set the status of the asset to`)).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Submit' }).click();
    await expect(this.dialog.getByText('Successfully requested!')).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Close' }).click();
  }

  /** ".csv" → "Create assets from csv" → choose the file → Submit. */
  async importCsv(fileName: string, content: string) {
    await this.page.getByRole('button', { name: '.csv' }).click();
    await expect(this.dialog.getByRole('heading', { name: 'Create assets from csv' })).toBeVisible();
    await this.dialog.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(content) });
    await this.dialog.getByRole('button', { name: 'Submit' }).click();
  }

  /** "Export" → "Export data" → Export → "Successfully requested!". */
  async exportList() {
    await this.page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(this.dialog.getByRole('heading', { name: 'Export data' })).toBeVisible();
    await this.dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(this.dialog.getByText('Successfully requested!')).toBeVisible();
  }
}
