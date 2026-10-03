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
  findQuantityAndAdditionalInfos,
  findStripeBuyoutSubscription,
} from '@db/queries/hub/subscriptions';

// Customer API - customer self service (/css/...).
// Changes data: reports an issue, moves a delivery, changes frequency and quantity (put back),
// swaps a bundle, cancels and buys out a subscription, creates an order.
// Not the same as the Unified API test: the delivery moves 5 days, the frequency is every 2 weeks,
// the message has spaces around "/", and the variant for the swap does not need to be active.
test.describe.configure({ mode: 'default' });

// latest active consumable subscription, most CSS actions use it
async function consumable(hub: Database, companyId: string) {
  return (await findActiveSubscriptionOfType(hub, companyId, 'consumable')).subscription_id;
}

test.describe('Customer API - customer self service', () => {
  test('returns the deliveries of a subscription', async ({ customerApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, customerApi.companyId);

    // ACTION: GET /css/subscriptions/{id}/deliveries
    const response = await customerApi.css.subscriptionDeliveries(subscriptionId);

    // CHECK
    expect(response.status()).toBe(200);
    const deliveries = await response.json();
    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries[0]).toHaveProperty('billing_date');
  });

  test('reports an issue for a subscription', async ({ customerApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, customerApi.companyId);

    // ACTION: POST /css/subscriptions/{id}/report-issue
    const response = await customerApi.css.reportIssue(subscriptionId, reportIssuePayload());

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Issue reported, mail sent and note saved.');
  });

  test('moves a delivery five days ahead', async ({ customerApi, db }) => {
    // SETUP: open delivery of an active consumable subscription
    const delivery = await findOpenConsumableDelivery(db.hub, customerApi.companyId);

    // ACTION: move it 5 days ahead
    const response = await customerApi.css.updateShippingDate(delivery.id, inDays(5));

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
  });

  test('changes the subscription frequency to every 2 weeks', async ({ customerApi, db }) => {
    // SETUP
    const subscriptionId = await consumable(db.hub, customerApi.companyId);

    // ACTION: PUT /css/subscriptions/{id}/change-frequency → weekly, every 2
    const response = await customerApi.css.changeFrequency(subscriptionId, 'weekly', 2);

    // CHECK: note the spaces around "/"
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Subscription frequency / interval changed.');
  });

  test('changes the quantity of a consumable subscription', async ({ customerApi, db, cleanup }) => {
    // SETUP: consumable subscription and its quantity now; put the quantity back after the test
    const subscriptionId = await consumable(db.hub, customerApi.companyId);
    const before = await findQuantityAndAdditionalInfos(db.hub, subscriptionId);
    cleanup.add(`quantity back to ${before.quantity}`, () => customerApi.css.changeQuantity(subscriptionId, before.quantity));

    // ACTION: PUT /css/subscriptions/{id}/change-quantity - one more than now
    const response = await customerApi.css.changeQuantity(subscriptionId, before.quantity + 1);

    // CHECK: the new quantity is saved
    expect(response.status()).toBe(200);
    const after = await findQuantityAndAdditionalInfos(db.hub, subscriptionId);
    expect(after.quantity).toBe(before.quantity + 1);
  });

  test('swaps the bundle variant of a subscription', async ({ customerApi, db }) => {
    // SETUP: consumable subscription and the newest variant with stock (active or not)
    const subscriptionId = await consumable(db.hub, customerApi.companyId);
    const variant = await findInStockVariant(db.hub, customerApi.companyId, { activeOnly: false });

    // ACTION: POST /css/subscriptions/{id}/bundle-swap
    const response = await customerApi.css.bundleSwap(subscriptionId, String(variant.variant_id));

    // CHECK: 202 Accepted
    expect(response.status()).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, message: 'Bundle swapped' });
  });

  test('cancels a subscription', async ({ customerApi, db }) => {
    // SETUP: oldest active normal subscription
    const subscription = await findActiveSubscriptionOfType(db.hub, customerApi.companyId, 'normal', { oldest: true });

    // ACTION: POST /css/subscriptions/{id}/cancel
    const response = await customerApi.css.cancel(subscription.subscription_id, cancelSubscriptionPayload());

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Subscription cancelled, mail sent and note saved.');
  });

  test('processes a buyout of a Stripe subscription', async ({ customerApi, db }) => {
    // SETUP: active normal subscription on a paid Stripe card order
    const subscription = await findStripeBuyoutSubscription(db.hub, customerApi.companyId);

    // ACTION: POST /css/subscriptions/{id}/process-buyout
    const response = await customerApi.css.processBuyout(subscription.subscription_id, buyoutPayload());

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('lets a customer order more of a consumable', async ({ customerApi, db }) => {
    // SETUP: paid consumable order item whose variant is in stock
    const item = await findReorderableConsumableItem(db.hub, customerApi.companyId);
    test.skip(!item, 'No paid consumable order item with an in-stock variant in the database');

    // ACTION: POST /css/orders/subscriptions
    const response = await customerApi.css.createOrder(customerOrderPayload(item!));

    // CHECK: 201 CREATED + new order_id
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, message: 'CREATED' });
    expect(body).toHaveProperty('order_id');
  });
});
