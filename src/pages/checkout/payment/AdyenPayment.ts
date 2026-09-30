import { expect, type Page } from '@playwright/test';
import type { Card } from '@data/static/checkout';
import { PAYMENT_PAUSE_MS } from '@pages/checkout/CheckoutPage';

/**
 * Adyen payment on the payment step (Shopify + Adyen shop).
 * Each method is a button data-test-id="selection-btn-<name>":
 *   scheme (Cards), sepadirectdebit, paypal, ideal, twint.
 * After you choose one, the others are hidden; "Change payment" shows the list again.
 */
export class AdyenPayment {
  constructor(private readonly page: Page) {}

  /** Chooses a payment method, e.g. "scheme" for cards. */
  async chooseMethod(name: string) {
    const methodButton = this.page.getByTestId(`selection-btn-${name}`);
    // There are 2 "Change payment" buttons on the page; we want the one you can see.
    const changePayment = this.page.getByTestId('change-payment-method').filter({ visible: true });

    // If another method is open, the list is hidden → click "Change payment" first
    if (await changePayment.isVisible()) {
      await changePayment.click();
    }
    await methodButton.click();
    await expect(changePayment).toBeVisible(); // the method is now open
  }

  /** Clicks the checkout's "Select" button (enabled when the fields are filled), then waits 5 seconds. */
  private async clickSelect() {
    const selectButton = this.page.getByTestId('select-payment-method');
    await expect(selectButton).toBeEnabled();
    await selectButton.click();
    await this.page.waitForTimeout(PAYMENT_PAUSE_MS);
  }

  /** Cards → card number, expiry, CVC (each in its own Adyen iframe) → name on card → Select. */
  async payByCard(card: Card) {
    await this.chooseMethod('scheme');
    await this.page.frameLocator('iframe[title="Card number"]').locator('input[data-fieldtype="encryptedCardNumber"]').fill(card.cardNumber);
    await this.page.frameLocator('iframe[title="Expiry date"]').locator('input[data-fieldtype="encryptedExpiryDate"]').fill(card.expiry);
    await this.page.frameLocator('iframe[title="Security code"]').locator('input[data-fieldtype="encryptedSecurityCode"]').fill(card.cvc);
    await this.page.locator('input[name="holderName"]').fill(card.cardName);
    await this.clickSelect();
  }

  /** SEPA Direct Debit → account holder name + IBAN → Select. */
  async payBySepa(holderName: string, iban: string) {
    await this.chooseMethod('sepadirectdebit');
    await this.page.locator('input[name="ownerName"]').fill(holderName);
    await this.page.locator('input[name="ibanNumber"]').fill(iban);
    await this.clickSelect();
  }

  /** Adyen's test 3-D Secure page (appears after Pay): type the password and submit. */
  async complete3ds(password: string) {
    const frame = this.page.frameLocator('iframe[title*="components iframe"]').first();
    await frame.locator('input.input-field').fill(password, { timeout: 60_000 });
    await frame.locator('#buttonSubmit').click();
  }
}
