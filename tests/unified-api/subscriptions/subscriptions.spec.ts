// dayjs                 = date library (today's date, "+5 months")
// faker                 = random test values (random number for dates/serials)
// test, expect          ← src/fixtures/index.ts
// ...SubscriptionPayload ← src/data/payloads/unified-api/subscriptions.ts (POST /subscriptions bodies)
// find... / set...      ← src/db/queries/hub/subscriptions.ts
import dayjs from 'dayjs';
import { faker } from '@faker-js/faker';
import { test, expect } from '@fixtures';
import { bundleSubscriptionPayload, singleSubscriptionPayload } from '@data/payloads/unified-api/subscriptions';
import {
  findActiveNormalSubscriptionWithoutEnd,
  findBundleItemWithoutSubscription,
  findItemWithoutSubscription,
  findLatestActiveSubscription,
  findSubscription,
  setSubscriptionStatus,
  type SubscriptionRow,
} from '@db/queries/hub/subscriptions';

/**
 * WHAT:   Unified Customer API — /subscriptions endpoints.
 * FROM:   unified-customer-api cypress/e2e/customer-api/05-subscriptions/subscriptions.cy.js (9 tests).
 * NEEDS:  an active subscription; order items without subscription for the create tests (else skipped).
 * CHANGES DATA: yes — creates subscriptions, sets end date / serial / auto-renew,
 *         sets a subscription to 'ended' in the db then reactivates it.
 */
test.describe.configure({ mode: 'default' });

// Helper: today as YYYY-MM-DD (the format this API expects for subscription_start)
const today = () => dayjs().format('YYYY-MM-DD');

test.describe('Unified API - subscriptions', () => {
  // Set in beforeEach. SubscriptionRow ← src/db/queries/hub/subscriptions.ts
  let subscription: SubscriptionRow;

  // Before each test: the company's newest ACTIVE subscription ← hub db
  test.beforeEach(async ({ db, unifiedApi }) => {
    subscription = await findLatestActiveSubscription(db.hub, await unifiedApi.companyId());
  });

  test('returns a paginated list of subscriptions', async ({ unifiedApi }) => {
    // ACTION: GET /subscriptions
    const response = await unifiedApi.subscriptions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a subscription by id', async ({ unifiedApi, db }) => {
    // ACTION: GET /subscriptions/{id}   id ← subscription from beforeEach
    const response = await unifiedApi.subscriptions.get(subscription.subscription_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findSubscription(db.hub, subscription.subscription_id)).toBeDefined();
  });

  test('creates a single subscription for an order item', async ({ unifiedApi, db }) => {
    // SETUP: an order item that should become a subscription but was never created (else skipped)
    const item = await findItemWithoutSubscription(db.hub, await unifiedApi.companyId());
    test.skip(!item, 'No subscription order item without a subscription');

    // ACTION: POST /subscriptions — body built from the item (order_id, item id, sku ...) + today
    const response = await unifiedApi.subscriptions.create(singleSubscriptionPayload(item!, today()));

    // CHECK: 200/201, then ask the database every second (max 30s) until the subscription exists.
    // Was a fixed cy.wait(10000).
    expect([200, 201]).toContain(response.status());
    await expect.poll(() => findSubscription(db.hub, item!.subscription_id), { timeout: 30_000 }).toBeDefined();
  });

  test('creates a bundle subscription for an order item', async ({ unifiedApi, db }) => {
    // SETUP: a bundle order item without subscription, incl. its bundle variant (else skipped)
    const item = await findBundleItemWithoutSubscription(db.hub, await unifiedApi.companyId());
    test.skip(!item, 'No bundle order item without a subscription');

    // ACTION: POST /subscriptions with bundle_data (variant id/title ← the same row `item`)
    const response = await unifiedApi.subscriptions.create(bundleSubscriptionPayload(item!, today(), item!));

    // CHECK: as above
    expect([200, 201]).toContain(response.status());
    await expect.poll(() => findSubscription(db.hub, item!.subscription_id), { timeout: 30_000 }).toBeDefined();
  });

  test('sets real_end_date', async ({ unifiedApi, db }) => {
    // SETUP: an active 'normal' subscription without end date; new end date = today + 5..10 months
    const target = await findActiveNormalSubscriptionWithoutEnd(db.hub, await unifiedApi.companyId());
    test.skip(!target, 'No active normal subscription without an end date');
    const endDate = dayjs().add(faker.number.int({ min: 5, max: 10 }), 'month').format('YYYY-MM-DD');

    // ACTION: PUT /subscriptions/{id} { real_end_date }
    const response = await unifiedApi.subscriptions.update(target!.subscription_id, { real_end_date: endDate });

    // CHECK: the database now has an end date
    expect(response.status()).toBe(200);
    expect((await findSubscription(db.hub, target!.subscription_id))?.real_end_date).not.toBeNull();
  });

  test('updates serial_number', async ({ unifiedApi, db }) => {
    // SETUP: unique serial, e.g. "serial-1727090000000-42"
    const serial = `serial-${Date.now()}-${faker.number.int(999)}`;

    // ACTION: PUT /subscriptions/{id} { serial_number }
    const response = await unifiedApi.subscriptions.update(subscription.subscription_id, { serial_number: serial });

    // CHECK: the database stores exactly that serial
    expect(response.status()).toBe(200);
    expect((await findSubscription(db.hub, subscription.subscription_id))?.serial_number).toBe(serial);
  });

  test('reactivates an ended subscription', async ({ unifiedApi, db }) => {
    // SETUP: force the subscription to 'ended' directly in the database
    await setSubscriptionStatus(db.hub, subscription.subscription_id, 'ended');

    // ACTION: PUT /subscriptions/{id} { action: 'reactivate' }
    const response = await unifiedApi.subscriptions.reactivate(subscription.subscription_id);

    // CHECK: API message, and the status is 'active' again in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Reactivated' });
    expect((await findSubscription(db.hub, subscription.subscription_id))?.status).toBe('active');
  });

  // One test definition, run twice: autoRenew = true, then false (were 2 Cypress tests)
  for (const autoRenew of [true, false]) {
    test(`turns auto_renew ${autoRenew ? 'on' : 'off'}`, async ({ unifiedApi, db }) => {
      // ACTION: PUT /subscriptions/{id} { action: 'auto_renew', auto_renew }
      const response = await unifiedApi.subscriptions.setAutoRenew(subscription.subscription_id, autoRenew);

      // CHECK: API message, and the database flag matches
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
      expect((await findSubscription(db.hub, subscription.subscription_id))?.auto_renew).toBe(autoRenew);
    });
  }
});
