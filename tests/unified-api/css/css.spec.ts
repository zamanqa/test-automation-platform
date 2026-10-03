import { test, expect } from '@fixtures';
import type { Database } from '@db/connection';
import {
  buyoutPayload,
  cancelSubscriptionPayload,
  customerOrderPayload,
  inDays,
  reportIssuePayload,
} from '@data/payloads/shared/css';
import { findInStockVariant } from '@db/queries/hub/products';
import { findOpenConsumableDelivery } from '@db/queries/hub/recurring-payments';
import {
  findActiveSubscriptionOfType,
  findReorderableConsumableItem,
  findStripeBuyoutSubscription,
} from '@db/queries/hub/subscriptions';

// Unified API - customer self service (/css/api/...): what an end customer can do.
// Needs: active consumable and normal subscriptions, an open delivery, a Stripe subscription, stock.
// Changes data: reports an issue, moves a delivery, changes frequency, swaps a bundle,
// cancels a subscription, buys out a subscription, creates an order.
// The customer is CSS_CUSTOMER_EMAIL (src/data/payloads/shared/css.ts).
test.describe.configure({ mode: 'default' });

// latest active consumable subscription, most CSS actions use it
async function consumable(hub: Database, companyId: string) {
  return (await findActiveSubscriptionOfType(hub, companyId, 'consumable')).subscription_id;
}

test.describe('Unified API - customer self service', () => {
  test('returns the deliveries of a subscription', async ({ unifiedApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, await unifiedApi.companyId());

    // ACTION: GET /css/api/subscriptions/{id}/deliveries
    const response = await unifiedApi.css.subscriptionDeliveries(subscriptionId);

    // CHECK: a non-empty list whose entries have billing_date
    expect(response.status()).toBe(200);
    const deliveries = await response.json();
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries[0]).toHaveProperty('billing_date');
  });

  test('reports an issue for a subscription', async ({ unifiedApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, await unifiedApi.companyId());

    // ACTION: POST /css/api/subscriptions/{id}/report-issue - appointment in 7 days
    const response = await unifiedApi.css.reportIssue(subscriptionId, reportIssuePayload());

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Issue reported, mail sent and note saved.');
  });

  test('moves a delivery to tomorrow', async ({ unifiedApi, db }) => {
    // SETUP: first open (unsettled, not invoiced) delivery of an active consumable subscription
    const delivery = await findOpenConsumableDelivery(db.hub, await unifiedApi.companyId());

    // ACTION: move it to tomorrow
    const response = await unifiedApi.css.updateShippingDate(delivery.id, inDays(1));

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
  });

  test('changes the subscription frequency', async ({ unifiedApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, await unifiedApi.companyId());

    // ACTION: PUT /css/api/subscriptions/{id}/change-frequency → monthly, every 1
    const response = await unifiedApi.css.changeFrequency(subscriptionId, 'monthly', 1);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Subscription frequency/interval changed.');
  });

  test('swaps the bundle variant of a subscription', async ({ unifiedApi, db }) => {
    // SETUP: consumable subscription + an active variant with stock > 0
    const companyId = await unifiedApi.companyId();
    const subscriptionId = await consumable(db.hub, companyId);
    const variant = await findInStockVariant(db.hub, companyId);

    // ACTION: POST /css/api/subscriptions/{id}/bundle-swap { product_variant_id }
    const response = await unifiedApi.css.bundleSwap(subscriptionId, String(variant.variant_id));

    // CHECK: 202 Accepted
    expect(response.status()).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, message: 'Bundle swapped' });
  });

  test('cancels a subscription', async ({ unifiedApi, db }) => {
    // SETUP: the OLDEST active normal subscription
    const subscription = await findActiveSubscriptionOfType(db.hub, await unifiedApi.companyId(), 'normal', { oldest: true });

    // ACTION: POST /css/api/subscriptions/{id}/cancel - pickup in 10 days
    const response = await unifiedApi.css.cancel(subscription.subscription_id, cancelSubscriptionPayload());

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Subscription cancelled, mail sent and note saved.');
  });

  test('processes a buyout of a Stripe subscription', async ({ unifiedApi, db }) => {
    // SETUP: active normal subscription on a paid Stripe card order
    const subscription = await findStripeBuyoutSubscription(db.hub, await unifiedApi.companyId());

    // ACTION: POST /css/api/subscriptions/{id}/process-buyout (accepts terms + newsletter)
    const response = await unifiedApi.css.processBuyout(subscription.subscription_id, buyoutPayload());

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('lets a customer order more of a consumable', async ({ unifiedApi, db }) => {
    // SETUP: paid consumable order item whose variant is in stock
    const item = await findReorderableConsumableItem(db.hub, await unifiedApi.companyId());
    test.skip(!item, 'No paid consumable order item with an in-stock variant in the database');

    // ACTION: POST /css/api/orders/subscriptions - 2 more, monthly, starting in 30 days
    const response = await unifiedApi.css.createOrder(customerOrderPayload(item!));

    // CHECK: 201 CREATED with a new order_id
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, message: 'CREATED' });
    expect(body).toHaveProperty('order_id');
  });
});
