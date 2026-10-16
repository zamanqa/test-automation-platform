import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { addresses, carts, payments, vouchers } from '@data/static/checkout';
import { findDisabledVoucher, findExpiredVoucher } from '@db/queries/hub/checkout-vouchers';
import { getOrderWithCustomer } from '@db/queries/hub/orders';
import { findCartItems, getCart } from '@db/queries/checkout/carts';
import { countCheckoutOrdersByEmail, getCheckoutOrder } from '@db/queries/checkout/orders';
import type { CartSummary } from '@pages/checkout/CheckoutPage';
import type { OrderWithCustomerRow } from '@db/queries/hub/orders';
import type { CheckoutOrderRow } from '@db/queries/checkout/orders';

// Rules of the Shopify + Stripe checkout: field validation, countries, vouchers, shipping and tax saved on the cart,
// the payment step, API errors, card problems, and the order data in the checkout DB and the hub.
// Needs: the Stripe test cart; vouchers of the shop: 12 (5 €), 13 (20 %), 10 (email-bound),
// an expired and a switched-off one (hub DB, schema checkout); checkout DB (db.checkout).
// Changes data: voucher, country and shipping tests change the shared test cart and put it back (cleanup).
// The order tests create test orders; "declined card" may create and cancel one.

const shop = carts.shopifyStripe;
const checkoutApi = `${new URL(env.checkout.CHECKOUT_API_URL).origin}/v1/${shop.apiKey}`;

/** Checks that the checkout order and the hub order have the amounts of the page and the typed customer data. */
function checkOrders(checkoutOrder: CheckoutOrderRow, hubOrder: OrderWithCustomerRow, summary: CartSummary, email: string) {
  // Checkout DB
  expect(checkoutOrder.order_amount).toBeCloseTo(summary.total, 2);
  expect(Math.abs(checkoutOrder.tax_amount - summary.tax)).toBeLessThanOrEqual(0.01);
  expect(checkoutOrder.email).toBe(email);
  expect(checkoutOrder.firstname).toBe(addresses.germany.firstName);
  expect(checkoutOrder.lastname).toBe(addresses.germany.lastName);
  expect(checkoutOrder.billing_street).toContain(addresses.germany.street);
  expect(checkoutOrder.billing_postal_code).toBe(addresses.germany.postalCode);
  expect(checkoutOrder.billing_city).toBe(addresses.germany.city);
  // Hub DB
  expect(Number(hubOrder.amount)).toBeCloseTo(summary.total, 2);
  expect(Math.abs(Number(hubOrder.tax_amount) - summary.tax)).toBeLessThanOrEqual(0.01);
  expect(Number(hubOrder.shipping_amount)).toBeCloseTo(summary.shipping, 2);
  expect(hubOrder.email).toBe(email);
  expect(hubOrder.billing_first_name).toBe(addresses.germany.firstName);
  expect(hubOrder.billing_last_name).toBe(addresses.germany.lastName);
  expect(hubOrder.billing_street).toContain(addresses.germany.street);
  expect(hubOrder.billing_postal_code).toBe(addresses.germany.postalCode);
  expect(hubOrder.billing_city).toBe(addresses.germany.city);
}

