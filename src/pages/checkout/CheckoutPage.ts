import { expect, type Locator, type Page } from '@playwright/test';
import { testEmail } from '@data/random';
import type { Cart, CheckoutAddress } from '@data/static/checkout';

/** Wait 5 seconds after payment "Select" and after "Pay", so the payment provider can finish. */
export const PAYMENT_PAUSE_MS = 5_000;

/** All amounts of the cart summary (left side of the checkout), in €. */
export type CartSummary = {
  purchases: number;
  subscriptions: number;
  discount: number; // -5 with voucher 12, 0 without voucher
  subtotal: number;
  shipping: number;
  taxRate: number; // 19 for "(19%)"
  tax: number;
  total: number;
};

/** Turns money text into a number: "1.234,56 €" → 1234.56, "-5,00 €" → -5, "(19%)" → 19, "Free" → 0. */
function euro(text: string): number {
  const onlyNumber = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  if (onlyNumber === '') return 0;
  return Number(onlyNumber);
}

/**
 * The Circuly checkout page: contact form → payment step → confirmation page.
 *
 * A test uses it like this:
 *   checkoutPage.open(cart)                   open the test cart
 *   checkoutPage.fillBillingDetails(address)  fill the contact form
 *   checkoutPage.continue()                   go to the payment step
 *   stripePayment.payByCard(card)             choose a payment method (payment/*.ts)
 *   checkoutPage.acceptAllCheckboxes()        tick terms
 *   checkoutPage.pay()                        click Pay
 *   checkoutPage.expectConfirmation()         read the order number
 */
export class CheckoutPage {
  readonly payButton: Locator;
  readonly nextStepButton: Locator; // "Continue" on the contact form, "Select" on the payment step

  constructor(private readonly page: Page) {
    this.payButton = page.getByTestId('btn-pay');
    this.nextStepButton = page.getByTestId('next-step');
  }

  // ---------- Contact form ----------

  /**
   * A text field by its data-test-id. The checkout puts the same data-test-id on the <div> around the field
   * AND on the <input>, so we ask for the text box only.
   */
  private field(testId: string) {
    return this.page.getByRole('textbox').and(this.page.getByTestId(testId));
  }

  /** Types the value into the field, but only if this shop shows the field and it can be typed into. */
  private async fillIfVisible(testId: string, value: string | undefined) {
    if (!value) return;
    const field = this.field(testId);
    const canType = (await field.isVisible()) && (await field.isEditable());
    if (canType) {
      await field.fill(value);
    }
  }

  /** Opens the test cart: {CHECKOUT_URL}{apiKey}/{cartId}. Waits until the contact form is shown. */
  async open(cart: Cart) {
    await this.page.goto(`${cart.apiKey}/${cart.cartId}`);
    await expect(this.field('billing_first_name')).toBeVisible({ timeout: 30_000 });
  }

  /** Opens the test cart with an empty contact form (the form keeps typed values in the browser storage). */
  async openWithEmptyForm(cart: Cart) {
    await this.open(cart);
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await this.open(cart);
  }

  /**
   * Fills the contact form. Works for every shop: a field this shop does not show is skipped.
   * Uses a new random test email each time and returns it.
   */
  async fillBillingDetails(address: CheckoutAddress): Promise<string> {
    const email = testEmail();
    await this.selectDeliveryDateIfAsked();
    await this.fillIfVisible('billing_company', address.company);
    await this.fillIfVisible('vat_number', address.vatNumber);
    await this.fillIfVisible('billing_first_name', address.firstName);
    await this.fillIfVisible('billing_last_name', address.lastName);
    await this.fillIfVisible('email', email);
    await this.fillIfVisible('phone', address.phone);
    await this.selectDateOfBirthIfAsked();
    await this.fillIfVisible('billing_street', address.street);
    await this.fillIfVisible('billing_street_number', address.streetNumber);
    await this.fillIfVisible('billing_address_addition', address.addressRemark);
    await this.fillIfVisible('billing_postal_code', address.postalCode);
    await this.fillIfVisible('billing_city', address.city);
    await this.selectCountry(address.country);
    await this.fillIfVisible('billing_notes', address.notes);
    return email;
  }

