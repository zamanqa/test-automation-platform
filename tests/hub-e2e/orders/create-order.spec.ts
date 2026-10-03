import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { wakeUp } from '@api/health-check';
import { billingAddress } from '@data/static/hub';
import { findCmsOrder } from '@db/queries/hub/orders';
import { findDraftOrderByDraftId } from '@db/queries/hub/draft-orders';
import { findProductForOrderItem } from '@db/queries/hub/products';

// Hub UI → "Create order" and "Create quote" forms.
// Changes data: creates 2 orders and 1 quote (draft order).
// Every item: price 10, quantity 2, duration 10. No type = the first type in the list (service).
test.describe('Hub - create order', () => {
  let product: { id: string; title: string }; // product for "Add item"

  test.beforeEach(async ({ db, hubCompanyId }) => {
    const found = await findProductForOrderItem(db.hub, hubCompanyId);
    test.skip(!found, 'No active product with an active variant (not qa_auto) in the database');
    product = found!;
  });

  // wake the hub API and the checkout API first
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(4 * 60_000);
    const request = await playwright.request.newContext();
    // up to 6 tries, 15 s apart: Cloud Run can answer 503 for a minute while it starts
    await wakeUp(request, env.hub.HUB_API_HEALTH_URL, { attempts: 6 });
    await wakeUp(request, env.checkout.CHECKOUT_API_URL, { attempts: 6 });
    await request.dispose();
  });

  test('creates an order with a service, a consumable and a digital subscription', async ({ orderCreationPage, db }) => {
    // ACTION: dashboard → "Create order" → add 3 items → billing address → submit
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '2', duration: '10' }); // service
    await orderCreationPage.addItem({ product: product.title, type: 'consumable', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.addItem({ product: product.title, type: 'digital', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    const orderId = await orderCreationPage.submitOrder();

    // CHECK: within 20 s the order is in the database with origin 'cms'
    await expect.poll(() => findCmsOrder(db.hub, orderId), { message: `order ${orderId} in the database`, timeout: 20_000 }).toBeDefined();
  });

  test('creates the same order paid by invoice', async ({ orderCreationPage, db }) => {
    // ACTION: same as above + tick "Charge by invoice"
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '2', duration: '10' }); // service
    await orderCreationPage.addItem({ product: product.title, type: 'consumable', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.addItem({ product: product.title, type: 'digital', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    await orderCreationPage.enableChargeByInvoice();
    const orderId = await orderCreationPage.submitOrder();

    // CHECK: the order appears in the database with origin 'cms'
    await expect.poll(() => findCmsOrder(db.hub, orderId), { message: `order ${orderId} in the database`, timeout: 20_000 }).toBeDefined();
  });

  test('creates a quote and opens its checkout link', async ({ orderCreationPage, db, hubCompanyId, page }) => {
    // ACTION: "Create quote" → 1 item → billing address → submit
    await orderCreationPage.startOrder('quote');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    const draftId = await orderCreationPage.submitQuote();

    // CHECK: within 20 s the draft order is in the database
    await expect
      .poll(() => findDraftOrderByDraftId(db.hub, hubCompanyId, draftId), { message: `draft order ${draftId} in the database`, timeout: 20_000 })
      .toBeDefined();

    // and its checkout link opens
    const draft = await findDraftOrderByDraftId(db.hub, hubCompanyId, draftId);
    await page.goto(draft!.order_checkout_link!);
    await page.goBack();
  });
});