test.describe('Checkout rules - Shopify + Stripe - contact form', () => {
  // Before each test: an empty contact form. Nothing is paid.
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.openWithEmptyForm(shop);
  });

  test('empty required fields show an error and Continue does not go on', async ({ checkoutPage }) => {
    // ACTION: click Continue without typing anything
    await checkoutPage.nextStepButton.click();

    // CHECK: every required field shows "... is required."
    await expect(checkoutPage.fieldBox('billing_first_name')).toContainText('First name is required.');
    await expect(checkoutPage.fieldBox('billing_last_name')).toContainText('Last name is required.');
    await expect(checkoutPage.fieldBox('email')).toContainText('Email is required.');
    await expect(checkoutPage.fieldBox('billing_street')).toContainText('Street is required.');
    await expect(checkoutPage.fieldBox('billing_street_number')).toContainText('Street number is required.');
    await expect(checkoutPage.fieldBox('billing_postal_code')).toContainText('Postal Code is required.');
    await expect(checkoutPage.fieldBox('billing_city')).toContainText('City is required.');

    // CHECK: optional fields show no error, the payment step is not shown
    await expect(checkoutPage.fieldBox('phone')).not.toContainText('is required');
    await expect(checkoutPage.fieldBox('billing_notes')).not.toContainText('is required');
    await expect(checkoutPage.payButton).toBeHidden();
  });

  test('wrong email and street number values show an error and Continue does not go on', async ({ checkoutPage }) => {
    // SETUP: a filled form
    await checkoutPage.fillBillingDetails(addresses.germany);

    // ACTION + CHECK: email without a domain → "Email must be valid."
    await checkoutPage.typeInField('email', 'abc');
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('email')).toContainText('Email must be valid.');
    await expect(checkoutPage.payButton).toBeHidden();

    // ACTION + CHECK: email with a domain but no dot → same error
    await checkoutPage.typeInField('email', 'abc@test');
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('email')).toContainText('Email must be valid.');

    // ACTION + CHECK: street number without a digit → "Street number must be valid."
    await checkoutPage.typeInField('email', 'qa.check@example.com');
    await checkoutPage.typeInField('billing_street_number', 'abc');
    await checkoutPage.nextStepButton.click();
    await expect(checkoutPage.fieldBox('billing_street_number')).toContainText('Street number must be valid.');
    await expect(checkoutPage.payButton).toBeHidden();

    // ACTION + CHECK: a street number with a letter is fine ("139a") → the payment step opens
    await checkoutPage.typeInField('billing_street_number', '139a');
    await checkoutPage.continue();
  });

  test('the country list shows only the delivery countries of the shop', async ({ page }) => {
    // ACTION: open the Country dropdown
    await page.getByRole('button', { name: /^Country/ }).click();

    // CHECK: exactly the shop's delivery countries (checkout_limitations.delivery_countries: at, be, de, no, es)
    await expect(page.getByRole('option')).toHaveText(['Austria', 'Belgium', 'Germany', 'Norway', 'Spain']);
  });

  test('Back and reload keep the typed contact data', async ({ page, checkoutPage }) => {
    // SETUP: fill the form and go to the payment step
    const email = await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();

    // ACTION + CHECK: Back → the contact form shows the typed data
    await checkoutPage.backToContactForm();
    expect(await checkoutPage.fieldValue('billing_first_name')).toBe(addresses.germany.firstName);
    expect(await checkoutPage.fieldValue('email')).toBe(email);
    expect(await checkoutPage.fieldValue('billing_city')).toBe(addresses.germany.city);

    // CHECK: the shipping methods are shown again (soft: today they stay hidden after Back, bug CIR-1592)
    await expect.soft(checkoutPage.shippingMethods().first()).toBeVisible();

    // ACTION + CHECK: reload the page → still the typed data
    await page.reload();
    await expect(checkoutPage.fieldBox('billing_first_name')).toBeVisible();
    expect(await checkoutPage.fieldValue('billing_last_name')).toBe(addresses.germany.lastName);
    expect(await checkoutPage.fieldValue('billing_postal_code')).toBe(addresses.germany.postalCode);
  });

  test('the basket shows the items of the cart', async ({ page, db }) => {
    // SETUP: the items in the checkout DB
    const items = await findCartItems(db.checkout, shop.cartId);
    test.skip(items.length === 0, 'the test cart has no items');

    // CHECK: every item name is shown on the page (first and last item)
    await expect(page.getByText(items[0].name, { exact: true })).toBeVisible();
    await expect(page.getByText(items[items.length - 1].name, { exact: true })).toBeVisible();
  });
});

