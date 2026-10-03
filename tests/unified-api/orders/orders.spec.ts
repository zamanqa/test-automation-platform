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

// Unified API - /orders endpoints.
// Needs: an open checkout order paid by visa, without a subscription.
// Changes data: creates, fulfils, cancels, tags and updates orders.
// The fulfil test switches all hub crons off and turns them back on afterwards.

// Tests run in order: several of them change "the latest open order".
test.describe.configure({ mode: 'default' });

test.describe('Unified API - orders', () => {
  let dbOrder: OrderRow;

  // The checkout API sleeps when idle, wake it up first
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await wakeUp(request, env.checkout.CHECKOUT_API_URL);
    await request.dispose();
  });

  test.beforeEach(async ({ db, unifiedApi }) => {
    const companyId = await unifiedApi.companyId();
    dbOrder = await findOpenCheckoutOrderWithoutSubscription(db.hub, companyId);
  });

  test('returns a paginated list of orders', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('finds an order from the database by id', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.get(dbOrder.order_id);

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('creates an order and stores it in the database', async ({ unifiedApi, db }) => {
    // ACTION: order with 2 subscription items and a random qa_auto_ email
    const response = await unifiedApi.orders.createFull(createOrderPayload());
    const { order_id } = await response.json();

    // CHECK: the order is in the hub database
    expect(await findOrder(db.hub, order_id)).toBeDefined();
  });

  test('returns a payment update link', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.paymentUpdateLink(dbOrder.order_id);

    // CHECK: link is a non-empty text
    expect(response.status()).toBe(200);
    expect((await response.json()).link).toEqual(expect.any(String));
    expect((await response.json()).link).not.toBe('');
  });

  test('returns payment details with provider stripe', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.paymentDetails(dbOrder.order_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('payment_provider', 'stripe');
  });

  test('adds a note to an order', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.addNote(dbOrder.order_id, {
      author: 'amine',
      message: 'test',
      description: 'test',
      pinned: false,
    });

    // CHECK
    expect(response.status()).toBe(201);
    expect(await response.json()).toHaveProperty('success', true);
  });

  test('fulfills an order through the queue', async ({ unifiedApi, db, cleanup }) => {
    test.setTimeout(180_000); // waits for a background job

    // SETUP: only the queue worker may run, so nothing else touches the order
    await deleteStaleJobs(db.hub, 'customers_api');
    await disableAllCrons(db.hub);
    cleanup.add('reset crons', () => resetAllCrons(db.hub));
    await enableCrons(db.hub, [QUEUE_WORKER_COMMAND]);

    // ACTION: the API queues a fulfil job
    const response = await unifiedApi.orders.fulfill([dbOrder.order_id]);
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', '1:orders meet fulfillment criteria, process started.');

    // CHECK: check the database every 5 s (max 150 s) until the order is fulfilled
    await expect
      .poll(() => getOrderStatus(db.hub, dbOrder.order_id), { timeout: 150_000, intervals: [5_000] })
      .toBe('fulfilled');
  });

  test('cancels an order', async ({ unifiedApi, db }) => {
    // ACTION
    const response = await unifiedApi.orders.cancel(dbOrder.order_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Cancelled' });
    expect(await getOrderStatus(db.hub, dbOrder.order_id)).toBe('cancelled');
  });

  test('tags an order', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.update(dbOrder.order_id, { tag: 'deliveried', tag_date: '2027-03-13' });

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('creates an order and charges it', async ({ unifiedApi }) => {
    // SETUP: new order that is not paid by invoice, so it can be charged
    const created = await unifiedApi.orders.createFull(createOrderPayload({ chargeByInvoice: false }));
    expect([200, 201]).toContain(created.status());
    const body = await created.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('order_id');

    // ACTION + CHECK
    const charged = await unifiedApi.orders.charge(body.order_id);
    expect(charged.status()).toBe(200);
  });

  test('creates an order and generates its invoice', async ({ unifiedApi }) => {
    // SETUP: new order paid by invoice
    const created = await unifiedApi.orders.createFull(createOrderPayload());
    expect([200, 201]).toContain(created.status());
    const body = await created.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('order_id');

    // ACTION + CHECK
    const invoice = await unifiedApi.orders.generateInvoice(body.order_id);
    expect([200, 201]).toContain(invoice.status());
  });

  test('updates the order address', async ({ unifiedApi }) => {
    // ACTION
    const response = await unifiedApi.orders.updateAddress(dbOrder.order_id, updateAddressPayload());

    // CHECK
    expect([200, 201]).toContain(response.status());
  });
});
