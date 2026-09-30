import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Hub → Products (/en/cms/products): the tabs Products, Variants and Attributes, the "Create product"
 * form, the product and variant pages and the attribute form.
 * Taxes, Exchange groups and Bundles are NOT touched (owner's rule).
 * Created per test by the fixture `productPage` (src/fixtures/index.ts); `page` = Playwright's browser tab.
 */
export class ProductPage {
  readonly searchInput: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    // not the read-only search box of the top bar
    this.searchInput = page.locator('main input[placeholder="Search..."]:not([readonly])').first();
    this.rows = page.locator('main tbody tr');
  }

  /** The dialog that is open now. */
  dialog() {
    return this.page.getByRole('dialog').last();
  }

  /** Waits until the page has no more network requests (e.g. after a click that may or may not save). */
  async waitUntilLoaded() {
    await this.page.waitForLoadState('networkidle');
  }

  /** The green/red message box at the corner of the screen, e.g. "Product sync process started". */
  message(text: string | RegExp) {
    return this.page.getByText(text).first();
  }

  // ---------- list ----------

  /** Opens the product list on a tab (Products, Variants or Attributes) and waits until its table shows rows. */
  async openList(tab: 'Products' | 'Variants' | 'Attributes' = 'Products') {
    await this.page.goto('en/cms/products');
    await expect(this.page.getByRole('heading', { name: 'Product list' })).toBeVisible();
    if (tab !== 'Products') await this.page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(this.page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(this.rows.first(), `rows on the "${tab}" tab`).toBeVisible();
    // the list loads twice (saved view) — a button clicked before that is ignored or its popup closes
    await this.page.waitForLoadState('networkidle');
  }

  /** Types in the search box and waits until the first row contains the text (id, SKU or title). */
  async search(text: string) {
    await this.searchInput.fill(text);
    await expect(this.rows.first(), `first row after searching "${text}"`).toContainText(text);
    // the list is loaded once more after typing stops — a row ticked before that loses its tick
    await this.page.waitForLoadState('networkidle');
  }

  /** The row that has a link to this product or variant id. */
  rowOf(id: string) {
    return this.rows.filter({ has: this.page.locator(`a[href$="/${id}"]`) }).first();
  }

  /** The id shown in the first row (the link text). */
  async firstRowId() {
    return (await this.rows.first().getByRole('link').first().innerText()).trim();
  }

  /** The "Active" picker above the table → Active or Inactive. */
  async showOnly(state: 'Active' | 'Inactive') {
    // The button keeps the label "Active". Both options can be ticked → tick the wanted one, untick the other.
    const other = state === 'Active' ? 'Inactive' : 'Active';
    await this.page.locator('main').getByRole('button', { name: 'Active', exact: true }).click();
    const wanted = this.page.getByRole('option', { name: state, exact: true });
    const unwanted = this.page.getByRole('option', { name: other, exact: true });
    if ((await wanted.getAttribute('aria-selected')) !== 'true') await wanted.click();
    if ((await unwanted.getAttribute('aria-selected')) === 'true') await unwanted.click();
    await expect(wanted).toHaveAttribute('aria-selected', 'true');
    await expect(unwanted).not.toHaveAttribute('aria-selected', 'true');
    await this.page.keyboard.press('Escape');
  }

  /** Filter panel → key "Active", value switched on → Add new filter → Search. */
  async filterActiveProducts() {
    await this.page.getByRole('button', { name: 'Filter', exact: true }).click();
    const panel = this.dialog();
    await expect(panel.getByRole('heading', { name: 'Filter', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Filter key/ })).toContainText('Active');
    // the panel's blurred backdrop keeps moving → Playwright never sees the buttons as "stable" → force the clicks.
    // Operator: the default "contains" finds nothing for Active → choose "Is" (its only option).
    await panel.getByRole('button', { name: /^Operator/ }).click({ force: true });
    await this.page.getByRole('option', { name: 'Is', exact: true }).click({ force: true });
    await panel.getByRole('switch', { name: 'Value' }).click({ force: true });
    await expect(panel.getByRole('switch', { name: 'Value' })).toBeChecked();
    await panel.getByRole('button', { name: 'Add new filter' }).click({ force: true });
    await expect(panel.getByText('No data available.'), 'the filter is listed under "Active filters"').toBeHidden();
    await panel.getByRole('button', { name: 'Search' }).click({ force: true });
  }

  /** The "Clear" button next to "Filter" (enabled only while a filter is set). */
  clearFilterButton() {
    return this.page.getByRole('button', { name: 'Clear', exact: true }).first();
  }

  /** The "Items per page" button under the table → choose a number. */
  async setItemsPerPage(count: string) {
    await this.page.getByText('Items per page:').first().locator('xpath=following::button[1]').click();
    await this.page.getByRole('option', { name: count, exact: true }).click();
  }

  /** The text under the table, e.g. "1-10 of 21". */
  pageInfo() {
    return this.page.getByText(/\d+-\d+ of \d+/).first();
  }

  /** "Next page" button under the table. */
  nextPageButton() {
    return this.page.getByTestId('btn-next-page').first();
  }

  /** The 3 icon buttons at the top right of the table: 0 = refresh, 1 = product sync, 2 = column visibility. */
  iconButton(index: 0 | 1 | 2) {
    return this.page.locator('main [role=group]').last().getByRole('button').nth(index);
  }

  /** A column title of the table. */
  columnHeader(name: string) {
    return this.page.locator('main thead th').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
  }

  /** Ticks the checkbox of a row (by id). */
  async selectRow(id: string) {
    await this.rowOf(id).getByRole('checkbox').check();
    await expect(this.page.getByText(/items? (is|are) selected/)).toBeVisible();
  }

  // ---------- bulk edit (select rows → Edit → change cells → Submit changes) ----------

  /** Clicks "Edit" (or "Edit attributes") above the table; the Cancel / Submit changes buttons appear. */
  async startEdit(button: 'Edit' | 'Edit attributes' = 'Edit') {
    await this.page.getByRole('button', { name: button, exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Submit changes' })).toBeVisible();
  }

  /** The cell of a row under a column title, e.g. cell('6587', 'MSRP'). */
  async cell(id: string, column: string) {
    const headers = (await this.page.locator('main thead tr').first().getByRole('columnheader').allInnerTexts()).map((h) => h.trim());
    const index = headers.indexOf(column);
    expect(index, `column "${column}" in ${headers.join(' | ')}`).toBeGreaterThan(-1);
    return this.rowOf(id).getByRole('cell').nth(index);
  }

  /** Types a new value (plain number like "12" — a comma is dropped: "15,00" becomes 1500) into an editable cell (edit mode must be on). */
  async editCell(id: string, column: string, value: string) {
    const input = (await this.cell(id, column)).getByRole('textbox');
    await input.fill(value);
    await input.press('Tab');
  }

  /** "Submit changes" → edit mode closes. */
  async submitChanges() {
    await this.page.getByRole('button', { name: 'Submit changes' }).click();
    await expect(this.page.getByRole('button', { name: 'Submit changes' })).toBeHidden({ timeout: 20_000 });
  }

  /** "Cancel" in edit mode → edit mode closes without saving. */
  async cancelEdit() {
    await this.page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Submit changes' })).toBeHidden();
  }

  /** Selected rows → "Map to product collection" → first collection in the list → "Map to collection". Returns its name. */
  async mapToFirstCollection() {
    await this.page.getByRole('button', { name: 'Map to product collection' }).click();
    const dialog = this.dialog();
    // blurred backdrop keeps moving → force the clicks (see filterActiveProducts)
    await dialog.getByRole('combobox', { name: 'Product collections' }).click({ force: true });
    const option = this.page.getByRole('option').first();
    const name = (await option.innerText()).trim();
    await option.click({ force: true });
    await expect(dialog.getByText('1 items selected.'), 'the ticked product is counted in the dialog').toBeVisible();
    await dialog.getByRole('button', { name: 'Map to collection' }).click({ force: true });
    await expect(dialog).toBeHidden();
    return name;
  }

  // ---------- create product (/en/cms/products/create) ----------

  /** "Create product" button on the list → the form opens. */
  async openCreateForm() {
    await this.openList();
    await this.page.getByRole('button', { name: 'Create product' }).click();
    await expect(this.page).toHaveURL(/\/cms\/products\/create/);
    await expect(this.page.getByRole('heading', { name: 'General information' })).toBeVisible();
  }

  /** A text box of the form (or of the open dialog) by its label, e.g. input('Title *'). */
  input(label: string, inside: Locator = this.page.locator('main')) {
    return inside.getByRole('textbox', { name: label, exact: true });
  }

  /** Picks the product type (consumable / digital / normal). */
  async chooseType(type: string) {
    await this.page.getByRole('button', { name: 'Type', exact: true }).click();
    await this.page.getByRole('option', { name: type, exact: true }).click();
  }

  /** "Add variant" → fills the variant dialog → "Add variant". The variant shows in the form. */
  async addVariant(v: { title: string; sku: string; price: string; stock: string; duration: string }) {
    await this.page.getByRole('button', { name: 'Add variant' }).first().click();
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Add variant' })).toBeVisible();
    await this.input('Title *', dialog).fill(v.title);
    await this.input('SKU *', dialog).fill(v.sku);
    await this.input('Price', dialog).fill(v.price);
    await dialog.getByRole('spinbutton', { name: 'Stock' }).fill(v.stock);
    await dialog.getByRole('spinbutton', { name: 'Duration', exact: true }).fill(v.duration);
    await dialog.getByRole('switch', { name: 'Subscription item' }).click();
    await dialog.getByRole('button', { name: 'Add variant' }).click();
    await expect(dialog).toBeHidden();
    await expect(this.page.locator('main').getByText(v.title).first(), 'the new variant in the form').toBeVisible();
  }

  /** "Create product" at the top of the form. */
  async clickCreate() {
    await this.page.locator('main').getByRole('button', { name: 'Create product' }).click();
  }

  // ---------- product / variant page ----------

  /** Opens a product page by id and waits for "Product information". */
  async openProduct(id: string) {
    await this.page.goto(`en/cms/products/${id}`);
    await expect(this.page.getByRole('heading', { name: 'Product information' })).toBeVisible();
  }

  /** Opens a variant page by id and waits for "View parent product". */
  async openVariant(id: string) {
    await this.page.goto(`en/cms/variants/${id}`);
    await expect(this.page.getByRole('link', { name: 'View parent product' })).toBeVisible();
  }

  /** The value next to a label in the details list, e.g. detail('MSRP') → "50,00 €". */
  detail(label: string) {
    return this.page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
  }

  // ---------- attributes ----------

  /** Attributes tab → "Create attribute" → the form opens. */
  async openCreateAttributeForm() {
    await this.openList('Attributes');
    await this.page.getByRole('button', { name: 'Create attribute' }).click();
    await expect(this.page).toHaveURL(/\/product-attributes\/create/);
  }

  /** Opens the edit page of an attribute by id. */
  async openAttribute(id: string) {
    await this.page.goto(`en/cms/product-attributes/${id}/edit`);
    await expect(this.page.getByRole('heading', { name: 'Edit attribute' })).toBeVisible();
  }

  /** Picks a value in a dropdown of the attribute form, e.g. choose('Data type', 'Select'). */
  async choose(label: 'Data type' | 'Level' | 'Language', option: string) {
    await this.page.locator('main').getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
    await this.page.getByRole('option', { name: option, exact: true }).click();
  }

  /** Row menu (…) of an attribute on the Attributes tab → a menu item. */
  async attributeRowAction(name: string, action: 'Assign to all' | 'Delete attribute' | 'Edit attribute') {
    const row = this.rows.filter({ hasText: name }).first();
    await row.getByRole('button').last().click();
    await this.page.getByRole('menuitem', { name: action }).click();
  }

  /** Row menu → "Assign to all" → Value = first option → Confirm. */
  async assignToAll(name: string) {
    await this.attributeRowAction(name, 'Assign to all');
    const dialog = this.dialog();
    await expect(dialog.getByRole('heading', { name: 'Assign to all' })).toBeVisible();
    // blurred backdrop keeps moving → force the clicks (see filterActiveProducts)
    await dialog.getByRole('button', { name: 'Value' }).click({ force: true });
    await this.page.getByRole('option').first().click({ force: true });
    await dialog.getByRole('button', { name: 'Confirm' }).click({ force: true });
    await expect(dialog).toBeHidden();
  }

  /** Row menu → "Delete attribute" → confirm in the dialog. */
  async deleteAttribute(name: string) {
    await this.attributeRowAction(name, 'Delete attribute');
    await this.dialog().getByRole('button', { name: /Delete|Confirm|Yes/ }).last().click({ force: true });
  }
}