test.describe('Checkout rules - Shopify + Stripe - vouchers', () => {
  // Before each test: open the cart without a voucher. Remove any voucher after the test.
  test.beforeEach(async ({ checkoutPage, cleanup }) => {
    await checkoutPage.open(shop);
    await checkoutPage.removeVoucherIfApplied();
    cleanup.add('remove voucher from the Stripe test cart', async () => {
      await checkoutPage.open(shop);
      await checkoutPage.removeVoucherIfApplied();
    });
  });

  test('voucher 12 is saved on the cart (5 €) and removing it gives the old total back', async ({ checkoutPage, db }) => {
    // SETUP: total without voucher
    const before = await checkoutPage.readSummary();

    // ACTION: apply voucher 12
    await checkoutPage.applyVoucher(vouchers.stripe.code);

    // CHECK: the cart in the checkout DB has the code and 5 € discount
    const cart = await getCart(db.checkout, shop.cartId);
    expect(cart.voucher_code).toBe(vouchers.stripe.code);
    expect(cart.voucher_discount).toBe(vouchers.stripe.discount);

    // ACTION: remove the voucher
    await checkoutPage.removeVoucherIfApplied();

    // CHECK: no voucher on the cart, the total is the old one again
    await expect.poll(async () => (await getCart(db.checkout, shop.cartId)).voucher_code, { message: 'cart voucher_code' }).toBeFalsy();
    expect((await getCart(db.checkout, shop.cartId)).voucher_discount).toBe(0);
    expect((await checkoutPage.readSummary()).total).toBe(before.total);
  });

  test('percent voucher 13 takes 20 % off the subscription prices', async ({ checkoutPage, db }) => {
    // SETUP: amounts without voucher
    const before = await checkoutPage.readSummary();

    // ACTION: apply voucher 13 (20 %); it lowers the subscription prices, there is no Discount row
    await checkoutPage.applyRecurringVoucher('13');

    // CHECK: the cart has code 13; subscriptions and total are 20 % lower
    expect((await getCart(db.checkout, shop.cartId)).voucher_code).toBe('13');
    const after = await checkoutPage.readSummary();
    expect(after.subscriptions).toBeCloseTo(before.subscriptions * 0.8, 2);
    expect(after.total).toBeCloseTo(before.total * 0.8, 2);
  });

  test('an email-bound voucher asks for the email and refuses a wrong one', async ({ checkoutPage, db }) => {
    // ACTION: enter voucher 10 (only for one email address)
    await checkoutPage.tryVoucher('10');

    // CHECK: an email field is shown
    await expect(checkoutPage.voucherEmailField()).toBeVisible();

    // ACTION: enter a different email
    await checkoutPage.tryVoucherEmail('qa.wrong@example.com');

    // CHECK: an error in the email field, no voucher on the cart
    await expect(checkoutPage.voucherEmailField()).toContainText(/email/i);
    expect((await getCart(db.checkout, shop.cartId)).voucher_code).toBeFalsy();
  });

  test('an expired voucher is refused, not saved, and the total stays the same', async ({ checkoutPage, db }) => {
    // SETUP: a voucher of this shop whose expiry date has passed
    const voucher = await findExpiredVoucher(db.hub, shop.apiKey);
    test.skip(!voucher, 'no expired voucher for this shop');
    const before = await checkoutPage.readSummary();

    // ACTION: enter the expired code
    await checkoutPage.tryVoucher(String(voucher?.voucher_code));

    // CHECK: an error is shown, no discount, all amounts unchanged, nothing saved on the cart
    await expect(checkoutPage.voucherField()).toContainText(/expired|Could not redeem voucher/);
    expect(await checkoutPage.readSummary()).toEqual(before);
    expect((await getCart(db.checkout, shop.cartId)).voucher_code).toBeFalsy();

    // CHECK: the error says the voucher is expired (soft: today the page shows the general text, bug CIR-1592)
    await expect.soft(checkoutPage.voucherField()).toContainText(/expired/i);
  });

  test('a switched-off voucher is refused, not saved, and the total stays the same', async ({ checkoutPage, db }) => {
    // SETUP: a voucher of this shop with valid = false
    const voucher = await findDisabledVoucher(db.hub, shop.apiKey);
    test.skip(!voucher, 'no switched-off voucher for this shop');
    const before = await checkoutPage.readSummary();

    // ACTION: enter the switched-off code
    await checkoutPage.tryVoucher(String(voucher?.voucher_code));

    // CHECK: error message, all amounts unchanged, nothing saved on the cart
    await expect(checkoutPage.voucherField()).toContainText('Could not redeem voucher.');
    expect(await checkoutPage.readSummary()).toEqual(before);
    expect((await getCart(db.checkout, shop.cartId)).voucher_code).toBeFalsy();
  });
});

