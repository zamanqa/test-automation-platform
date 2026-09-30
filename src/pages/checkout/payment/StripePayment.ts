import { expect, type Page } from '@playwright/test';
import type { Card } from '@data/static/checkout';
import { PAYMENT_PAUSE_MS } from '@pages/checkout/CheckoutPage';

/**
 * Stripe payment on the payment step (Shopify + Stripe shop).
 * Stripe shows its payment methods as tabs inside its own iframe: "Card", "SEPA Debit", "PayPal", "iDEAL | Wero".
 */
export class StripePayment {
  constructor(private readonly page: Page) {}

  /** Stripe's iframe; all Stripe fields are inside it. */
  private stripeFrame() {
    return this.page.frameLocator('iframe[title*="Secure payment input frame"]').first();
  }

  /** Clicks a Stripe tab, e.g. "Card", and checks that it is now the selected tab. */
  async openTab(name: string) {
    const tab = this.stripeFrame().getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }

  /** Clicks the checkout's "Select" button to confirm the payment method, then waits 5 seconds. */
  private async clickSelect() {
    await this.page.getByTestId('next-step').click();
    await this.page.waitForTimeout(PAYMENT_PAUSE_MS);
  }

  /** Card tab → card number, expiry, CVC → Select. */
  async payByCard(card: Card) {
    await this.openTab('Card');
    await this.stripeFrame().locator('input[name="number"]').fill(card.cardNumber);
    await this.stripeFrame().locator('input[name="expiry"]').fill(card.expiry);
    await this.stripeFrame().locator('input[name="cvc"]').fill(card.cvc);
    await this.clickSelect();
  }

  /** SEPA Debit tab → IBAN → Select. (Name and email are taken from the contact form.) */
  async payBySepa(iban: string) {
    await this.openTab('SEPA Debit');
    await this.stripeFrame().getByRole('textbox', { name: 'IBAN' }).fill(iban);
    await this.clickSelect();
  }
}
