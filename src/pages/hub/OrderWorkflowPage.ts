import { expect, type Locator, type Page } from '@playwright/test';
import type { Card } from '@data/static/checkout';

/** Hub → actions on an order detail page. Selectors carried over from hub-e2e-automation OrderWorkflowPage.js. */
export class OrderWorkflowPage {
  readonly submitButton: Locator;
  readonly notification: Locator;

  /** Created per test by the fixture of the same name (src/fixtures/index.ts); `page` = Playwright's browser tab. */
  constructor(private readonly page: Page) {
    this.submitButton = page.locator('[data-cy="btn-submit"]');
    this.notification = page.locator('[data-test-id="message"]');
  }

  /** Opens the order's actions menu and picks an action by its data-cy suffix. */
  async runAction(action: 'charge' | 'mark-fulfilled' | 'charge-initial' | 'payment-update') {
    await this.clickMenuItem(this.page.locator(`[data-cy="order-action-${action}"]`), action);
  }

  /** Opens the order's actions menu and picks an action by its visible name, e.g. 'Cancel order'. */
  async runMenuAction(name: 'Cancel order' | 'Reopen order' | 'Edit order' | 'Create invoice') {
    await this.clickMenuItem(this.page.getByRole('menuitem', { name, exact: true }), name);
  }

  /**
   * The page has several menus (each note has one too). The order's actions menu is the one
   * whose items are "order-action-..."; its items are disabled for a moment while the page loads.
   * So: open each menu until the item shows up and is enabled; retry for max 30 s.
   */
  private async clickMenuItem(item: Locator, label: string) {
    const menuButtons = this.page.locator('main button[aria-haspopup="menu"]');
    await expect(async () => {
      for (let i = 0; i < (await menuButtons.count()); i++) {
        await this.page.keyboard.press('Escape'); // close a menu that is still open
        await menuButtons.nth(i).click();
        if (await this.page.locator('[data-cy^="order-action-"]').count()) break;
      }
      await expect(item).toBeEnabled({ timeout: 3_000 });
    }, `order menu action "${label}" should be enabled`).toPass({ timeout: 30_000 });
    // a normal click sometimes reports "outside of the viewport" while the menu animates open
    await item.dispatchEvent('click');
  }

  /** The dialog that is open now. */
  private dialog() {
    return this.page.getByRole('dialog').last();
  }

  /** Menu → "Cancel order" → message → consent → "Cancel order" → success → close. No refund. */
  async cancelOrder(message: string) {
    await this.runMenuAction('Cancel order');
    await this.dialog().getByRole('textbox', { name: 'Message to customer' }).fill(message);
    await this.dialog().getByRole('checkbox', { name: 'I consent to the consequences.' }).check();
    await this.dialog().getByRole('button', { name: 'Cancel order' }).click();
    await this.expectSuccessAndClose();
  }

  /** Menu → "Reopen order" → consent → Submit → success → close. */
  async reopenOrder() {
    await this.runMenuAction('Reopen order');
    await this.dialog().getByRole('checkbox', { name: 'I consent to the consequences.' }).check();
    await this.dialog().getByRole('button', { name: 'Submit' }).click();
    await this.expectSuccessAndClose();
  }

  /** Menu → "Create invoice" (pay-by-invoice orders) → Submit → success → close. */
  async createInvoice() {
    await this.runMenuAction('Create invoice');
    await this.dialog().getByRole('button', { name: 'Submit' }).click();
    await this.expectSuccessAndClose();
  }

  /** Menu → "Edit order" → Confirm → the edit form /orders/{id}/edit opens. */
  async startEditOrder() {
    await this.runMenuAction('Edit order');
    await this.dialog().getByRole('button', { name: 'Confirm' }).click();
    await expect(this.page).toHaveURL(/\/edit$/);
    // level 2 = the form title (the confirm dialog, level 3, has the same title while it closes)
    await expect(this.page.getByRole('heading', { name: 'Edit order', level: 2 })).toBeVisible();
  }

  /** "Successfully requested!" (or another success text) in the dialog → Close. */
  async expectSuccessAndClose() {
    await expect(this.page.getByText('Successfully requested!').first()).toBeVisible();
    await this.dialog().getByRole('button', { name: 'Close' }).click();
  }

