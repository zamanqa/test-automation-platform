// test, expect                   ← src/fixtures/index.ts
// env                            ← src/config/env.ts (health-check URLs from .env)
// wakeUp                         ← src/api/health-check.ts
// billingAddress                 ← src/data/static/hub.ts (from the old testData.json)
// findCmsOrder                   ← src/db/queries/hub/orders.ts
// findDraftOrderByDraftId        ← src/db/queries/hub/draft-orders.ts
import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { wakeUp } from '@api/health-check';
import { billingAddress } from '@data/static/hub';
import { findCmsOrder } from '@db/queries/hub/orders';
import { findDraftOrderByDraftId } from '@db/queries/hub/draft-orders';
import { findProductForOrderItem } from '@db/queries/hub/products';

/**
 * WHAT:   Hub UI → "Create order" and "Create quote" forms.
 * FROM:   hub-e2e-automation cypress/e2e/01-order-page/
 *           createManualOrder.cy.js, offlinePayOreateManualOrder.cy.js, draftOrderCreation.cy.js (1 test each).
 * CHANGES DATA: yes — creates 2 orders and 1 quote (draft order).
 * orderCreationPage methods ← src/pages/hub/OrderCreationPage.ts
 * Every item: price 10, quantity 2, duration 10 (as in Cypress). No type = the first type in the list (service).
 */
test.describe('Hub - create order', () => {
  // Product for "Add item" ← hub db: active, has an active variant, never qa_auto test data (owner, 2026-09-29)
  let product: { id: string; title: string };
  test.beforeEach(async ({ db, hubCompanyId }) => {
    const found = await findProductForOrderItem(db.hub, hubCompanyId);
    test.skip(!found, 'No active product with an active variant (not qa_auto) in the database');
    product = found!;
  });

  // Once before the file: wake the hub API and checkout API (Cypress: cy.checkApiHealth())
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(4 * 60_000); // up to 6 tries × 15 s per server
    const request = await playwright.request.newContext();
    // up to 6 tries, 15 s apart: Cloud Run can answer 503 for a minute while it starts
    await wakeUp(request, env.hub.HUB_API_HEALTH_URL, { attempts: 6 });    // ← .env HUB_API_HEALTH_URL
    await wakeUp(request, env.checkout.CHECKOUT_API_URL, { attempts: 6 }); // ← .env CHECKOUT_API_URL
    await request.dispose();
  });

  test('creates an order with a service, a consumable and a digital subscription', async ({ orderCreationPage, db }) => {
    // ACTION: dashboard → "Create order" → add 3 items → billing address → submit
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '2', duration: '10' });                      // service
    await orderCreationPage.addItem({ product: product.title, type: 'consumable', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.addItem({ product: product.title, type: 'digital', price: '10', quantity: '2', duration: '10' });
    await orderCreationPage.fillBillingAddress(billingAddress);
    const orderId = await orderCreationPage.submitOrder(); // ← new id read from the URL /cms/orders/{id}

    // CHECK: the order appears in the database with origin 'cms' (poll up to 20s)
    await expect.poll(() => findCmsOrder(db.hub, orderId), { message: `order ${orderId} in the database`, timeout: 20_000 }).toBeDefined();
  });

  test('creates the same order paid by invoice', async ({ orderCreationPage, db }) => {
    // ACTION: same as above + tick "Charge by invoice"
    await orderCreationPage.startOrder('order');
    await orderCreationPage.addItem({ product: product.title, price: '10', quantity: '2', duration: '10' });                      // service
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
    const draftId = await orderCreationPage.submitQuote(); // ← from the URL /cms/orders/drafts/{id}

    // CHECK: the draft order exists in the database (poll up to 20s) ...
    await expect
      .poll(() => findDraftOrderByDraftId(db.hub, hubCompanyId, draftId), { message: `draft order ${draftId} in the database`, timeout: 20_000 })
      .toBeDefined();

    // ... and its checkout link (← order_checkout_link column) opens; then go back
    const draft = await findDraftOrderByDraftId(db.hub, hubCompanyId, draftId);
    await page.goto(draft!.order_checkout_link!);
    await page.goBack();
  });
});
