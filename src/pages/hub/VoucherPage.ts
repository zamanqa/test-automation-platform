import { expect, type Locator, type Page } from '@playwright/test';

// Hub → Vouchers: list, create, edit, delete.
export class VoucherPage {
  readonly searchInput: Locator;
  readonly rows: Locator;
  readonly paginationText: Locator;
  readonly createButton: Locator;
  readonly updateButton: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.locator('main').getByRole('textbox', { name: 'Search...' });
    this.rows = page.locator('tbody tr');
    this.paginationText = page.getByTestId('from-to-of-total').first();
    this.createButton = page.getByRole('button', { name: 'Create voucher' }).last();
    this.updateButton = page.getByRole('button', { name: 'Update voucher' });
  }

  /** Opens the voucher list. */
  async openList() {
    await this.page.goto('en/cms/vouchers');
    await expect(this.paginationText).toBeVisible();
  }

  /** N from "1-10 of N". */
  async total(): Promise<number> {
    const label = (await this.paginationText.textContent()) ?? '';
    return Number(label.match(/of\s+(\d+)/)?.[1] ?? 0);
  }

  /** Types a voucher code into the list search. */
  async search(text: string) {
    await this.searchInput.fill(text);
  }

  /** Opens the create page. */
  async openCreate() {
    await this.page.goto('en/cms/vouchers/create');
    await expect(this.page.getByRole('heading', { name: 'Create voucher' })).toBeVisible();
  }

  /** Opens the edit page of a voucher by its id. */
  async openEdit(id: string) {
    await this.page.goto(`en/cms/vouchers/${id}/edit`);
    await expect(this.updateButton).toBeVisible();
  }

  /** Text field by its label, e.g. 'Voucher name *'. */
  field(label: string): Locator {
    return this.page.getByRole('textbox', { name: label, exact: true });
  }

  /** Picks an option in a dropdown, e.g. 'Discount type' → 'Percentage'. */
  async select(label: string, option: string) {
    await this.page.locator('.v-field', { has: this.page.getByRole('combobox', { name: label }) }).click();
    await this.page.getByRole('listbox', { name: label }).getByRole('option', { name: option, exact: true }).click();
  }

  /** Ticks or unticks a checkbox, e.g. 'Valid'. */
  async setCheckbox(label: string, on: boolean) {
    await this.page.getByRole('checkbox', { name: label }).setChecked(on);
  }

  /** Clicks a radio option, e.g. "Apply discount to initial payment and all recurring payments". */
  async chooseRadio(label: string) {
    await this.page.getByRole('radio', { name: label }).check();
  }

  /** Product filter "include" → searches the product title, picks the first result and adds it with the + button. */
  async includeProduct(title: string) {
    await this.select('Product filter type', 'include');
    await this.page.locator('.v-field', { has: this.page.getByRole('combobox', { name: 'Search products' }) }).click();
    await this.page.getByRole('combobox', { name: 'Search products' }).fill(title);
    await this.page.getByRole('option').filter({ hasText: title }).first().click();
    await this.page.keyboard.press('Escape');
    const addButton = this.page.locator('.v-field', { has: this.page.getByRole('combobox', { name: 'Search products' }) }).locator('xpath=following::button[1]');
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(this.page.locator('main').getByText(title).first()).toBeVisible();
  }

  /** "Create voucher" → "Voucher created!". */
  async submitCreate() {
    await expect(this.createButton).toBeEnabled();
    await this.createButton.click();
    await expect(this.page.getByText('Voucher created!')).toBeVisible();
  }

  /** "Update voucher" → "Voucher updated!". */
  async submitUpdate() {
    await this.updateButton.click();
    await expect(this.page.getByText('Voucher updated!')).toBeVisible();
  }

  /** Row menu of the voucher with this code → "Delete voucher" → Delete in the dialog. */
  async deleteFromList(code: string) {
    await this.search(code);
    const row = this.rows.filter({ hasText: code });
    await expect(row).toHaveCount(1);
    await row.locator('td').last().locator('button').click();
    await this.page.getByRole('menuitem', { name: 'Delete voucher' }).click();
    await expect(this.page.getByText('This action cannot be undone. This will delete the voucher.')).toBeVisible();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  }
}
