import { test, expect } from '@fixtures';
import { addresses, carts, payments } from '@data/static/checkout';
import { findOrder } from '@db/queries/hub/orders';

/**
 * WHAT:   Checkout with the Mollie shops (Saleor and WooCommerce): card, SEPA, invoice for each shop.
 *         Mollie is different: the payment method is chosen on the CONTACT FORM, before Continue.
 *         Card: Pay opens Mollie's own page, where the card is entered.
 * FROM:   Cypress checkout-e2e: saleor-mollie-{card,sepa,invoice}.cy.js, woocommerce-mollie-card.cy.js.
 * CHANGES DATA: yes — each test creates a test order.
 */

// The same 3 tests run for both Mollie shops
const mollieShops = [
  { name: 'Saleor', cart: carts.saleorMollie },
  { name: 'WooCommerce', cart: carts.woocommerceMollie },
];

for (const shop of mollieShops) {
  test.describe(`Checkout - ${shop.name} + Mollie`, () => {
    // Before each test: open the cart and fill the contact form
    test.beforeEach(async ({ checkoutPage }) => {
      await checkoutPage.open(shop.cart);
      await checkoutPage.fillBillingDetails(addresses.germany);
    });

    test('card (Mollie hosted page)', async ({ checkoutPage, molliePayment, db }) => {
      // ACTION: choose Card → Continue → Pay → enter the card on Mollie's page
      await molliePayment.chooseCard();
      await checkoutPage.continue();
      await checkoutPage.acceptAllCheckboxes();
      await checkoutPage.pay();
      await molliePayment.completeHostedCardPayment(payments.mollieCard);

      // CHECK: confirmation page → after 30 seconds the order is in the hub database
      const orderNumber = await checkoutPage.expectConfirmation();
      await checkoutPage.waitForOrderToReachHub();
      expect(await findOrder(db.hub, orderNumber)).toBeDefined();
    });

    test('SEPA direct debit', async ({ checkoutPage, molliePayment, db }) => {
      // ACTION: choose SEPA + IBAN → Continue → Pay
      await molliePayment.payBySepa(payments.sepaIban);
      await checkoutPage.continue();
      await checkoutPage.acceptAllCheckboxes();
      await checkoutPage.pay();

      // CHECK: confirmation page → after 30 seconds the order is in the hub database
      const orderNumber = await checkoutPage.expectConfirmation();
      await checkoutPage.waitForOrderToReachHub();
      expect(await findOrder(db.hub, orderNumber)).toBeDefined();
    });

    test('invoice', async ({ checkoutPage, db }) => {
      // ACTION: choose "Pay with invoice" → Continue → Pay
      await checkoutPage.selectInvoice();
      await checkoutPage.continue();
      await checkoutPage.acceptAllCheckboxes();
      await checkoutPage.pay();

      // CHECK: confirmation page → after 30 seconds the order is in the hub database
      const orderNumber = await checkoutPage.expectConfirmation();
      await checkoutPage.waitForOrderToReachHub();
      expect(await findOrder(db.hub, orderNumber)).toBeDefined();
    });
  });
}
