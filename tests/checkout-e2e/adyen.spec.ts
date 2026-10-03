import { test, expect } from '@fixtures';
import { addresses, carts, payments } from '@data/static/checkout';
import { findOrder } from '@db/queries/hub/orders';

// Checkout with the Shopify + Adyen shop: card (with 3-D Secure), SEPA, invoice.
// Plus a read-only check that all payment methods can be clicked.
// Changes data: the order tests create test orders.
test.describe('Checkout - Shopify + Adyen', () => {
  // Before each test: fill the contact form and go to the payment step
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(carts.shopifyAdyen);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('payment methods are shown and selectable', async ({ page, adyenPayment }) => {
    // ACTION + CHECK: open each Adyen method. (Nothing is paid.)
    await adyenPayment.chooseMethod('scheme'); // Cards
    await adyenPayment.chooseMethod('sepadirectdebit');
    await adyenPayment.chooseMethod('paypal');
    await adyenPayment.chooseMethod('ideal');
    await adyenPayment.chooseMethod('twint');

    // ACTION + CHECK: "Pay with invoice" can be clicked and we stay on the payment step
    await page.getByTestId('select-invoice').click();
    await expect(page.getByTestId('btn-pay')).toBeVisible();
  });

  test('card with 3-D Secure', async ({ checkoutPage, adyenPayment, db }) => {
    // ACTION: pay by card; after Pay, Adyen asks for the 3-D Secure test password
    await adyenPayment.payByCard(payments.adyenCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();
    await adyenPayment.complete3ds('password');

    // CHECK: confirmation page → after 30 seconds the order is in the hub database
    const orderNumber = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderNumber)).toBeDefined();
  });

  test('SEPA direct debit', async ({ checkoutPage, adyenPayment, db }) => {
    // ACTION: pay by SEPA
    await adyenPayment.payBySepa(payments.adyenSepa.holderName, payments.adyenSepa.iban);
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