test.describe('Checkout rules - Shopify + Stripe - shipping and tax on the cart', () => {
  // Before each test: fill the contact form and wait for the shipping methods. Nothing is paid.
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.waitForShippingMethods();
  });

  test('the 10 € shipping method is saved on the cart', async ({ page, checkoutPage, db, cleanup }) => {
    // SETUP: remember the pre-selected method and choose it again after the test
    const methods = checkoutPage.shippingMethods();
    await expect(methods.first()).toBeVisible();
    const defaultMethod = String(await methods.and(page.locator('.border-primary')).getAttribute('data-test-id'));
    cleanup.add(`shipping method back to ${defaultMethod}`, async () => {
      await checkoutPage.open(shop);
      await checkoutPage.fillBillingDetails(addresses.germany);
      await checkoutPage.waitForShippingMethods();
      await page.getByTestId(defaultMethod).click();
    });

    // ACTION: click the method that costs 10,00 €
    const tenEuro = methods.filter({ hasText: '10,00 €' }).first();
    const methodId = Number(String(await tenEuro.getAttribute('data-test-id')).replace('shipping-method-', ''));
    await tenEuro.click();
    await expect(checkoutPage.shippingCost()).toHaveText('10,00 €');

    // CHECK: the cart has shipping cost 10 and this method
    await expect.poll(async () => (await getCart(db.checkout, shop.cartId)).shipping_cost, { message: 'cart shipping_cost' }).toBe(10);
    expect((await getCart(db.checkout, shop.cartId)).shipping_method?.id).toBe(methodId);
  });

  test('changing the country to Austria saves country and 20 % tax on the cart', async ({ checkoutPage, db, cleanup }) => {
    // SETUP: country back to Germany after the test
    cleanup.add('country back to Germany', async () => {
      await checkoutPage.open(shop);
      await checkoutPage.selectCountry('Germany');
    });
    await expect(checkoutPage.salesTaxRate()).toHaveText('(19%)');

    // ACTION: choose Austria
    await checkoutPage.selectCountry('Austria');
    await expect(checkoutPage.salesTaxRate()).toHaveText('(20%)');

    // CHECK: the cart has country at and tax 20 %
    await expect.poll(async () => (await getCart(db.checkout, shop.cartId)).alpha2, { message: 'cart alpha2' }).toBe('at');
    expect((await getCart(db.checkout, shop.cartId)).tax_percent).toBe(20);
  });
});

test.describe('Checkout rules - Shopify + Stripe - payment step', () => {
  // Before each test: fill the contact form and go to the payment step. Nothing is paid.
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(shop);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('a wrong card number shows "Your card number is invalid."', async ({ stripePayment }) => {
    // ACTION: type a card number that fails the check digit
    await stripePayment.typeCard(payments.stripeWrongNumberCard);

    // CHECK: Stripe's error under the card number
    await expect(stripePayment.textInStripe('Your card number is invalid.')).toBeVisible();
  });
});

test.describe('Checkout rules - Shopify + Stripe - API errors', () => {
  const name = { first_name: 'Qa', last_name: 'Check', country: 'Germany', alpha2: 'DE' };
  const address = { ...name, street: 'Hansaallee', street_number: '139', postal_code: '60320', city: 'Frankfurt am Main' };

  // Both fail today: the API answers 500 (bug CIR-1591)
  test('voucher API answers 422 for an unknown code, not a server error', async ({ request }) => {
    // ACTION: send a code that does not exist
    const response = await request.post(`${checkoutApi}/cart/${shop.cartId}/voucher`, {
      headers: { Accept: 'application/json' },
      data: { voucher_code: 'QA_NOT_EXISTING_999' },
    });

    // CHECK: 422 "Vouchercode not found"
    expect(response.status()).toBe(422);
    expect(await response.text()).toContain('Vouchercode not found');
  });

  test('order-create API answers 400 when the billing address is missing, not a server error', async ({ request }) => {
    // ACTION: send an order without billing street, postal code and city (pay by invoice)
    const response = await request.post(`${checkoutApi}/order-create`, {
      headers: { Accept: 'application/json' },
      data: {
        cart_id: shop.cartId,
        payment_method: 'offlinegateway',
        contact: { email: 'qa.check@example.com', phone: '+4911', date_of_birth: null, vat_number: null, address: { billing: name, shipping: name } },
      },
    });

    // CHECK: 400 with a validation error, no 500
    expect(response.status()).toBe(400);
  });

  test('order-create API answers 400 without email or payment method', async ({ request }) => {
    // ACTION: an order without contact.email
    const noEmail = await request.post(`${checkoutApi}/order-create`, {
      headers: { Accept: 'application/json' },
      data: {
        cart_id: shop.cartId,
        payment_method: 'offlinegateway',
        contact: { phone: '+4911', date_of_birth: null, vat_number: null, address: { billing: address, shipping: address } },
      },
    });

    // CHECK: 400, the error names contact.email
    expect(noEmail.status()).toBe(400);
    expect(await noEmail.text()).toContain('contact.email');

    // ACTION: an order without payment_method
    const noPaymentMethod = await request.post(`${checkoutApi}/order-create`, {
      headers: { Accept: 'application/json' },
      data: {
        cart_id: shop.cartId,
        contact: { email: 'qa.check@example.com', phone: '+4911', date_of_birth: null, vat_number: null, address: { billing: address, shipping: address } },
      },
    });

    // CHECK: 400, the error names payment_method
    expect(noPaymentMethod.status()).toBe(400);
    expect(await noPaymentMethod.text()).toContain('payment_method');
  });
});

