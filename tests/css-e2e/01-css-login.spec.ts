import fs from 'node:fs';
import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { CSS_DATA_FILE } from '@config/paths';
import { addresses, carts, payments } from '@data/static/checkout';
import { findOrder } from '@db/queries/hub/orders';
import { findSubscriptionRow } from '@db/queries/hub/subscriptions';
import { countInvoicedPayments, findOpenRecurringPaymentIds, getPaymentInvoiceId } from '@db/queries/hub/recurring-payments';

// Makes a customer for the CSS (customer self-service portal) tests:
// 1. checkout (Shopify + Stripe shop) → pay by card → order number
// 2. hub → that order → "Create subscription" for one normal and one consumable product
// 3. hub → the normal subscription → charge its first 2 open payments (→ 2 invoices).
//    Payments of a consumable subscription cannot be charged by hand, the menu item stays disabled.
// 4. hub → the customer → "Login CSS"
// The ids, product names and invoice ids are saved in .auth/css-data.json for the other CSS tests.
// Needs: hub login, the Stripe test cart with a normal and a consumable product.
// Changes data: a new checkout order, 2 subscriptions on it, 2 charged payments of the normal one.
test.describe('CSS - login from the hub', () => {
  test('new checkout order → 2 subscriptions in the hub → Login CSS', async ({
    page,
    checkoutPage,
    stripePayment,
    orderDetailPage,
    customerPage,
    subscriptionDetailPage,
    db,
  }) => {
    // ---------- 1. Checkout: place an order by card ----------
    // ACTION: open the Stripe cart, fill the form, pay by card
    await checkoutPage.open(carts.shopifyStripe);
    await checkoutPage.fillBillingDetails(addresses.germany);
    await checkoutPage.continue();
    await stripePayment.payByCard(payments.stripeCard);
    await checkoutPage.acceptAllCheckboxes();
    await checkoutPage.pay();

    // CHECK: confirmation page → after 30 s the order is in the hub database
    const orderId = await checkoutPage.expectConfirmation();
    await checkoutPage.waitForOrderToReachHub();
    expect(await findOrder(db.hub, orderId), `order ${orderId} in the hub DB`).toBeDefined();
    test.info().annotations.push({ type: 'order', description: orderId });

    // ---------- 2. Hub: create a normal and a consumable subscription ----------
    // ACTION: open the order in the hub
    await page.goto(`${env.hub.HUB_URL}en/cms/orders/${orderId}`);
    await orderDetailPage.waitForCreateSubscriptionButtons();

    // SETUP: first product row of type "normal" and of type "consumable" that has no subscription yet
    const normalRow = await orderDetailPage.firstRowWithoutSubscription('normal');
    const consumableRow = await orderDetailPage.firstRowWithoutSubscription('consumable');
    expect(normalRow, 'the order has a normal product without subscription').not.toBe(-1);
    expect(consumableRow, 'the order has a consumable product without subscription').not.toBe(-1);

    // SETUP: keep the product names, the CSS shows the subscriptions by product name
    const normalProduct = await orderDetailPage.productNameOf(normalRow);
    const consumableProduct = await orderDetailPage.productNameOf(consumableRow);
    test.info().annotations.push({ type: 'normal subscription product', description: normalProduct });
    test.info().annotations.push({ type: 'consumable subscription product', description: consumableProduct });

    // ACTION: Create subscription → normal
    await orderDetailPage.createSubscription(normalRow, 'normal');

    // CHECK: the row links to the new subscription, which is in the DB
    const normalSubscriptionId = await orderDetailPage.subscriptionIdOf(normalRow);
    expect(await findSubscriptionRow(db.hub, normalSubscriptionId), `normal subscription ${normalSubscriptionId} in the DB`).toBeDefined();

    // ACTION: Create subscription → consumable
    await orderDetailPage.createSubscription(consumableRow, 'consumable');

    // CHECK: the row links to the new subscription, which is in the DB
    const consumableSubscriptionId = await orderDetailPage.subscriptionIdOf(consumableRow);
    expect(await findSubscriptionRow(db.hub, consumableSubscriptionId), `consumable subscription ${consumableSubscriptionId} in the DB`).toBeDefined();

    // ---------- 3. Hub: charge 2 recurring payments of the normal subscription ----------
    // SETUP: its first 2 open recurring payments
    const normalPayments = await findOpenRecurringPaymentIds(db.hub, normalSubscriptionId, 2);
    expect(normalPayments, 'normal subscription has 2 open recurring payments').toHaveLength(2);

    // ACTION: normal subscription → charge both payments
    await page.goto(`${env.hub.HUB_URL}en/cms/subscriptions/${normalSubscriptionId}`);
    await subscriptionDetailPage.chargeRecurringPayment(normalPayments[0]);
    await subscriptionDetailPage.chargeRecurringPayment(normalPayments[1]);

    // CHECK: both payments have an invoice in the database
    await expect
      .poll(() => countInvoicedPayments(db.hub, normalPayments), { message: `invoices of recurring payments ${normalPayments.join(', ')}`, timeout: 60_000 })
      .toBe(2);

    // SETUP: keep the invoice ids for the CSS tests
    const normalInvoices = [String(await getPaymentInvoiceId(db.hub, normalPayments[0])), String(await getPaymentInvoiceId(db.hub, normalPayments[1]))];
    test.info().annotations.push({ type: 'normal invoices', description: normalInvoices.join(', ') });

    // ---------- 4. Hub: customer → Login CSS ----------
    // ACTION: open the order again and click the customer id
    await page.goto(`${env.hub.HUB_URL}en/cms/orders/${orderId}`);
    const customerId = await orderDetailPage.openCustomer();
    test.info().annotations.push({ type: 'customer', description: customerId });

    // ACTION: Login CSS (second try from the customer page if the first one does not log in)
    await customerPage.loginToSelfServicePortalWithRetry(`${env.hub.HUB_URL}en/cms/customers/${customerId}`);

    // CHECK: the CSS portal is open
    await expect(page).toHaveURL(/css\./);

    // save the ids, product names and invoice ids for the other CSS tests
    const cssData = {
      orderId,
      customerId,
      normal: { subscriptionId: normalSubscriptionId, product: normalProduct, invoiceIds: normalInvoices },
      consumable: { subscriptionId: consumableSubscriptionId, product: consumableProduct },
    };
    fs.writeFileSync(CSS_DATA_FILE, JSON.stringify(cssData, null, 2));
    console.log(`[css] saved ${CSS_DATA_FILE}: ${JSON.stringify(cssData)}`);
  });
});
