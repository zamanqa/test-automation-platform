import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Hub → Customers list and customer detail page (/en/cms/customers/{cus_...}).
 * Created per test by the fixture `customerPage` (src/fixtures/index.ts); `page` = Playwright's browser tab.
 */
export class CustomerPage {
  readonly searchInput: Locator;
  readonly rows: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.locator('main input[placeholder="Search..."]').first();
    this.rows = page.locator('tbody tr');
  }

  /** The dialog that is open now. */
  private dialog() {
    return this.page.getByRole('dialog').last();
  }

  // ---------- list ----------

  /** Opens the customers list, clears the saved filters (last 30 days, company type). */
  async openList() {
    await this.page.goto('en/cms/customers');
    const clear = this.page.getByRole('button', { name: 'Clear', exact: true }).first();
    await expect(clear).toBeVisible();
    if (await clear.isEnabled()) await clear.click();
  }

  /** Types a customer id (cus_...) or email in the search box; waits until that customer's link shows. */
  async search(uid: string) {
    await this.searchInput.fill(uid);
    await expect(this.page.locator(`tbody a[href*="/cms/customers/${uid}"]`).first(), `customer ${uid} in the search result`).toBeVisible();
  }


  // ---------- detail page ----------

  /** Opens the customer's page directly by its id and waits for the tabs. */
  async open(uid: string) {
    await this.page.goto(`en/cms/customers/${uid}`);
    await expect(this.page.getByRole('tab', { name: 'General' })).toBeVisible();
  }

  /** Clicks a tab and checks it is selected. */
  async openTab(name: 'General' | 'History' | 'Account balance') {
    await this.page.getByRole('tab', { name, exact: true }).click();
    await expect(this.page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }

  /** Clicks a tab and checks its table shows at least one row. */
  async expectTabHasRows(name: 'General' | 'History' | 'Account balance') {
    await this.page.getByRole('tab', { name, exact: true }).click();
    await expect(this.page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(this.page.locator('main tbody tr:visible').first(), `rows on the "${name}" tab`).toBeVisible();
  }

  /**
   * Opens the customer's actions menu (…) and clicks an action. The page has several menus
   * (one per order / subscription row), so open each until the action shows up.
   */
  async runMenuAction(name: 'Change account balance' | 'Transfer customer data') {
    const item = this.page.getByRole('menuitem', { name, exact: true });
    const menuButtons = this.page.locator('main button[aria-haspopup="menu"]');
    await expect(async () => {
      for (let i = 0; i < (await menuButtons.count()); i++) {
        await this.page.keyboard.press('Escape');
        await menuButtons.nth(i).click();
        if (await item.count()) break;
      }
      await expect(item).toBeEnabled({ timeout: 3_000 });
    }, `customer menu action "${name}"`).toPass({ timeout: 30_000 });
    await item.dispatchEvent('click');
  }

  /** Menu → "Change account balance" → amount (negative = subtract) + note → Submit. */
  async changeAccountBalance(amount: string, note: string) {
    await this.runMenuAction('Change account balance');
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Change account balance' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Add balance' }).fill(amount);
    await dialog.getByRole('textbox', { name: 'Notes' }).fill(note);
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await this.closeResultIfShown();
  }

  /** "Customer balance" value from the Insights box, e.g. "5,00 €". */
  customerBalance(): Locator {
    return this.page.getByText('Customer balance', { exact: true }).locator('xpath=preceding-sibling::p[1]');
  }

  /** Edit (pencil) → "Default locale" → language → consent → Submit. */
  async changeLanguage(language: string) {
    await this.page.locator('[data-test-id="btn-open-edit"]').first().click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Edit customer' })).toBeVisible();
    await dialog.getByRole('button', { name: /^Default locale/ }).click();
    await this.page.getByRole('option', { name: language, exact: true }).click();
    await expect(dialog.getByRole('button', { name: /^Default locale/ })).toContainText(language);
    await dialog.getByRole('checkbox', { name: 'I consent to the consequences.' }).check();
    await dialog.getByRole('button', { name: 'Submit' }).click();
    await this.closeResultIfShown();
  }

  /** "Login CSS" → the Self-Service Portal opens (same tab) for this customer. */
  async loginToSelfServicePortal() {
    await this.page.getByRole('button', { name: 'Login CSS' }).click();
    await expect(this.page, 'Self-Service Portal').toHaveURL(/css\./, { timeout: 30_000 });
  }

  /**
   * "Login CSS", tried twice (owner: the first click sometimes does not log in → back to the
   * customer page and click again). customerUrl = the hub customer page (full URL).
   */
  async loginToSelfServicePortalWithRetry(customerUrl: string) {
    try {
      await this.loginToSelfServicePortal();
    } catch {
      console.log('[css] first "Login CSS" did not open the portal → back to the customer page, trying again');
      await this.page.goto(customerUrl);
      await expect(this.page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 30_000 });
      await this.loginToSelfServicePortal();
    }
  }

  /**
   * "Process open orders" (enabled only when the customer has an order without subscriptions)
   * → the "Create subscriptions" dialog → returns the order id it shows → Close (nothing created).
   * The dialog shows ONE open order at a time ("Order #…" + "1 / 3"); its ‹ › buttons stay disabled
   * until that order is processed, so the shown order may be another open order of the customer.
   */
  async openAndCloseProcessOpenOrders() {
    const button = this.page.getByRole('button', { name: 'Process open orders' });
    await expect(button, '"Process open orders" is enabled (customer has an unprocessed order)').toBeEnabled();
    await button.click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Create subscriptions' })).toBeVisible();
    const orderTitle = dialog.getByText(/^Order #\d+$/);
    await expect(orderTitle).toBeVisible();
    await expect(dialog.getByText(/^1 \/ \d+$/), 'the "1 / N" counter').toBeVisible();
    const shownOrderId = (await orderTitle.innerText()).replace('Order #', '').trim();
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    return shownOrderId;
  }

  /** "Create note" → text → submit; checks the note is shown. */
  async createNote(message: string) {
    await this.page.getByRole('button', { name: 'Create note' }).click();
    await this.page.locator('textarea[path="message"]').fill(message);
    await this.page.locator('[data-cy="btn-submit"]').click();
    await expect(this.page.locator('[data-test-id="note-message"]').filter({ hasText: message })).toBeVisible();
  }

  /** After a Submit: if a result dialog ("Successfully requested!") is shown, close it. */
  private async closeResultIfShown() {
    const success = this.page.getByText('Successfully requested!').first();
    await success.waitFor({ timeout: 10_000 }).catch(() => {});
    if (await success.isVisible()) await this.dialog().getByRole('button', { name: 'Close' }).click();
    await expect(this.page.getByRole('dialog')).toHaveCount(0);
  }
}