test.describe('Checkout rules - Shopify + Stripe - payment and order', () => {
  let email = '';

  // Before each test: fill the contact form and go to the payment step
  test.beforeEach(async ({ checkoutPage }) => {
    await checkoutPage.open(shop);
    await checkoutPage.removeVoucherIfApplied();
    email = await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
  });

  test('a declined card gives no confirmation page and no order, and says it was declined', async ({ page, checkoutPage, stripePayment, db }) => {
    // ACTION: pay with Stripe's "always declined" test card
    await stripePayment.payByCard(payments.stripeDeclinedCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: after "Processing payment..." the checkout is back on the form (not the confirmation page)
    await expect(checkoutPage.fieldBox('billing_first_name').or(checkoutPage.payButton)).toBeVisible({ timeout: 60_000 });
    await expect(page).not.toHaveURL(/confirmation/);

    // CHECK: the checkout order made for the payment is deleted again (it exists for a few seconds)
    await expect.poll(() => countCheckoutOrdersByEmail(db.checkout, email), { message: `checkout orders of ${email}`, timeout: 60_000 }).toBe(0);

    // CHECK: the customer is told the card was declined (soft: today no message is shown, bug CIR-1592)
    await expect.soft(page.getByText(/declined/i).first()).toBeVisible();
  });

  test('3-D Secure card: after "Complete" the order is placed', async ({ checkoutPage, stripePayment, db }) => {
    // ACTION: pay with a card that asks for 3-D Secure, then confirm on Stripe's test page
    await stripePayment.payByCard(payments.stripe3dsCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();
    await stripePayment.completeThreeDSecure();

    // CHECK: confirmation page → the order is in the checkout DB and (after 30 s) in the hub
    const orderNumber = await checkoutPage.expectConfirmation();
    expect((await getCheckoutOrder(db.checkout, orderNumber)).email).toBe(email);
    await checkoutPage.waitForOrderToReachHub();
    expect((await getOrderWithCustomer(db.hub, orderNumber)).payment_status).toBe('paid');
  });

  test('card order: checkout and hub orders have the total, tax, address and buyer reference of the checkout', async ({ page, checkoutPage, stripePayment, db }) => {
    // SETUP: a buyer reference (the field is on for this shop), the amounts on the payment step
    await checkoutPage.backToContactForm();
    await checkoutPage.typeInField('buyer_reference', 'QA-LEITWEG-123');
    await checkoutPage.continue();
    const summary = await checkoutPage.readSummary();

    // ACTION: pay by card
    await stripePayment.payByCard(payments.stripeCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: the confirmation page shows the order number, the name and the total
    const orderNumber = await checkoutPage.expectConfirmation();
    await expect(page.getByText(addresses.germany.firstName).first()).toBeVisible();

    // CHECK: checkout order (card, transaction id, buyer reference) and, after 30 s, the hub order (Stripe, paid)
    const checkoutOrder = await getCheckoutOrder(db.checkout, orderNumber);
    await checkoutPage.waitForOrderToReachHub();
    const hubOrder = await getOrderWithCustomer(db.hub, orderNumber);
    checkOrders(checkoutOrder, hubOrder, summary, email);
    expect(checkoutOrder.payment_method).toBe('card');
    expect(checkoutOrder.transaction_id).toBeTruthy();
    expect(checkoutOrder.buyer_reference).toBe('QA-LEITWEG-123');
    expect(hubOrder.payment_provider).toBe('stripe');
    expect(hubOrder.payment_status).toBe('paid');
  });

  test('invoice order: clicking Pay twice makes one order, with the data of the checkout', async ({ checkoutPage, db }) => {
    // SETUP: the amounts on the payment step
    const summary = await checkoutPage.readSummary();

    // ACTION: pay by invoice, click Pay two times quickly
    await checkoutPage.selectInvoice();
    await checkoutPage.acceptAllCheckboxes();
    await expect(checkoutPage.payButton).toBeEnabled();
    await checkoutPage.payButton.dblclick();

    // CHECK: confirmation page, exactly one checkout order with this email, invoice without transaction id
    const orderNumber = await checkoutPage.expectConfirmation();
    expect(await countCheckoutOrdersByEmail(db.checkout, email)).toBe(1);
    const checkoutOrder = await getCheckoutOrder(db.checkout, orderNumber);
    expect(checkoutOrder.payment_method).toBe('offlinegateway');
    expect(checkoutOrder.transaction_id).toBeFalsy();

    // CHECK: after 30 s the hub order has the same data, waiting for payment
    await checkoutPage.waitForOrderToReachHub();
    const hubOrder = await getOrderWithCustomer(db.hub, orderNumber);
    checkOrders(checkoutOrder, hubOrder, summary, email);
    expect(hubOrder.payment_provider).toBe('offlinegateway');
    expect(hubOrder.payment_status).not.toBe('paid'); // the shop setting says payment_pending; hub rows show "payment pending" or payment_required
  });
});

test.describe('Checkout rules - Shopify + Stripe - order with voucher and shipping', () => {
  test('voucher 12 + 10 € shipping: the order total is 5 € less and 10 € more', async ({ page, checkoutPage, stripePayment, db, cleanup }) => {
    // SETUP: contact form filled, no voucher; voucher and shipping method back after the test
    await checkoutPage.open(shop);
    await checkoutPage.removeVoucherIfApplied();
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.waitForShippingMethods();
    const methods = checkoutPage.shippingMethods();
    await expect(methods.first()).toBeVisible();
    const defaultMethod = String(await methods.and(page.locator('.border-primary')).getAttribute('data-test-id'));
    cleanup.add('voucher and shipping method back', async () => {
      await checkoutPage.open(shop);
      await checkoutPage.removeVoucherIfApplied();
      await checkoutPage.fillBillingDetails(addresses.germany);
      await checkoutPage.waitForShippingMethods();
      await page.getByTestId(defaultMethod).click();
    });
    const before = await checkoutPage.readSummary();

    // ACTION: choose the 10 € method, apply voucher 12, go to the payment step
    await methods.filter({ hasText: '10,00 €' }).first().click();
    await expect(checkoutPage.shippingCost()).toHaveText('10,00 €');
    await checkoutPage.applyVoucher(vouchers.stripe.code);
    await checkoutPage.continue();
    const summary = await checkoutPage.readSummary();
    expect(summary.total).toBeCloseTo(before.total - 5 + 10, 2);

    // ACTION: pay by card
    await stripePayment.payByCard(payments.stripeCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: checkout order = the page total; hub order has 5 € discount and 10 € shipping
    const orderNumber = await checkoutPage.expectConfirmation();
    const checkoutOrder = await getCheckoutOrder(db.checkout, orderNumber);
    expect(checkoutOrder.order_amount).toBeCloseTo(summary.total, 2);
    await checkoutPage.waitForOrderToReachHub();
    const hubOrder = await getOrderWithCustomer(db.hub, orderNumber);
    expect(Number(hubOrder.amount)).toBeCloseTo(summary.total, 2);
    expect(Number(hubOrder.discount)).toBeCloseTo(5, 2);
    expect(Number(hubOrder.shipping_amount)).toBeCloseTo(10, 2);
  });
});
