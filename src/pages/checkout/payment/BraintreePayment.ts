import { expect, type Page } from '@playwright/test';
import type { Card } from '@data/static/checkout';

/**
 * Braintree payment on the payment step (Shopware 6 + Braintree shop).
 * Braintree shows its methods as buttons named "Paying with Card", "Paying with PayPal", "Paying with Google Pay".
 */
export class BraintreePayment {
  constructor(private readonly page: Page) {}

  /** Chooses a method: "Card", "PayPal" or "Google Pay". */
  async chooseMethod(name: string) {
    const methodButton = this.page.getByRole('button', { name: `Paying with ${name}`, exact: true });
    const otherWays = this.page.getByText('Choose another way to pay');

    // If another method is open, the list is hidden → click "Choose another way to pay" first
    if (await otherWays.isVisible()) {
      await otherWays.click();
    }
    await methodButton.click();
    await expect(methodButton).toBeHidden(); // the list closes when the method opens
  }

  /** Card → card number, expiry, CVV (each in its own Braintree iframe). */
  async payByCard(card: Card) {
    await this.chooseMethod('Card');
    await this.page.frameLocator('iframe[title*="Credit Card Number"]').locator('input[name="credit-card-number"]').fill(card.cardNumber);
    await this.page.frameLocator('iframe[title*="Expiration Date"]').locator('input[name="expiration"]').fill(card.expiry);
    await this.page.frameLocator('iframe[title*="CVV"]').locator('input[name="cvv"]').fill(card.cvc);
  }
}
