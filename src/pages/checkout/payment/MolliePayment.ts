import { expect, type Page } from '@playwright/test';
import type { Card } from '@data/static/checkout';

/**
 * Mollie payment (Saleor + WooCommerce shops).
 * The Mollie method is chosen on the contact form, before Continue. Otherwise Pay stays disabled.
 * Method buttons: data-test-id="mollie-payment-method-<name>" (creditcard, ideal, bancontact, kbc, sepa).
 * For card, Pay opens Mollie's own page where the card is entered.
 */
export class MolliePayment {
  constructor(private readonly page: Page) {}

  /** Contact form: chooses "Card". */
  async chooseCard() {
    await this.page.getByTestId('mollie-payment-method-creditcard').click();
  }

  /** Contact form: chooses "SEPA direct debit" → IBAN → Select. */
  async payBySepa(iban: string) {
    await this.page.getByTestId('mollie-payment-method-sepa').click();
    await this.page.getByLabel('IBAN').fill(iban);
    const selectButton = this.page.getByRole('button', { name: 'Select', exact: true });
    await expect(selectButton).toBeEnabled();
    await selectButton.click();
  }

  /** On Mollie's own page (after Pay): enter the card → Pay → choose test status "Paid" → Continue. */
  async completeHostedCardPayment(card: Card) {
    const cardForm = this.page.frameLocator('iframe[title="Pay with card"]');
    await cardForm.locator('input#cardNumber').fill(card.cardNumber, { timeout: 60_000 });
    await cardForm.locator('input#cardExpiryDate').fill(card.expiry);
    await cardForm.locator('input#cardCvv').fill(card.cvc);
    await cardForm.locator('input#cardHolder').fill(card.cardName);
    await cardForm.locator('button[type="submit"]', { hasText: 'Pay with card' }).click();

    // Mollie test page: choose "Paid" and continue → back to the checkout
    await this.page.locator('input[type="radio"][value="paid"]').click({ timeout: 60_000 });
    await this.page.locator('.button.form__button').click();
  }
}
