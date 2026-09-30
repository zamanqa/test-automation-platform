// ─── Imports: where every name used below comes from ─────────────────────────────
// test, expect         ← src/fixtures/index.ts (Playwright's test + our fixtures: db, unifiedApi, cleanup ...)
// env                  ← src/config/env.ts (reads .env; env.checkout.CHECKOUT_API_URL etc.)
// wakeUp               ← src/api/health-check.ts (pings a URL until the server answers)
// createOrderPayload   ← src/data/payloads/unified-api/orders.ts (request body for "create order")
// updateAddressPayload ← src/data/payloads/shared/orders.ts (request body for "update address")
// find... / getOrderStatus / OrderRow ← src/db/queries/hub/orders.ts (SQL on the hub database)
// crons helpers        ← src/db/queries/hub/crons.ts (switch hub cron jobs on/off)
import { test, expect } from '@fixtures';
import { env } from '@config/env';
import { wakeUp } from '@api/health-check';
import { createOrderPayload } from '@data/payloads/unified-api/orders';
import { updateAddressPayload } from '@data/payloads/shared/orders';
import {
  findOpenCheckoutOrderWithoutSubscription,
  findOrder,
  getOrderStatus,
  type OrderRow,
} from '@db/queries/hub/orders';
import { deleteStaleJobs, disableAllCrons, enableCrons, resetAllCrons, QUEUE_WORKER_COMMAND } from '@db/queries/hub/crons';

/**
 * WHAT:   Unified Customer API (2026-04) — /orders endpoints.
 * FROM:   unified-customer-api cypress/e2e/customer-api/01-orders/orders.cy.js (all 12 tests).
 * NEEDS:  an open, visa-paid checkout order without subscription in the hub database.
 * CHANGES DATA: yes — creates orders, fulfils/cancels/tags/updates the picked order,
 *         and switches ALL hub crons off during the fulfil test (reset afterwards).
 *
 * Tests in this file run one after another: several of them pick "the latest open
 * order" and change its status, so running them in parallel would make two tests
 * act on the same order. 'default' mode keeps them in order without skipping the
 * rest when one fails (unlike 'serial').
 *
 * READING GUIDE — this file is the annotated example; every spec is built the same way:
 *   imports           test/expect from @fixtures (src/fixtures/index.ts), plus payloads
 *                     (src/data/payloads/...) and query helpers (src/db/queries/...).
 *   async ({ db, unifiedApi, cleanup })
 *                     = the fixtures this test asks for; Playwright creates them first.
 *   unifiedApi.orders.cancel(id)
 *                     → OrdersEndpoint → UnifiedApiClient.company() → BaseApiClient.send()
 *   getOrderStatus(db.hub, id)
 *                     → src/db/queries/hub/orders.ts → Database.maybeOne() on the hub database
 *   cleanup.add(...)  = undo step, runs after the test even if it fails (src/db/cleanup.ts)
 *
 * Comment labels used in every test:
 *   SETUP  = prepare data / state      ACTION = the call being tested      CHECK = assertions
 *   ← from: where a value comes from
 */
test.describe.configure({ mode: 'default' });

