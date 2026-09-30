// dayjs, faker   = dates and random values
// test, expect   ← src/fixtures/index.ts
// ...Payload, subscriptionIdOf ← src/data/payloads/customer-api/subscriptions.ts
// find... / set... ← src/db/queries/hub/subscriptions.ts
import dayjs from 'dayjs';
import { faker } from '@faker-js/faker';
import { test, expect } from '@fixtures';
import { countOpenRecurringPayments } from '@db/queries/hub/recurring-payments';
import {
  bundleSubscriptionPayload,
  consumableSubscriptionPayload,
  subscriptionIdOf,
  subscriptionNotePayload,
} from '@data/payloads/customer-api/subscriptions';
import {
  findActiveNormalSubscriptionWithAsset,
  findActiveNormalSubscriptionWithoutEnd,
  findLatestActiveSubscription,
  findPaidCheckoutItemWithoutSubscription,
  findQuantityAndAdditionalInfos,
  findSubscription,
  setAdditionalInfos,
  setSubscriptionStatus,
  type SubscriptionRow,
} from '@db/queries/hub/subscriptions';

/**
 * WHAT:   OLD Customer API — /subscriptions endpoints.
 * FROM:   cus-api cypress/e2e/customer-api/05-subscriptions/subscriptions.cy.js (10 tests).
 * NEEDS:  an active subscription; paid checkout items without subscription (else create tests skipped).
 * CHANGES DATA: yes — creates subscriptions, end date / serial / note / auto-renew / additional_infos (put back),
 *         marks one normal subscription as bought out (not undone),
 *         sets one to 'ended' in the db then reactivates it.
 * Differences to the Unified API: dates as DD-MM-YYYY, reactivate is POST .../reactivate,
 * auto-renew is PUT .../auto-renew, plus a "add note" test.
 */
test.describe.configure({ mode: 'default' });

/** Today as DD-MM-YYYY — the format this API expects for subscription_start. */
const today = () => dayjs().format('DD-MM-YYYY');

