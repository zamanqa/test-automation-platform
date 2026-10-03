import { test, expect } from '@fixtures';
import { addresses, carts, invalidVoucher, payments, vouchers } from '@data/static/checkout';
import { findOrder } from '@db/queries/hub/orders';
import type { CartSummary } from '@pages/checkout/CheckoutPage';

// Checkout with the Shopify + Stripe shop.
// Orders: card, SEPA, invoice, voucher 12 + card.
// Read-only checks (no order): payment methods, country, invalid voucher, shipping method, language.
// Changes data: the order tests create test orders. The voucher, country and shipping tests change
// the shared test cart and put it back afterwards (cleanup).

/** Checks that the cart summary adds up. */
function checkSummaryAddsUp(summary: CartSummary) {
  // Subtotal = purchases + subscriptions + discount
  expect(summary.subtotal).toBeCloseTo(summary.purchases + summary.subscriptions + summary.discount, 2);
  // Total = subtotal + shipping
  expect(summary.total).toBeCloseTo(summary.subtotal + summary.shipping, 2);
  // Prices include tax. Example: 40 € with 19% → tax = 40 × 19 / 119 = 6,38 €. The shop may be 1 cent off.
  const expectedTax = (summary.total * summary.taxRate) / (100 + summary.taxRate);
  expect(Math.abs(summary.tax - expectedTax)).toBeLessThanOrEqual(0.01);
}

test.describe('Checkout - Shopify + Stripe', () => {
  // Before each test: fill the contact form and go to the payment step
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(carts.shopifyStripe);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('payment methods are shown and selectable', async ({ page, stripePayment }) => {
    // ACTION + CHECK: click each Stripe tab; each one becomes selected. (Nothing is paid.)
    await stripePayment.openTab('Card');
    await stripePayment.openTab('PayPal');
    await stripePayment.openTab('SEPA Debit');
    await stripePayment.openTab('iDEAL | Wero');

    // ACTION + CHECK: "Pay with invoice" can be clicked and we stay on the payment step
    await page.getByTestId('select-offline-invoice').click();
    await expect(page.getByTestId('btn-pay')).toBeVisible();
  });

  test('card', async ({ checkoutPage, stripePayment, db }) => {
    // ACTION: pay by card
    await stripePayment.payByCard(payments.stripeCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: confirmation page → after 30 seconds the order is in the hub database
    const orderNumber = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderNumber)).toBeDefined();
  });

  test('SEPA direct debit', async ({ checkoutPage, stripePayment, db }) => {
    // ACTION: pay by SEPA
    await stripePayment.payBySepa(payments.sepaIban);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: confirmation page → after 30 seconds the order is in the hub database
    const orderNumber = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderNumber)).toBeDefined();
  });

  test('invoice', async ({ checkoutPage, db }) => {
    // ACTION: pay by invoice
    await checkoutPage.selectInvoice();
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: confirmation page → after 30 seconds the order is in the hub database
    const orderNumber = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderNumber)).toBeDefined();
  });
});

test.describe('Checkout - Shopify + Stripe - voucher', () => {
  test('voucher 12 takes 5 € off and the order completes (card)', async ({ checkoutPage, stripePayment, db, cleanup }) => {
    // SETUP: open the cart without a voucher. The voucher is saved on the cart, so remove it after the test.
    await checkoutPage.open(carts.shopifyStripe);
    await checkoutPage.removeVoucherIfApplied();
    cleanup.add('remove voucher from the Stripe test cart', async () => {
      await checkoutPage.open(carts.shopifyStripe);
      await checkoutPage.removeVoucherIfApplied();
    });

    // CHECK (before): no discount, the summary adds up
    const before = await checkoutPage.readSummary();
    expect(before.discount).toBe(0);
    checkSummaryAddsUp(before);

    // ACTION: apply voucher 12 and wait until the total changes
    const totalBefore = await checkoutPage.totalDue().innerText();
    await checkoutPage.applyVoucher(vouchers.stripe.code);
    await expect(checkoutPage.totalDue()).not.toHaveText(totalBefore);

    // CHECK (after): discount -5 €, subtotal and total 5 € lower, less tax, the summary adds up
    const after = await checkoutPage.readSummary();
    expect(after.discount).toBe(-5);
    expect(after.subtotal).toBeCloseTo(before.subtotal - 5, 2);
    expect(after.total).toBeCloseTo(before.total - 5, 2);
    expect(after.tax).toBeLessThan(before.tax);
    checkSummaryAddsUp(after);

    // ACTION: fill the contact form and go to the payment step
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();

    // CHECK: the voucher is still there on the payment step
    const review = await checkoutPage.readSummary();
    expect(review.discount).toBe(-5);
    checkSummaryAddsUp(review);

    // ACTION: pay by card
    await stripePayment.payByCard(payments.stripeCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: confirmation page → after 30 seconds the order is in the hub database
    const orderNumber = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderNumber)).toBeDefined();
  });
});

