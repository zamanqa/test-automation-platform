import { expect, type Locator, type Page } from '@playwright/test';

export type OrderItem = {
  /** Product title to pick (from findProductForOrderItem) */
  product: string;
  /** Subscription type to pick; omitted = the first option in the list. */
  type?: string;
  price: string;
  quantity: string;
  duration: string;
};

export type BillingAddress = {
  givenName: string;
  surname: string;
  email: string;
  phone: string;
  vatNumber: string;
  company: string;
  street: string;
  streetNumber: string;
  addressAddition: string;
  postalCode: string;
  city: string;
  country: string;
};

/** Hub → Create order / Create quote. Form fields are found by their label (case-sensitive). */
export class OrderCreationPage {
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.submitButton = page.locator('button[type="submit"][data-cy="btn-submit"]');
  }

  /** The nearest div around a label. */
  private field(label: string): Locator {
    return this.page.locator('label', { hasText: new RegExp(label) }).first().locator('xpath=ancestor::div[1]');
  }

  /** The text input next to a label, e.g. textInput('Price'). */
  private textInput(label: string) {
    return this.field(label).locator('input[type="text"]');
  }

  /** Hub start page → "Create order" or "Create quote" button → waits for the form title. */
  async startOrder(kind: 'order' | 'quote') {
    const title = kind === 'order' ? 'Create order' : 'Create quote';
    await this.page.goto('');
    await this.page.getByRole('button', { name: title, exact: true }).click(); // exact: not "Create order for B2B member"
    await expect(this.page.locator('p', { hasText: title }).first()).toBeVisible();
  }

  /** Adds one monthly subscription item for the product and its first variant. No type = first type in the list. */
  async addItem(item: OrderItem) {
    // 1. open the "Add item" dialog (the button above the item list)
    await this.page.locator('button[data-cy="btn-order-item-open-create"]').click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Add item' })).toBeVisible();

    // 2. product = the one asked for: type its title → pick it from the list
    //    (not "first in the list": that can be a qa_auto test product without a variant)
    await this.field('Select product').getByRole('combobox').fill(item.product);
    // an option has no name of its own: it shows the title + SKU as text → match the title text exactly
    await this.page.getByRole('option').filter({ has: this.page.getByText(item.product, { exact: true }) }).first().click();

    // 3. the "Subscription" box must be ticked automatically for a subscription product
    await expect(dialog.getByRole('checkbox', { name: 'Subscription' })).toBeChecked();

    // 4. subscription type: the one asked for (item.type), or the first option if none given
    await dialog.getByRole('button', { name: /^Type/ }).click();
    if (item.type) await this.page.getByRole('option', { name: new RegExp(item.type, 'i') }).first().click();
    else await this.page.getByRole('option').first().click();
    if (item.type) await expect(dialog.getByRole('button', { name: /^Type/ }), 'chosen type').toContainText(item.type);

    // 5. price + quantity → the dialog shows unit price and row total
    await dialog.getByRole('textbox', { name: 'Price', exact: true }).fill(item.price);
    await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill(item.quantity);
    await expect(dialog.getByText('Row total:')).toBeVisible();

    // 6. duration + monthly; interval and prepaid duration default to 1
    await dialog.getByRole('textbox', { name: 'Duration', exact: true }).fill(item.duration);
    await dialog.getByRole('button', { name: /^Frequency/ }).click();
    await this.page.getByRole('option', { name: 'monthly' }).first().click();

    // 7. start date = today (the date picker opens on today → Select)
    await this.textInput('Start date').click();
    await this.page.locator('button', { hasText: 'Select' }).first().click();

    // 8. variant = first in the list - chosen LAST: changing other fields can clear it.
    //    Its list loads after the product was chosen → retry until the variant box shows a value.
    const variantInput = this.field('Select variant').getByRole('combobox');
    await expect(async () => {
      await this.field('Select variant').getByRole('button').first().click();
      await this.page.getByRole('option').first().click({ timeout: 3_000 });
      await expect(variantInput).not.toHaveValue('', { timeout: 2_000 });
    }, 'a variant is selected').toPass({ timeout: 20_000 });

    // 9. submit the item → the dialog closes
    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog, 'Add item dialog closed (item accepted)').toBeHidden();
  }

  /** Fills the billing address; returns the email actually used ({{timestamp}} replaced). */
  async fillBillingAddress(address: BillingAddress): Promise<string> {
    await this.page.locator('p', { hasText: 'Billing address' }).scrollIntoViewIfNeeded();
    const email = address.email.replace('{{timestamp}}', String(Date.now()));
    const fields: [string, string][] = [
      ['billing-first-name', address.givenName],
      ['billing-last-name', address.surname],
      ['billing-email', email],
      ['billing-phone', address.phone],
      ['billing-vat-number', address.vatNumber],
      ['billing-company', address.company],
      ['billing-street', address.street],
      ['billing-street-number', address.streetNumber],
      ['billing-address-addition', address.addressAddition],
      ['billing-postal-code', address.postalCode],
      ['billing-city', address.city],
    ];
    for (const [cy, value] of fields) {
      if (value) await this.page.locator(`[data-cy="${cy}"] input[type="text"]`).fill(value);
    }
    // Country is a dropdown: open it via its outer box (the inner input cannot be clicked), pick the country
    const country = this.page.getByRole('combobox').filter({ has: this.page.getByRole('combobox', { name: 'Country *' }) }).first();
    await country.click();
    await this.page.getByRole('option', { name: address.country, exact: true }).first().click();
    await expect(country, 'country selected').toContainText(address.country);
    return email;
  }

  /** Ticks "Charge by invoice" (order is paid by invoice instead of card). */
  async enableChargeByInvoice() {
    await this.page.locator('input[aria-label="Charge by invoice"]').click({ force: true });
  }

  /** Submits and returns the new order id from the URL (/cms/orders/{id}). */
  async submitOrder(): Promise<string> {
    await this.page.locator('button[data-cy="btn-submit"]', { hasText: 'Create order' }).click();
    // order ids are numbers - the form's own URL (/cms/orders/create) must not count
    await expect(this.page, 'URL of the new order').toHaveURL(/\/cms\/orders\/\d+$/, { timeout: 30_000 });
    return this.page.url().split('/cms/orders/')[1];
  }

  // ---------- "Edit order" form (/orders/{id}/edit - same form as Create order) ----------

  /** Item list → edit button of the first item → new quantity → submit the item dialog. */
  async changeFirstItemQuantity(quantity: string) {
    // first cell of an item row has two buttons: edit (first) and delete (second)
    await this.page.locator('tbody tr').first().locator('td').first().getByRole('button').first().click();
    const dialog = this.page.getByRole('dialog').last();
    await expect(dialog.getByRole('textbox', { name: 'Quantity', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill(quantity);
    await this.submitButton.click();
    await expect(this.page.locator('tbody tr').first().locator('td').nth(2)).toHaveText(quantity);
  }

  /** Number of items in the item list. */
  async itemCount(): Promise<number> {
    return this.page.locator('tbody tr').filter({ has: this.page.locator('td') }).filter({ hasNotText: 'Row total' }).count();
  }

  /** The edit form can open with an empty "Street number *" (required) → fill it if empty. */
  async fillStreetNumberIfEmpty(streetNumber: string) {
    const field = this.page.getByRole('textbox', { name: 'Street number *' });
    if ((await field.inputValue()) === '') await field.fill(streetNumber);
  }

  /** Clicks "Edit order" at the bottom of the edit form; returns the order id in the URL afterwards. */
  async submitEditOrder(): Promise<string> {
    await this.page.getByRole('button', { name: 'Edit order' }).last().click();
    await expect(this.page).not.toHaveURL(/\/edit$/, { timeout: 30_000 });
    return this.page.url().split('/cms/orders/')[1]?.split(/[/?#]/)[0] ?? '';
  }

  /** Submits and returns the new draft id from the URL (/cms/orders/drafts/{id}). */
  async submitQuote(): Promise<string> {
    await this.page.locator('button[data-cy="btn-submit"]', { hasText: 'Create quote' }).click();
    // quote ids look like quote_12345678 - the form's own URL (/drafts/create) must not count
    await expect(this.page, 'URL of the new quote').toHaveURL(/\/cms\/orders\/drafts\/quote_[^/]+$/, { timeout: 30_000 });
    return this.page.url().split('/cms/orders/drafts/')[1];
  }
}