test.describe('Customer API - subscriptions', () => {
  let subscription: SubscriptionRow; // set in beforeEach

  // Before each test: newest active subscription. companyId ← .env CUSTOMER_API_COMPANY_ID
  test.beforeEach(async ({ db, customerApi }) => {
    subscription = await findLatestActiveSubscription(db.hub, customerApi.companyId);
  });

  test('returns a paginated list of subscriptions', async ({ customerApi }) => {
    // ACTION: GET /subscriptions
    const response = await customerApi.subscriptions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a subscription by id', async ({ customerApi, db }) => {
    // ACTION: GET /subscriptions/{id}
    const response = await customerApi.subscriptions.get(subscription.subscription_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findSubscription(db.hub, subscription.subscription_id)).toBeDefined();
  });

  test('creates a consumable subscription for an order item', async ({ customerApi, db }) => {
    // SETUP: paid monthly consumable checkout item without subscription (else skipped)
    const item = await findPaidCheckoutItemWithoutSubscription(db.hub, customerApi.companyId, 'consumable');
    test.skip(!item, 'No paid consumable checkout item without a subscription');

    // ACTION: POST /subscriptions
    const response = await customerApi.subscriptions.create(consumableSubscriptionPayload(item!, today()));

    // CHECK: poll the db (max 30s) for id "order_orderItem_sku" ← subscriptionIdOf(). Was cy.wait(10000).
    expect([200, 201]).toContain(response.status());
    await expect.poll(() => findSubscription(db.hub, subscriptionIdOf(item!)), { timeout: 30_000 }).toBeDefined();
  });

  test('creates a normal subscription with bundle data for an order item', async ({ customerApi, db }) => {
    // SETUP: paid monthly NORMAL checkout item without subscription (else skipped)
    const item = await findPaidCheckoutItemWithoutSubscription(db.hub, customerApi.companyId, 'normal');
    test.skip(!item, 'No paid normal checkout item without a subscription');

    // ACTION: POST /subscriptions with bundle_data (bundle entry id ← item.item_id)
    const response = await customerApi.subscriptions.create(bundleSubscriptionPayload(item!, today()));

    // CHECK: as above
    expect([200, 201]).toContain(response.status());
    await expect.poll(() => findSubscription(db.hub, subscriptionIdOf(item!)), { timeout: 30_000 }).toBeDefined();
  });

  test('sets real_end_date', async ({ customerApi, db }) => {
    // SETUP: active normal subscription without end date; new date = today + 5..10 months
    const target = await findActiveNormalSubscriptionWithoutEnd(db.hub, customerApi.companyId);
    test.skip(!target, 'No active normal subscription without an end date');
    const endDate = dayjs().add(faker.number.int({ min: 5, max: 10 }), 'month').format('YYYY-MM-DD');

    // ACTION: PUT /subscriptions/{id} { real_end_date }
    const response = await customerApi.subscriptions.update(target!.subscription_id, { real_end_date: endDate });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await findSubscription(db.hub, target!.subscription_id))?.real_end_date).not.toBeNull();
  });

  test('saves additional_infos on a subscription', async ({ customerApi, db, cleanup }) => {
    // SETUP: remember the current additional_infos and put them back after the test
    const before = await findQuantityAndAdditionalInfos(db.hub, subscription.subscription_id);
    cleanup.add('additional_infos back', () => setAdditionalInfos(db.hub, subscription.subscription_id, before.additional_infos));
    const trackingNumber = faker.string.numeric(8);

    // ACTION: PUT /subscriptions/{id} with additional_infos
    const response = await customerApi.subscriptions.update(subscription.subscription_id, {
      additional_infos: { Tracking1: trackingNumber },
    });

    // CHECK: the value is saved in the hub db
    expect(response.status()).toBe(200);
    const after = await findQuantityAndAdditionalInfos(db.hub, subscription.subscription_id);
    expect(after.additional_infos).toMatchObject({ Tracking1: trackingNumber });
  });

  test('adds a note to a subscription', async ({ customerApi }) => {
    // ACTION: POST /subscriptions/{id}/notes — fixed note ← subscriptionNotePayload()
    const response = await customerApi.subscriptions.addNote(subscription.subscription_id, subscriptionNotePayload());

    // CHECK
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, message: 'Created' });
  });

  test('updates serial_number', async ({ customerApi, db }) => {
    // SETUP: unique serial
    const serial = `serial-${Date.now()}-${faker.number.int(999)}`;

    // ACTION: PUT /subscriptions/{id} { serial_number }
    const response = await customerApi.subscriptions.update(subscription.subscription_id, { serial_number: serial });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await findSubscription(db.hub, subscription.subscription_id))?.serial_number).toBe(serial);
  });

  test('reactivates an ended subscription', async ({ customerApi, db }) => {
    // SETUP: force status 'ended' in the database
    await setSubscriptionStatus(db.hub, subscription.subscription_id, 'ended');

    // ACTION: POST /subscriptions/{id}/reactivate
    const response = await customerApi.subscriptions.reactivate(subscription.subscription_id);

    // CHECK: 'active' again in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Reactivated' });
    expect((await findSubscription(db.hub, subscription.subscription_id))?.status).toBe('active');
  });

  // Runs twice: autoRenew = true, then false (were 2 Cypress tests)
  for (const autoRenew of [true, false]) {
    test(`turns auto_renew ${autoRenew ? 'on' : 'off'}`, async ({ customerApi, db }) => {
      // ACTION: PUT /subscriptions/{id}/auto-renew { auto_renew }
      const response = await customerApi.subscriptions.setAutoRenew(subscription.subscription_id, autoRenew);

      // CHECK
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
      expect((await findSubscription(db.hub, subscription.subscription_id))?.auto_renew).toBe(autoRenew);
    });
  }
});

test.describe('Customer API - subscription actions', () => {
  test('marks a normal subscription as bought out and stops its payments', async ({ customerApi, db }) => {
    // SETUP: newest active normal subscription that has an asset (else skipped). Not undone: it stays bought out.
    const subscription = await findActiveNormalSubscriptionWithAsset(db.hub, customerApi.companyId);
    test.skip(!subscription, 'No active normal subscription with an asset');
    const subscriptionId = subscription!.subscription_id;

    // ACTION: PUT /subscriptions/{id} { action: 'bought_out', delete_rps: true }
    const response = await customerApi.subscriptions.update(subscriptionId, { action: 'bought_out', delete_rps: true });

    // CHECK: answer; in the db: status 'manual bought out', end date set, no open recurring payments left
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true, message: 'Updated' });
    const after = await findSubscription(db.hub, subscriptionId);
    expect(after?.status).toBe('manual bought out');
    expect(after?.real_end_date).not.toBeNull();
    expect(await countOpenRecurringPayments(db.hub, subscriptionId)).toBe(0);
  });
});