test.describe('Checkout - Shopify + Stripe', () => {
  // Before each test: fill the contact form and wait until shipping and tax are shown. Nothing is paid.
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(carts.shopifyStripe);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.waitForShippingMethods();
    await expect(checkoutPage.salesTaxRate()).toHaveText('(19%)'); // German tax
  });

  test('changing the country from Germany to Austria recalculates the sales tax', async ({ checkoutPage, cleanup }) => {
    // SETUP: put the country back to Germany after the test
    cleanup.add('country back to Germany', async () => {
      await checkoutPage.open(carts.shopifyStripe);
      await checkoutPage.selectCountry('Germany');
    });

    // CHECK (Germany): Sales Tax (19%) and the summary adds up
    const germany = await checkoutPage.readSummary();
    checkSummaryAddsUp(germany);

    // ACTION: change the country to Austria
    await checkoutPage.selectCountry('Austria');

    // CHECK (Austria): the tax % changes, the tax amount changes, the total stays the same
    await expect(checkoutPage.salesTaxRate()).not.toHaveText('(19%)');
    const austria = await checkoutPage.readSummary();
    expect(austria.tax).not.toBe(germany.tax);
    expect(austria.total).toBe(germany.total); // prices include tax
    checkSummaryAddsUp(austria); // tax amount matches the new %
  });

  test('an invalid voucher shows an error and the total stays the same', async ({ checkoutPage }) => {
    // SETUP: no voucher on the cart
    await checkoutPage.removeVoucherIfApplied();
    const before = await checkoutPage.readSummary();

    // ACTION: enter a code that does not exist
    await checkoutPage.tryVoucher(invalidVoucher);

    // CHECK: error message, no discount, all amounts unchanged
    await expect(checkoutPage.voucherField()).toContainText('Could not redeem voucher.');
    const after = await checkoutPage.readSummary();
    expect(after.discount).toBe(0);
    expect(after).toEqual(before);
  });

  test('choosing a shipping method updates the shipping cost and total', async ({ page, checkoutPage, cleanup }) => {
    const methods = checkoutPage.shippingMethods();
    await expect(methods.first()).toBeVisible(); // wait until the buttons are on the page
    const count = await methods.count();
    test.skip(count < 2, `only ${count} shipping method offered - nothing to switch between`);

    // SETUP: remember the pre-selected method and choose it again after the test
    const defaultMethod = String(await methods.and(page.locator('.border-primary')).getAttribute('data-test-id'));
    cleanup.add(`shipping method back to ${defaultMethod}`, async () => {
      await checkoutPage.open(carts.shopifyStripe);
      await checkoutPage.fillBillingDetails(addresses.germany);
      await checkoutPage.waitForShippingMethods();
      await page.getByTestId(defaultMethod).click();
    });

    for (let i = 0; i < count; i++) {
      const method = methods.nth(i);
      const price = await checkoutPage.shippingMethodPrice(method); // e.g. "10,00 €"

      // ACTION: click the shipping method
      await method.click();

      // CHECK: it is selected, Shipping Cost shows its price, the summary adds up
      await expect(method).toHaveClass(/border-primary/);
      await expect(checkoutPage.shippingCost()).toHaveText(price);
      checkSummaryAddsUp(await checkoutPage.readSummary());
    }
  });
});

test.describe('Checkout - Shopify + Stripe ', () => {
  test('switching the language changes the page texts and the URL language code', async ({ page, checkoutPage }) => {
    // SETUP: open the cart (starts in English)
    await checkoutPage.open(carts.shopifyStripe);

    // ACTION: switch to German
    await checkoutPage.switchLanguage('Deutsch');

    // CHECK: URL has /de/, texts are German
    await expect(page).toHaveURL(/\/de\//);
    await expect(page.getByTestId('locale-button')).toHaveText('DE');
    await expect(checkoutPage.nextStepButton).toHaveText('Weiter');

    // ACTION: switch back to English
    await checkoutPage.switchLanguage('English');

    // CHECK: URL has /en/, texts are English
    await expect(page).toHaveURL(/\/en\//);
    await expect(page.getByTestId('locale-button')).toHaveText('EN');
    await expect(checkoutPage.nextStepButton).toHaveText('Continue');
  });
});
