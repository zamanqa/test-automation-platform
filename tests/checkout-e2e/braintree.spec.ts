import { test, expect } from '@fixtures';
import { addresses, carts, payments } from '@data/static/checkout';
import { findOrder } from '@db/queries/hub/orders';

/**
 * WHAT:   Checkout with the Shopware 6 + Braintree shop: card, invoice.
 *         Plus a read-only check that all payment methods can be clicked.
 * FROM:   Cypress checkout-e2e: shopware6-braintree-{card,invoice}.cy.js.
 * CHANGES DATA: yes — the order tests create test orders.
 */
test.describe('Checkout - Shopware 6 + Braintree', () => {
  // Before each test: fill the contact form and go to the payment step
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(carts.shopware6Braintree);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('payment methods are shown and selectable', async ({ page, braintreePayment }) => {
    // ACTION + CHECK: open each Braintree method. (Nothing is paid.)
    await braintreePayment.chooseMethod('Card');
    await braintreePayment.chooseMethod('PayPal');
    await braintreePayment.chooseMethod('Google Pay');

    // ACTION + CHECK: "Pay with invoice" can be clicked and we stay on the payment step
    await page.getByTestId('select-invoice').click();
    await expect(page.getByTestId('btn-pay')).toBeVisible();
  });

  test('card', async ({ checkoutPage, braintreePayment, db }) => {
    // ACTION: pay by card
    await braintreePayment.payByCard(payments.braintreeCard);
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
