// ─── Imports ──────────────────────────────────────────────────────────────────────
// test, expect         ← src/fixtures/index.ts (gives: customerApi, db, cleanup ...)
// createOrderPayload   ← src/data/payloads/customer-api/orders.ts (old API's POST /orders body)
// updateAddressPayload ← src/data/payloads/shared/orders.ts (same body for both APIs)
// find... / getOrderStatus ← src/db/queries/hub/orders.ts
// cron helpers         ← src/db/queries/hub/crons.ts
import { test, expect } from '@fixtures';
import { createOrderPayload } from '@data/payloads/customer-api/orders';
import { updateAddressPayload } from '@data/payloads/shared/orders';
import {
  findChargeableCmsOrder,
  findInvoiceableOrder,
  findOpenCheckoutOrderWithoutSubscription,
  findOrder,
  getOrderStatus,
  type OrderRow,
} from '@db/queries/hub/orders';
import { CUSTOMER_API_QUEUE_WORKER_COMMAND, deleteStaleJobs, disableAllCrons, enableCrons, resetAllCrons } from '@db/queries/hub/crons';

/**
 * WHAT:   OLD Customer API (basic auth, /api/{version}/...) — /orders endpoints.
 * FROM:   cus-api cypress/e2e/customer-api/01-orders/orders.cy.js (12 tests).
 * NEEDS:  open visa checkout order without subscription; an open Stripe cms order
 *         needing payment; a pending order with an initial-invoice transaction.
 * CHANGES DATA: yes — creates an order, fulfils/cancels/tags/updates the picked order, charges one,
 *         generates an invoice, switches ALL hub crons off during the fulfil test (reset after).
 * Labels: SETUP / ACTION / CHECK, "← from:" = where a value comes from.
 * Same structure as tests/unified-api/orders/orders.spec.ts (the annotated example).
 */
test.describe.configure({ mode: 'default' });

test.describe('Customer API - orders', () => {
  // Set in beforeEach. OrderRow ← src/db/queries/hub/orders.ts
  let dbOrder: OrderRow;

  // Before each test: pick the order to act on.
  // customerApi.companyId ← .env CUSTOMER_API_COMPANY_ID (this API has no company in its URLs)
  test.beforeEach(async ({ db, customerApi }) => {
    dbOrder = await findOpenCheckoutOrderWithoutSubscription(db.hub, customerApi.companyId);
  });

  test('returns a paginated list of orders', async ({ customerApi }) => {
    // ACTION: GET /orders
    const response = await customerApi.orders.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('finds an order from the database by id', async ({ customerApi }) => {
    // ACTION: GET /orders/{id}   id ← dbOrder (beforeEach)
    const response = await customerApi.orders.get(dbOrder.order_id);

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('creates an order with a random 12-digit order_id', async ({ customerApi, db }) => {
    // ACTION: POST /orders — body has a random 12-digit order_id (← faker in the payload file)
    const response = await customerApi.orders.create(createOrderPayload());
    const { order_id } = await response.json(); // ← id the API stored

    // CHECK: order exists in the hub database
    expect(await findOrder(db.hub, order_id)).toBeDefined();
  });

  test('returns a payment update link', async ({ customerApi }) => {
    // ACTION: GET /orders/{id}/payment-update-link
    const response = await customerApi.orders.paymentUpdateLink(dbOrder.order_id);

    // CHECK: non-empty link string
    expect(response.status()).toBe(200);
    expect((await response.json()).link).toEqual(expect.any(String));
    expect((await response.json()).link).not.toBe('');
  });

  test('returns payment details with provider stripe', async ({ customerApi }) => {
    // ACTION: GET /orders/{id}/payment-details
    const response = await customerApi.orders.paymentDetails(dbOrder.order_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('payment_provider', 'stripe');
  });

  test('adds a note to an order', async ({ customerApi }) => {
    // ACTION: POST /orders/{id}/notes — fixed note text (from Cypress)
    const response = await customerApi.orders.addNote(dbOrder.order_id, {
      author: 'amine',
      message: 'test',
      description: 'test',
      pinned: false,
    });

    // CHECK
    expect(response.status()).toBe(201);
    expect(await response.json()).toHaveProperty('success', true);
  });

  test('fulfills an order through the queue', async ({ customerApi, db, cleanup }) => {
    test.setTimeout(180_000); // waits for a background job

    // SETUP: only the customers_api queue worker may run
    await deleteStaleJobs(db.hub, 'customers_api');
    await disableAllCrons(db.hub);                           // ALL hub crons off (global!)
    cleanup.add('reset crons', () => resetAllCrons(db.hub)); // runs even if the test fails
    await enableCrons(db.hub, [CUSTOMER_API_QUEUE_WORKER_COMMAND]); // command text ← crons.ts

    // ACTION: POST /orders/fulfill
    const response = await customerApi.orders.fulfill([dbOrder.order_id]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', '1:orders meet fulfillment criteria, process started.');

    // CHECK: poll the database every 5s (max 150s) until 'fulfilled'. Was a fixed cy.wait(90000).
    await expect
      .poll(() => getOrderStatus(db.hub, dbOrder.order_id), { timeout: 150_000, intervals: [5_000] })
      .toBe('fulfilled');
  });

  test('cancels an order', async ({ customerApi, db }) => {
    // ACTION: POST /orders/{id}/cancel
    const response = await customerApi.orders.cancel(dbOrder.order_id);

    // CHECK: exact body, then database status
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Cancelled' });
    expect(await getOrderStatus(db.hub, dbOrder.order_id)).toBe('cancelled');
  });

  test('tags an order', async ({ customerApi }) => {
    // ACTION: PUT /orders/{id}/tag — tag values fixed test data (from Cypress)
    const response = await customerApi.orders.tag(dbOrder.order_id, { tag: 'lost', tag_date: '2025-03-13' });

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('charges an open order created in the hub', async ({ customerApi, db }) => {
    // SETUP: newest open Stripe order from the hub UI (origin 'cms') that still needs payment
    const order = await findChargeableCmsOrder(db.hub, customerApi.companyId);

    // ACTION + CHECK: POST /orders/{id}/charge
    const response = await customerApi.orders.charge(order.order_id);
    expect(response.status()).toBe(200);
  });

  test('generates the invoice of a pending order', async ({ customerApi, db }) => {
    // SETUP: newest pending order whose transaction is an initial invoice
    const order = await findInvoiceableOrder(db.hub, customerApi.companyId);

    // ACTION + CHECK: POST /orders/{id}/generate-invoice
    const response = await customerApi.orders.generateInvoice(order.order_id);
    expect([200, 201]).toContain(response.status());
  });

  test('updates the order address', async ({ customerApi }) => {
    // ACTION: PUT /orders/{id}/address — body ← updateAddressPayload()
    const response = await customerApi.orders.updateAddress(dbOrder.order_id, updateAddressPayload());

    // CHECK
    expect([200, 201]).toContain(response.status());
  });
});
