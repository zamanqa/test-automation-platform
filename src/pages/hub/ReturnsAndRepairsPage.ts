import { expect, type Page } from '@playwright/test';

/** Hub → Returns and Repairs lists. */
export class ReturnsAndRepairsPage {
  constructor(private readonly page: Page) {}

  /**
   * Types the serial number into the list's search box.
   * The list clears the box while it loads its rows and saved filters (Repairs has 2),
   * so type again until the text stays in the box.
   */
  private async search(serialNumber: string) {
    const searchBox = this.page.locator('.w-64 input[placeholder="Search..."]');
    await expect(this.page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await searchBox.fill(serialNumber);
      await expect(searchBox).toHaveValue(serialNumber, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** Returns list → Handle → Mark as returned. */
  async markReturned(serialNumber: string) {
    await this.page.goto('en/cms/returns');
    await this.search(serialNumber);
    const row = this.page.locator('tr, [role="row"]').filter({ has: this.page.locator(`a[href*="/en/cms/assets/${serialNumber}"]`) });
    await row.locator('button', { hasText: 'Handle' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.locator('button', { hasText: 'Mark as returned' }).click();
    await expect(this.page.getByText('Successfully requested!')).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
  }

  /** Returns list → search a text (serial number, order id ...). */
  async searchReturns(text: string) {
    await this.page.goto('en/cms/returns');
    await this.search(text);
  }

  /** Returns list → search the serial → Handle; returns the "Handle return" dialog. */
  async openHandle(serialNumber: string) {
    const row = this.page.locator('tr, [role="row"]').filter({ has: this.page.locator(`a[href*="/en/cms/assets/${serialNumber}"]`) });
    // the list sometimes drops the search while it loads → search again until the row shows
    await expect(async () => {
      await this.searchReturns(serialNumber);
      await expect(row).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await row.locator('button', { hasText: 'Handle' }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.getByText('Handle return')).toBeVisible();
    await expect(dialog.getByText(serialNumber)).toBeVisible();
    return dialog;
  }

  /** Repairs list → open the row of this serial number → Start repair → Submit. */
  async repair(serialNumber: string) {
    await this.page.goto('en/cms/repairs');
    await this.search(serialNumber);
    const row = this.page.locator('table tbody tr').filter({ has: this.page.locator(`a[href*="${serialNumber}"]`) });
    await row.locator('a[href*="/en/cms/repairs/"]').first().click();
    await this.page.locator('button', { hasText: 'Start repair' }).click();
    await this.page.locator('button', { hasText: 'Submit' }).click();
    await expect(this.page.getByText('Successfully requested!')).toBeVisible();
    await this.page.locator('button', { hasText: 'Close' }).click();
  }
}