  /** Types a value into a contact-form field, e.g. typeInField('email', 'abc'). An empty value clears it. */
  async typeInField(testId: string, value: string) {
    await this.field(testId).fill(value);
  }

  /** The box around a contact-form field; its error (e.g. "First name is required.") is shown inside it. */
  fieldBox(testId: string) {
    return this.page.locator(`div[data-test-id='${testId}']`).first();
  }

  /** Chooses a country in the Country dropdown, e.g. "Germany". Skipped if this shop has no country field. */
  async selectCountry(country: string) {
    const dropdown = this.page.getByRole('button', { name: /^Country/ }); // its name is like "Country * Germany"
    const canChoose = (await dropdown.isVisible()) && (await dropdown.isEnabled());
    if (!canChoose) return;
    await dropdown.click();
    await this.page.getByRole('option', { name: country, exact: true }).click();
    await expect(dropdown).toContainText(country);
  }

  // ---------- Date pickers ----------

  /** If the shop asks for a delivery date: picks the first free day (and first free time slot) → Select. */
  async selectDeliveryDateIfAsked() {
    const input = this.field('delivery-date');
    const isAsked = (await input.isVisible()) && (await input.isEnabled());
    if (!isAsked) return;

    await input.click();
    const picker = this.page.getByRole('dialog').filter({ has: this.page.getByRole('button', { name: /, \d{4}$/ }) });
    await this.clickFirstFreeDay(picker, 'next-month'); // delivery dates are in the future

    // Some shops also have time slots, named like "08:00 - 10:00"
    const freeSlot = picker.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2}$/, disabled: false });
    if ((await freeSlot.count()) > 0) {
      await freeSlot.first().click();
    }

    await picker.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(input).not.toHaveValue('');
  }

  /** If the shop asks for a date of birth: picks the first free day → Select. */
  async selectDateOfBirthIfAsked() {
    const input = this.field('date_of_birth');
    const isAsked = (await input.isVisible()) && (await input.isEnabled());
    if (!isAsked) return;

    await input.click();
    // The input tells us the id of its picker in "aria-controls"
    const pickerId = await input.getAttribute('aria-controls');
    const picker = this.page.locator(`[id="${pickerId}"]`);
    await this.clickFirstFreeDay(picker, 'prev-month'); // the picker opens at the youngest allowed age

    await picker.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(input).not.toHaveValue('');
  }

  /**
   * In an open date picker: clicks the first day that can be chosen.
   * If this month has no free day, it goes to the next (or previous) month. Tries at most 12 months.
   */
  private async clickFirstFreeDay(picker: Locator, monthArrow: 'next-month' | 'prev-month') {
    const allDays = picker.getByRole('button', { name: /, \d{4}$/ }); // day buttons: "Sunday, September 27, 2026"
    const freeDays = picker.getByRole('button', { name: /, \d{4}$/, disabled: false });
    const arrow = picker.locator(`[data-testid="${monthArrow}"]`); // month arrows use "data-testid" (no dash)

    for (let month = 1; month <= 12; month++) {
      await expect(allDays.first()).toBeVisible();
      if ((await freeDays.count()) > 0) {
        await freeDays.first().click();
        return;
      }
      // No free day in this month → go to the next month and wait until it is shown
      const firstDayBefore = await allDays.first().getAttribute('aria-label');
      await arrow.click();
      await expect(allDays.first()).not.toHaveAttribute('aria-label', firstDayBefore ?? '');
    }
    throw new Error('Date picker: no free day found in 12 months');
  }

  // ---------- Continue to the payment step ----------

  /**
   * Clicks Continue and waits for the payment step (the URL does not change, the Pay button appears).
   * The shop ignores Continue while the shipping methods are still loading, so we wait for them first
   * and click again if the click was ignored.
   */
  async continue() {
    await this.waitForShippingMethods();
    const contactForm = this.field('billing_first_name');
    await expect(async () => {
      // Only click while the contact form is shown (on the payment step this button means "Select")
      if (await contactForm.isVisible()) await this.nextStepButton.click();
      await expect(contactForm).toBeHidden({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(this.payButton).toBeVisible();
  }

  // ---------- Shipping ----------

  /** Waits until the shipping methods are loaded (the text "will be available when …" is gone). */
  async waitForShippingMethods() {
    await expect(this.page.getByText('will be available when the contact-form is filled out')).toBeHidden();
  }

  /** The shipping method buttons (data-test-id="shipping-method-<id>"). */
  shippingMethods() {
    return this.page.getByTestId(/^shipping-method-\d+$/);
  }

  /** The price written on a shipping method button, e.g. "10,00 €". A free method has no price → "0,00 €". */
  async shippingMethodPrice(method: Locator): Promise<string> {
    const buttonText = await method.innerText(); // e.g. "entire_cart entire_cart 10,00 €"
    const price = buttonText.match(/[\d.]+,\d{2}\s€/); // finds "10,00 €"
    if (price) return price[0];
    return '0,00 €';
  }

  // ---------- Cart summary (left side) ----------

  /** "Shipping Cost" amount, e.g. "10,00 €". */
  shippingCost() {
    return this.page.getByTestId('shipping-cost');
  }

  /** Tax rate next to "Sales Tax", e.g. "(19%)". */
  salesTaxRate() {
    return this.page.getByText('Sales Tax', { exact: true }).locator('xpath=following-sibling::span[1]');
  }

  /** "Total Due" amount, e.g. "40,00 €". */
  totalDue() {
    return this.page.getByTestId('cart-sum');
  }

  /** The amount next to a label in the summary, e.g. "Subtotal" → "40,00 €". */
  private amountAfter(label: string) {
    return this.page.getByText(label, { exact: true }).locator('xpath=following-sibling::span[1]');
  }

  /** Reads one amount from the page as a number. */
  private async readAmount(locator: Locator): Promise<number> {
    return euro(await locator.innerText());
  }

  /** Reads all amounts of the cart summary. */
  async readSummary(): Promise<CartSummary> {
    await expect(this.totalDue()).toBeVisible();

    const discount = this.page.getByTestId('implemented-voucher-value'); // only shown with a voucher
    const tax = this.page.getByText('Sales Tax', { exact: true }).locator('xpath=../following-sibling::span[1]');
    const hasDiscount = await discount.isVisible();
    const hasTaxRate = (await this.salesTaxRate().count()) > 0; // a country without tax shows no "(x%)"

    return {
      purchases: await this.readAmount(this.amountAfter('Purchases')),
      subscriptions: await this.readAmount(this.amountAfter('Subscriptions')),
      discount: hasDiscount ? await this.readAmount(discount) : 0,
      subtotal: await this.readAmount(this.amountAfter('Subtotal')),
      shipping: await this.readAmount(this.shippingCost()),
      taxRate: hasTaxRate ? await this.readAmount(this.salesTaxRate()) : 0,
      tax: await this.readAmount(tax),
      total: await this.readAmount(this.totalDue()),
    };
  }

  // ---------- Voucher (promotion code) ----------

  /** "Add promotion code" → type the code → Validate. Does not check the result (used for invalid codes too). */
  async tryVoucher(code: string) {
    await this.page.getByTestId('button-toggle-voucher-input').click();
    await this.field('voucher-code-input').fill(code);
    await this.page.getByTestId('button-validate-voucher').click();
  }

  /** Enters a valid code and waits until the Discount row is shown. */
  async applyVoucher(code: string) {
    await this.tryVoucher(code);
    await expect(this.page.getByTestId('implemented-voucher-value')).toBeVisible();
  }

  /**
   * Enters a valid code that lowers the subscription prices (percent voucher, voucher bigger than the cart):
   * these show no Discount row, so it waits for "Remove promotion code".
   */
  async applyRecurringVoucher(code: string) {
    await this.tryVoucher(code);
    await expect(this.page.getByTestId('button-remove-voucher')).toBeVisible();
  }

  /** The promotion code field; an error like "Could not redeem voucher." is shown inside it. */
  voucherField() {
    return this.page.locator("div[data-test-id='voucher-code-input']");
  }

  /** The email box an email-bound voucher asks for; its error is shown inside it. */
  voucherEmailField() {
    return this.page.locator("div[data-test-id='voucher-email-input']");
  }

  /** Types the email for an email-bound voucher → Validate. */
  async tryVoucherEmail(email: string) {
    await this.field('voucher-email-input').fill(email);
    await this.page.getByTestId('button-validate-voucher').click();
  }

  /** Removes the voucher if one is on the cart. (The voucher is saved on the cart, so it stays after reload.) */
  async removeVoucherIfApplied() {
    const addButton = this.page.getByTestId('button-toggle-voucher-input');
    const removeButton = this.page.getByTestId('button-remove-voucher');
    await expect(addButton.or(removeButton)).toBeVisible();
    if (await removeButton.isVisible()) {
      await removeButton.click();
      await expect(removeButton).toBeHidden(); // the code input may stay open instead of "Add promotion code"
    }
  }

  // ---------- Language ----------

  /** Header language menu → chooses a language as written in the menu: "Deutsch" or "English". */
  async switchLanguage(language: string) {
    await this.page.getByTestId('locale-button').click();
    await this.page.getByTestId('locale-item').filter({ hasText: language }).click();
  }

  // ---------- Payment step ----------

  /** Chooses "Pay with invoice" (Stripe shop: offline invoice). */
  async selectInvoice() {
    const invoice = this.page.getByTestId('select-invoice').or(this.page.getByTestId('select-offline-invoice'));
    await invoice.first().click();
  }

  /**
   * Clicks Continue on a filled form until the shop answers: the payment step opens or an error box is shown.
   * (A click while the shipping methods are loading is ignored.)
   */
  async clickContinue() {
    await this.waitForShippingMethods();
    await expect(async () => {
      if (await this.field('billing_first_name').isVisible()) await this.nextStepButton.click();
      await expect(this.payButton.or(this.errorAlert())).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  }

  /** "Back" on the payment step → the contact form is shown again. */
  async backToContactForm() {
    await this.page.getByRole('button', { name: 'Back', exact: true }).last().click();
    await expect(this.field('billing_first_name')).toBeVisible();
  }

  /** The value typed in a contact-form field, e.g. fieldValue('billing_city') → "Frankfurt am Main". */
  async fieldValue(testId: string): Promise<string> {
    return this.field(testId).inputValue();
  }

  /** The red message box at the top of the form, e.g. "limit reached, postal code area". */
  errorAlert() {
    return this.page.getByTestId('alert-error');
  }

  /** Ticks every checkbox (terms, privacy …). */
  async acceptAllCheckboxes() {
    const checkboxes = this.page.locator("[data-test-id='checkbox'] input[type='checkbox']");
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes.nth(i);
      // The list can re-render right after the payment method is chosen and lose a click → click until it is ticked
      await expect(async () => {
        if (!(await checkbox.isChecked())) await checkbox.click({ force: true });
        await expect(checkbox).toBeChecked({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    }
  }

  /** Clicks Pay (enabled after the terms are ticked), then waits 5 seconds. */
  async pay() {
    await expect(this.payButton).toBeEnabled();
    await this.payButton.click();
    await this.page.waitForTimeout(PAYMENT_PAUSE_MS);
  }

  // ---------- Confirmation ----------

  /** Waits for the confirmation page and returns the order number shown on it. */
  async expectConfirmation(): Promise<string> {
    await expect(this.page).toHaveURL(/confirmation/, { timeout: 90_000 });
    const orderNumber = this.page.locator('.font-mono.font-semibold').first();
    await expect(orderNumber).not.toBeEmpty();
    return (await orderNumber.innerText()).trim();
  }

  /** Waits 30 seconds so the new order can reach the hub database. */
  async waitForOrderToReachHub() {
    await this.page.waitForTimeout(30_000);
  }
}
