import { expect, type Page } from '@playwright/test';
import { env } from '@config/env';

/** Customer typed into the "Customer" step of Create order. */
export type PosCustomer = {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  street: string;
  streetNumber: string;
  city: string;
  country: string;
  postalCode: string;
};

/**
 * The POS portal (StoreConnect): login, Order list, order page, Create order, and the two
 * Subscriptions tabs. The login page is POS_URL in .env.
 */
export class PosPage {
  /** https://pos.development.circuly.io (from POS_URL) */
  readonly origin: string;

  constructor(readonly page: Page) {
    this.origin = new URL(env.pos.POS_URL).origin;
  }

  // ---------------------------------------------------------------- login

  /** Opens the login page (POS_URL, with the company_id). */
  async openLogin() {
    await this.page.goto(env.pos.POS_URL);
  }

  /** Types location id + password and clicks Sign in (does not wait for the result). */
  async signIn(locationId: string, password: string) {
    await this.page.getByRole('textbox', { name: 'Location ID' }).fill(locationId);
    await this.page.getByRole('textbox', { name: 'Password' }).fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  /** Logs in with POS_LOCATION_ID + POS_PASSWORD from .env and waits for the Order list. */
  async login() {
    await this.openLogin();
    await this.signIn(env.pos.POS_LOCATION_ID, env.pos.POS_PASSWORD);
    await expect(this.page).toHaveURL(/\/protected\/orders/);
  }

  /** "Sign out" button in the header (only shown when logged in). */
  signOutButton() {
    return this.page.getByRole('button', { name: 'Sign out' });
  }

  // ---------------------------------------------------------------- lists

  /** Tab link at the top: 'Order list' shows "(34)", the Subscriptions tabs "- not started (64)" / "- started (35)". */
  tab(name: 'Order list' | 'Subscriptions - not started' | 'Subscriptions - started') {
    const tabs = this.page.getByRole('navigation', { name: 'Tabs' }).getByRole('link');
    if (name === 'Order list') return tabs.filter({ hasText: 'Order list' });
    if (name === 'Subscriptions - not started') return tabs.filter({ hasText: 'not started' });
    return tabs.filter({ hasText: '- started' });
  }

  /** The number in brackets on a tab, e.g. "Order list (34)" → 34. */
  async tabCount(name: 'Order list' | 'Subscriptions - not started' | 'Subscriptions - started') {
    const text = await this.tab(name).innerText();
    return Number(text.match(/\((\d+)\)/)?.[1]);
  }

  /** Opens the Order list (newest first) and waits for its table. */
  async openOrderList() {
    await this.page.goto(`${this.origin}/en/protected/orders`);
    await expect(this.page.getByRole('heading', { name: 'Order list' })).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }

  /** Opens the "Subscriptions - not started" tab. */
  async openNotStartedSubscriptions() {
    await this.page.goto(`${this.origin}/en/protected/orders/items`);
    await expect(this.page.getByRole('heading', { name: '- not started' })).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }

  /** Opens the "Subscriptions - started" tab. */
  async openStartedSubscriptions() {
    await this.page.goto(`${this.origin}/en/protected/subscriptions`);
    await expect(this.page.getByRole('heading', { name: '- started' })).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }

  /** Table body rows of the current list. */
  rows() {
    return this.page.locator('table tbody tr');
  }

  /** Types into the list's "Search..." box and waits for the list to reload. */
  async search(text: string) {
    await this.page.getByRole('textbox', { name: 'Search...' }).fill(text);
    await this.page.waitForLoadState('networkidle');
  }

  /** Status filter of the Order list: opens it and ticks one option (Open, Completed, ...). */
  async filterStatus(status: string) {
    await this.page.getByRole('button', { name: 'Status' }).click();
    await this.page.getByRole('option', { name: status }).click();
    await this.page.keyboard.press('Escape');
    await this.page.waitForLoadState('networkidle');
  }

  /** "Showing 1 to 5 of 34 results" line under a list. */
  pageInfo() {
    return this.page.getByRole('navigation', { name: 'Pagination' }).getByRole('paragraph');
  }

  /** Paging buttons under a list: 0 first, 1 previous, 2 next, 3 last. */
  pagingButton(index: 0 | 1 | 2 | 3) {
    return this.page.getByRole('navigation', { name: 'Pagination' }).getByRole('button').nth(index);
  }

  // ---------------------------------------------------------------- one order (quote)

  /** Opens /orders/{quote id} and waits for "#quote_…". */
  async openOrder(draftId: string) {
    await this.page.goto(`${this.origin}/en/protected/orders/${draftId}`);
    await expect(this.page.getByRole('heading', { name: `#${draftId}` })).toBeVisible();
  }

  /** "Checkout link" on the order page. */
  checkoutLink() {
    return this.page.getByRole('link', { name: 'Checkout link' });
  }

  /** Order page → Cancel → dialog "Cancel order" (shows the quote id) → Cancel. */
  async cancelOrder(draftId: string) {
    await this.page.getByRole('button', { name: 'Cancel' }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Cancel order' })).toBeVisible();
    await expect(dialog).toContainText(draftId);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  // ---------------------------------------------------------------- Create order

  /** Opens Create order and presses Reset (the POS keeps an unfinished order in the browser). */
  async openCreateOrder() {
    await this.page.goto(`${this.origin}/en/protected/orders/create`);
    await this.page.getByRole('button', { name: 'Reset' }).click();
    await expect(this.page.getByText('No items added')).toBeVisible();
  }

  /** Create order → "Add item" → the product list (step 1 of Create item). */
  async openProductList() {
    await this.page.getByRole('button', { name: 'Add item' }).click();
    await expect(this.page.getByRole('heading', { name: 'Select a product' })).toBeVisible();
    await this.page.waitForLoadState('networkidle');
  }

  /** Add item → search the product → click it → click the variant (step 2) → Configure step shows. */
  async chooseProduct(productName: string, variantName: string) {
    await this.page.getByRole('button', { name: 'Add item' }).click();
    await this.page.getByRole('textbox', { name: 'Search' }).fill(productName);
    await this.page.getByRole('button').filter({ has: this.page.getByRole('heading', { name: productName, exact: true }) }).click();
    await expect(this.page.getByRole('heading', { name: 'Select a variant' })).toBeVisible();
    await this.page.getByRole('button').filter({ has: this.page.getByRole('heading', { name: variantName, exact: true }) }).click();
    await expect(this.page.getByRole('heading', { name: 'Define subscription details' })).toBeVisible();
  }

  /** Value next to a label on the Configure step, e.g. configureDetail('SKU:') → "2000". */
  configureDetail(label: 'SKU:' | 'Name:' | 'Subscription end:' | 'Total:') {
    return this.page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]');
  }

  /** Product cards on the Add item page (their name headings). */
  productCards() {
    return this.page.locator('main').getByRole('heading', { level: 3 });
  }

  /** Filters panel on the Add item page: ticks one checkbox option (e.g. 'Plastic') and waits for the new list. */
  async tickProductFilter(option: string) {
    await this.page.getByRole('checkbox', { name: option, exact: true }).check();
    await this.page.waitForLoadState('networkidle');
  }

  /** Configure step → "Add item" (keeps the default duration, frequency ...) → back on Create order. */
  async addConfiguredItem() {
    await this.page.getByRole('button', { name: 'Add item' }).click();
    await expect(this.page.getByRole('heading', { name: 'Order & items' })).toBeVisible();
  }

  /** An item row in "Order & items" (by its name). */
  item(name: string) {
    return this.page.getByRole('listitem').filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }

  /** Types a voucher code and clicks "Add code". */
  async addVoucher(code: string) {
    await this.page.getByRole('textbox', { name: 'Voucher code' }).fill(code);
    await this.page.getByRole('button', { name: 'Add code' }).click();
  }

  /** "Continue" at the bottom of a Create order step. */
  async continue() {
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  /** Customer step: fills email, phone, name and the shipping address ("Same as shipping" stays ticked). */
  async fillCustomer(customer: PosCustomer) {
    await expect(this.page.getByRole('heading', { name: 'Customer' })).toBeVisible();
    await this.page.getByRole('textbox', { name: 'Email *' }).fill(customer.email);
    await this.page.getByRole('textbox', { name: 'Phone' }).fill(customer.phone);
    await this.page.getByRole('textbox', { name: 'First name *' }).fill(customer.firstName);
    await this.page.getByRole('textbox', { name: 'Last name *' }).fill(customer.lastName);
    await this.page.getByRole('textbox', { name: 'Street *' }).fill(customer.street);
    await this.page.getByRole('textbox', { name: 'Street number' }).fill(customer.streetNumber);
    await this.page.getByRole('textbox', { name: 'City *' }).fill(customer.city);
    await this.page.getByRole('button', { name: 'Country *' }).click();
    await this.page.getByRole('option', { name: customer.country }).click();
    await this.page.getByRole('textbox', { name: 'Postal code *' }).fill(customer.postalCode);
  }

  /** Review step → "Create order" → the new order page; returns its quote id ("quote_71365688"). */
  async createOrder() {
    await expect(this.page.getByRole('heading', { name: 'Review' })).toBeVisible();
    await this.page.getByRole('button', { name: 'Create order' }).click();
    await expect(this.page).toHaveURL(/\/orders\/quote_\d+/, { timeout: 30_000 });
    return this.page.url().match(/quote_\d+/)![0];
  }

  /** The whole Create order flow in one call (for tests that only need a new quote). Returns the quote id. */
  async createQuote(productName: string, variantName: string, customer: PosCustomer) {
    await this.openCreateOrder();
    await this.chooseProduct(productName, variantName);
    await this.addConfiguredItem();
    await this.continue();
    await this.fillCustomer(customer);
    await this.continue();
    return this.createOrder();
  }

  // ---------------------------------------------------------------- Start subscription

  /** "Start subscription" button of the first row in "Subscriptions - not started". */
  firstStartButton() {
    return this.rows().first().getByRole('button', { name: 'Start subscription' });
  }

  /** The open "Start subscription" dialog. */
  startDialog() {
    return this.page.getByRole('dialog');
  }

  /** Clicks Start subscription on the first row and waits for the dialog. Returns the order id of that row. */
  async openStartDialogOfFirstRow() {
    const orderId = (await this.rows().first().getByRole('cell').nth(1).innerText()).trim();
    await this.firstStartButton().click();
    await expect(this.startDialog().getByRole('heading', { name: 'Start subscription' })).toBeVisible();
    return orderId;
  }
}