test.describe('Unified API - orders', () => {
  // Filled by beforeEach below, read by the tests. Type OrderRow ← src/db/queries/hub/orders.ts
  let dbOrder: OrderRow;

  // Runs ONCE before the first test of this file: wakes the checkout API (Cloud Run / Heroku
  // servers sleep when idle). `playwright` = Playwright's built-in object; newContext() gives a
  // stand-alone HTTP client, disposed right after.
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await wakeUp(request, env.checkout.CHECKOUT_API_URL); // ← from .env: CHECKOUT_API_URL
    await request.dispose();
  });

  // Runs before EACH test: picks the order to act on from the hub database.
  // db.hub                  ← `db` fixture → the hub Postgres (HUB_DB_* in .env)
  // unifiedApi.companyId()  ← the company returned by the Unified API login (consumer key in .env)
  test.beforeEach(async ({ db, unifiedApi }) => {
    dbOrder = await findOpenCheckoutOrderWithoutSubscription(db.hub, await unifiedApi.companyId());
  });

  test('returns a paginated list of orders', async ({ unifiedApi }) => {
    // ACTION: GET /orders
    const response = await unifiedApi.orders.list();

    // CHECK: HTTP 200 and at least one order in `data`  (response.json() = the API's JSON body)
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('finds an order from the database by id', async ({ unifiedApi }) => {
    // ACTION: GET /orders/{id}   id ← dbOrder, picked from the database in beforeEach
    const response = await unifiedApi.orders.get(dbOrder.order_id);

    // CHECK: the API knows the order the database has
    expect(response.status()).toBe(200);
  });

  test('creates an order and stores it in the database', async ({ unifiedApi, db }) => {
    // ACTION: POST /orders/full with the body built by createOrderPayload()
    //         (2 subscription items, random qa_auto_ email ← src/data/random.ts)
    const response = await unifiedApi.orders.createFull(createOrderPayload());
    const { order_id } = await response.json(); // ← the new order's id, from the API response

    // CHECK: the new order exists in the hub `orders` table
    expect(await findOrder(db.hub, order_id)).toBeDefined();
  });

  test('returns a payment update link', async ({ unifiedApi }) => {
    // ACTION: GET /orders/{id}/payment-update-link
    const response = await unifiedApi.orders.paymentUpdateLink(dbOrder.order_id);

    // CHECK: 200 and `link` is a non-empty string
    expect(response.status()).toBe(200);
    expect((await response.json()).link).toEqual(expect.any(String));
    expect((await response.json()).link).not.toBe('');
  });

  test('returns payment details with provider stripe', async ({ unifiedApi }) => {
    // ACTION: GET /orders/{id}/payment-details
    const response = await unifiedApi.orders.paymentDetails(dbOrder.order_id);

    // CHECK: the order was paid via Stripe (the picked order is a visa checkout order)
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('payment_provider', 'stripe');
  });

  test('adds a note to an order', async ({ unifiedApi }) => {
    // ACTION: POST /orders/{id}/notes — note text is fixed test data (same as in Cypress)
    const response = await unifiedApi.orders.addNote(dbOrder.order_id, {
      author: 'amine',
      message: 'test',
      description: 'test',
      pinned: false,
    });

    // CHECK: 201 Created + success flag
    expect(response.status()).toBe(201);
    expect(await response.json()).toHaveProperty('success', true);
  });

  test('fulfills an order through the queue', async ({ unifiedApi, db, cleanup }) => {
    // This test waits for a background job, so it gets 3 minutes instead of the default 60s.
    test.setTimeout(180_000);

    // SETUP: only the queue worker may run, so nothing else picks up the order meanwhile.
    await deleteStaleJobs(db.hub, 'customers_api');          // clear old unprocessed jobs of that queue
    await disableAllCrons(db.hub);                           // ALL hub crons off (global!)
    cleanup.add('reset crons', () => resetAllCrons(db.hub)); // undo — runs even if the test fails
    await enableCrons(db.hub, [QUEUE_WORKER_COMMAND]);       // turn on just the queue worker
    //                                    ↑ command text ← src/db/queries/hub/crons.ts

    // ACTION: POST /orders/fulfill → the API queues a background fulfil job
    const response = await unifiedApi.orders.fulfill([dbOrder.order_id]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', '1:orders meet fulfillment criteria, process started.');

    // CHECK: ask the database every 5s (max 150s) until the job set the status to 'fulfilled'.
    // Was a fixed cy.wait(90000); now finishes as soon as the status changes.
    await expect
      .poll(() => getOrderStatus(db.hub, dbOrder.order_id), { timeout: 150_000, intervals: [5_000] })
      .toBe('fulfilled');
  });

  test('cancels an order', async ({ unifiedApi, db }) => {
    // ACTION: POST /orders/{id}/cancel
    const response = await unifiedApi.orders.cancel(dbOrder.order_id);

    // CHECK: exact response body, then the status stored in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Cancelled' });
    expect(await getOrderStatus(db.hub, dbOrder.order_id)).toBe('cancelled');
  });

  test('tags an order', async ({ unifiedApi }) => {
    // ACTION: PUT /orders/{id} with a tag — tag values are fixed test data (from Cypress)
    const response = await unifiedApi.orders.update(dbOrder.order_id, { tag: 'deliveried', tag_date: '2027-03-13' });

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('creates an order and charges it', async ({ unifiedApi }) => {
    // SETUP: create a fresh order that is NOT paid by invoice (so it can be charged)
    const created = await unifiedApi.orders.createFull(createOrderPayload({ chargeByInvoice: false }));
    expect([200, 201]).toContain(created.status());
    const body = await created.json(); // ← body.order_id = id of the order just created
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('order_id');

    // ACTION + CHECK: POST /orders/{id}/charge on that new order
    const charged = await unifiedApi.orders.charge(body.order_id);
    expect(charged.status()).toBe(200);
  });

  test('creates an order and generates its invoice', async ({ unifiedApi }) => {
    // SETUP: create a fresh order (charge by invoice = true, the payload's default)
    const created = await unifiedApi.orders.createFull(createOrderPayload());
    expect([200, 201]).toContain(created.status());
    const body = await created.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('order_id');

    // ACTION + CHECK: POST /orders/{id}/generate-invoice
    const invoice = await unifiedApi.orders.generateInvoice(body.order_id);
    expect([200, 201]).toContain(invoice.status());
  });

  test('updates the order address', async ({ unifiedApi }) => {
    // ACTION: PUT /orders/{id}/address — new billing/shipping address ← updateAddressPayload()
    const response = await unifiedApi.orders.updateAddress(dbOrder.order_id, updateAddressPayload());

    // CHECK
    expect([200, 201]).toContain(response.status());
  });
});