  /** Clicks the first "Close" (closes a result dialog / notification). */
  async closeNotification() {
    await this.page.getByText('Close').first().click();
  }

  /** Success message after a charge, then close it. */
  async expectNotificationAndClose() {
    await expect(this.notification).toBeVisible();
    await this.closeNotification();
  }

  /** The "Message to customer" textarea of charge dialogs. */
  private messageToCustomer() {
    return this.page.locator('label', { hasText: 'Message to customer' }).locator('xpath=ancestor::div[1]').locator('textarea');
  }

  /** One-time payment dialog: one product line plus a message, then charge. */
  async chargeOneTimePayment(line: { title: string; price: string; vat: string }, message: string) {
    await this.runAction('charge');
    await this.page.locator('[data-cy="product-title"] input').fill(line.title);
    await this.page.locator('[data-cy="product-price"] input').fill(line.price);
    await this.page.locator('[data-cy="product-percentage"] input').fill(line.vat);
    await expect(this.page.locator('[data-cy="product-quantity"] input')).toHaveValue('1');
    await this.page.locator('[data-cy="btn-product-add"]').click();
    await this.messageToCustomer().fill(message);
    await this.submitButton.click();
    await this.expectNotificationAndClose();
  }

  /** Menu → "Mark as fulfilled" → confirm. */
  async markFulfilled() {
    await this.runAction('mark-fulfilled');
    await this.submitButton.click();
  }

  /** Menu → "Charge initial payment" → message → Charge → success message → close. */
  async chargeInitialPayment(message: string) {
    await this.runAction('charge-initial');
    await this.messageToCustomer().fill(message);
    await this.submitButton.click();
    await this.expectNotificationAndClose();
  }

  /** Opens the payment-update link from the menu in the same tab. */
  async openPaymentUpdateLink() {
    await this.runAction('payment-update');
    const link = this.page.locator('a', { hasText: 'Click here' });
    await link.evaluate((a) => a.removeAttribute('target'));
    await link.click();
  }

  /**
   * On the checkout's "Update payment method" page (opened by openPaymentUpdateLink, checkout.…/update-payment-method?order_id=…):
   * Stripe "Card" tab → card number, expiry, CVC → "Update payment method". card ← payments.stripeCard (owner: always 4242 4242 4242 4242).
   */
  async updatePaymentMethodByCard(card: Card) {
    await expect(this.page).toHaveURL(/\/update-payment-method\?order_id=/, { timeout: 30_000 });
    const stripe = this.page.frameLocator('iframe[title*="Secure payment input frame"]').first();
    await stripe.getByRole('tab', { name: 'Card', exact: true }).click();
    await stripe.locator('input[name="number"]').fill(card.cardNumber);
    await stripe.locator('input[name="expiry"]').fill(card.expiry);
    await stripe.locator('input[name="cvc"]').fill(card.cvc);
    await this.page.getByRole('button', { name: 'Update payment method' }).click();
  }

  /** Edit customer → new first name / surname / street → tick consent → Save. */
  async editBillingCustomer(values: { givenName: string; surname: string; street: string }) {
    await this.page.locator('[data-test-id="btn-open-edit"]').click();
    await this.page.locator('input[path="address.billing.first_name"]').fill(values.givenName);
    await this.page.locator('input[path="address.billing.last_name"]').fill(values.surname);
    await this.page.locator('input[path="address.billing.street"]').fill(values.street);
    await this.page.locator('label', { hasText: 'I consent to the consequences' }).click({ force: true });
    await this.submitButton.click();
  }

  /** Checks both names are visible on the page. */
  async expectCustomer(givenName: string, surname: string) {
    await expect(this.page.getByText(givenName).first()).toBeVisible();
    await expect(this.page.getByText(surname).first()).toBeVisible();
  }

  /** Clicks a tab on the order page by its exact name. */
  async openTab(name: 'General' | 'Payments' | 'Payment methods' | 'History') {
    await this.page.getByRole('tab', { name, exact: true }).click();
  }
}
