import { expect, type Locator, type Page } from '@playwright/test';

/** Hub → Debt collection (claims sent to Debtist): list and claim page (/en/cms/debt-collection/{claim_id}). */
export class DebtCollectionPage {
  readonly rows: Locator;

  constructor(private readonly page: Page) {
    this.rows = page.locator('tbody tr');
  }

  private dialog() {
    return this.page.getByRole('dialog').last();
  }

  /** Opens the list and clears the saved filter (last 30 days). */
  async openList() {
    await this.page.goto('en/cms/debt-collection');
    const clear = this.page.getByRole('button', { name: 'Clear', exact: true }).first();
    await expect(clear).toBeVisible();
    if (await clear.isEnabled()) await clear.click();
  }

  /** Types a claim id in the search box; waits until that claim's link shows. */
  async search(claimId: string) {
    await this.page.locator('main input[placeholder="Search..."]').first().fill(claimId);
    await expect(this.page.locator(`tbody a[href*="/debt-collection/${claimId}"]`).first(), `claim ${claimId} in the search result`).toBeVisible();
  }

  /** Status filter → option (e.g. 'open'). */
  async filterByStatus(status: string) {
    await this.page.getByRole('button', { name: /^Status/ }).first().click();
    await this.page.getByRole('option', { name: new RegExp(`^\\s*${status}\\s*$`, 'i') }).first().click();
    await this.page.keyboard.press('Escape');
  }

  /** Opens a claim's page directly by its id. */
  async open(claimId: string) {
    await this.page.goto(`en/cms/debt-collection/${claimId}`);
    await expect(this.page.getByRole('heading', { name: 'Claim', exact: true })).toBeVisible();
  }

  /** Value next to a label in "Claim details" / "Financial details", e.g. detail('Status:'). */
  detail(label: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(`^${label}`) }).first().getByRole('cell').last();
  }

  /** "Upload" → choose the file → Submit; the file name then shows under "Appended Files". */
  async uploadFile(file: { name: string; mimeType: string; buffer: Buffer }) {
    await this.page.getByRole('button', { name: 'Upload' }).first().click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Upload file' })).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles(file);
    // wait for the upload request itself - its answer tells whether the upload really worked
    const upload = this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/uploads'), { timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Submit' }).click();
    const response = await upload;
    expect(response.status(), `upload answer: ${await response.text().catch(() => '')}`.slice(0, 300)).toBeLessThan(300);
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }

  /** Activity history tab → "Comment" → text → Submit; the comment then shows in the activity list. */
  async addComment(text: string) {
    await this.page.getByRole('tab', { name: 'Activity history' }).click();
    await this.page.getByRole('button', { name: 'Comment' }).first().click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Create comment' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Comment' }).fill(text);
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  }
}
