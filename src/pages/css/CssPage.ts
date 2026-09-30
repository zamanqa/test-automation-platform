import { expect, type Page } from '@playwright/test';
import { env } from '@config/env';
import type { Card } from '@data/static/checkout';

/**
 * The CSS (customer self-service portal). Created by the `cssPage` fixture (src/fixtures/index.ts), gets Playwright's `page`.
 * There is no password login in the tests: the hub's "Login CSS" button opens the CSS for that customer.
 */
export class CssPage {
  constructor(readonly page: Page) {}

  /**
   * Hub customer page → "Login CSS" → CSS dashboard. If the first click does not open the CSS,
   * open the customer page again and click once more (owner). customerId = cus_… (css-data.json).
   */
  async loginFromHub(customerId: string) {
    const customerUrl = `${env.hub.HUB_URL}en/cms/customers/${customerId}`;
    await this.page.goto(customerUrl);
    await this.page.getByRole('button', { name: 'Login CSS' }).click();
    try {
      await expect(this.page).toHaveURL(/css\..*\/dashboard/, { timeout: 30_000 });
    } catch {
      console.log('[css] first "Login CSS" did not open the portal → back to the customer page, trying again');
      await this.page.goto(customerUrl);
      await this.page.getByRole('button', { name: 'Login CSS' }).click();
      await expect(this.page).toHaveURL(/css\..*\/dashboard/, { timeout: 30_000 });
    }
    // Wait until the customer's data has arrived: first the page shows "Your Subscriptions (0)", and a click in that
    // moment is lost (the page re-draws). The CSS test customer always has subscriptions → wait for a count of 1 or more.
    await expect(this.page.getByText(/Your Subscriptions \([1-9]\d*\)/)).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Dashboard → tab "Upcoming deliveries" → arrow of the first delivery → "Delivery details" page.
   * Only inside the deliveries table (column "Shipping date"): the "Your Orders" and "Your invoices" tables also have rows.
   */
  async openFirstDelivery() {
    await this.page.getByRole('tab', { name: 'Upcoming deliveries' }).click();
    const deliveries = this.page.locator('table').filter({ has: this.page.getByRole('columnheader', { name: 'Shipping date' }) });
    await deliveries.locator('tbody tr').first().getByRole('button').click();
    await expect(this.page.getByRole('heading', { name: 'Delivery details', level: 1 })).toBeVisible();
  }

  /** Top menu "Refer a friend" → the Refer a friend page. */
  async openReferAFriend() {
    await this.page.getByRole('button', { name: 'Refer a friend' }).click();
    await expect(this.page.getByRole('heading', { name: 'Refer a friend', level: 1 })).toBeVisible();
  }

  /** The "Outstanding amount" box on the dashboard (shown only when an invoice is unpaid). */
  outstandingAmount() {
    return this.page.getByText('Outstanding amount', { exact: true });
  }

  /** Opens a subscription's page with one action form open: frequency_change | quantity_change | cancel_subscription | report_issue. */
  async openSubscriptionAction(subscriptionId: string, action: string) {
    const origin = new URL(this.page.url()).origin;
    // The form resets itself when the page's data arrives; anything typed before that is lost
    // (the API then answers 400 "cancellation reason must be a string") → wait for those two answers first.
    const actionsLoaded = this.page.waitForResponse((r) => r.url().includes(`/subscriptions/${subscriptionId}/actions`));
    const datesLoaded = this.page.waitForResponse((r) => r.url().includes(`/subscriptions/${subscriptionId}/delivery-dates`));
    await this.page.goto(`${origin}/en/css/subscriptions/${subscriptionId}?action=${action}`);
    await actionsLoaded;
    await datesLoaded;
    await expect(this.page.getByRole('heading', { name: 'Actions', level: 4 })).toBeVisible();
  }

  /** Cancel form: "Cancellation type *" → Normal cancellation | Extraordinary cancellation. */
  async chooseCancellationType(type: 'Normal cancellation' | 'Extraordinary cancellation') {
    await this.page.getByRole('button', { name: 'Cancellation type *' }).click();
    await this.page.getByRole('option', { name: type, exact: true }).click();
  }

  /** Cancel form: "Cancellation reason *" (appears after the type) → the first reason in the list (owner). Returns its text. */
  async chooseFirstCancellationReason(): Promise<string> {
    await this.page.getByRole('button', { name: /^Cancellation reason \*/ }).click();
    const first = this.page.getByRole('option').first();
    const reason = (await first.innerText()).trim();
    await first.click();
    return reason;
  }

  /**
   * Date field that opens a calendar dialog (Pickup Date / Appointment date): first day that can be
   * picked → first time slot that can be picked (if the dialog has slots) → Select (owner: first free date + slot).
   * Days that cannot be picked are NOT disabled; they carry the class "!pointer-events-none".
   * If the shown month has no free day, "Next" month is opened (up to 3 times).
   */
  async pickFirstFreeDate(field: 'Pickup Date *' | 'Appointment date') {
    await this.page.getByRole('textbox', { name: field }).click();
    const dialog = this.page.getByRole('dialog');
    const freeDay = dialog.locator('[role="gridcell"] button:not([class*="!pointer-events-none"])').first();
    for (let month = 0; month < 3 && (await freeDay.count()) === 0; month++) {
      await dialog.getByRole('button', { name: 'Next' }).click();
    }
    await freeDay.click();
    // time slots (Pickup Date only): they become enabled after a day is picked
    const slots = dialog.getByRole('button', { name: /^\d\d:\d\d - \d\d:\d\d$/ });
    if (await slots.count()) await slots.and(this.page.locator(':enabled')).first().click();
    await dialog.getByRole('button', { name: 'Select' }).click();
    await expect(dialog).toBeHidden();
  }

  /** Stripe's iframe on the CSS Payment page. */
  private stripeFrame() {
    return this.page.frameLocator('iframe[title*="Secure payment input frame"]').first();
  }

  /** Payment page: Stripe "Card" tab → card number, expiry, CVC. */
  private async fillCard(card: Card) {
    await this.stripeFrame().getByRole('tab', { name: 'Card', exact: true }).click();
    await this.stripeFrame().locator('input[name="number"]').fill(card.cardNumber);
    await this.stripeFrame().locator('input[name="expiry"]').fill(card.expiry);
    await this.stripeFrame().locator('input[name="cvc"]').fill(card.cvc);
  }

  /** Payment page (outstanding amount): card → "Pay …". */
  async payByCard(card: Card) {
    await this.fillCard(card);
    await this.page.getByRole('button', { name: /^Pay / }).click();
  }

  /** Payment page (update payment method): card → "Save payment method". */
  async saveCard(card: Card) {
    await this.fillCard(card);
    await this.page.getByRole('button', { name: 'Save payment method' }).click();
  }
}
