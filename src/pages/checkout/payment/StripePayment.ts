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

  /** Card tab → card number, expiry, CVC. Does not click Select (used for wrong card numbers). */
  async typeCard(card: Card) {
    await this.openTab('Card');
    await this.stripeFrame().locator('input[name="number"]').fill(card.cardNumber);
    await this.stripeFrame().locator('input[name="expiry"]').fill(card.expiry);
    await this.stripeFrame().locator('input[name="cvc"]').fill(card.cvc);
  }

  /** A text shown inside Stripe's iframe, e.g. "Your card number is invalid." */
  textInStripe(text: string | RegExp) {
    return this.stripeFrame().getByText(text);
  }

  /**
   * Stripe's 3-D Secure test page after Pay: clicks "Complete".
   * The page sits in iframes inside iframes, so every frame of the page is checked until the button shows.
   */
  async completeThreeDSecure() {
    await expect(async () => {
      for (const frame of this.page.frames()) {
        const complete = frame.getByRole('button', { name: 'Complete' });
        if (await complete.isVisible().catch(() => false)) {
          // the dialog slides in, so an early click can miss: click again until the dialog is gone
          await complete.click();
          await expect(complete).toBeHidden({ timeout: 5_000 });
          return;
        }
      }
      throw new Error('3-D Secure "Complete" button is not shown yet');
    }).toPass({ timeout: 60_000 });
  }

  /** SEPA Debit tab → IBAN → Select. (Name and email are taken from the contact form.) */
  async payBySepa(iban: string) {
    await this.openTab('SEPA Debit');
    await this.stripeFrame().getByRole('textbox', { name: 'IBAN' }).fill(iban);
    await this.clickSelect();
  }
}
