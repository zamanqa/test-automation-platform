import { test, expect } from '@fixtures';
import { draftOrderPayload } from '@data/payloads/unified-api/draft-orders';
import { findDeletedDraftOrder, findDraftOrder } from '@db/queries/hub/draft-orders';
import { findSubscriptionVariant } from '@db/queries/hub/products';

// Unified API - /draft-orders (quotes).
// Needs: an active subscription product variant; existing draft orders.
// Changes data: creates a draft order; deletes (soft) the first listed one.
test.describe.configure({ mode: 'default' });

test.describe('Unified API - draft orders', () => {
  test('creates a draft order for a subscription product', async ({ unifiedApi, db }) => {
    // SETUP: newest active variant that can be sold as subscription
    const companyId = await unifiedApi.companyId();
    const variant = await findSubscriptionVariant(db.hub, companyId);

    // ACTION: draft order with that variant
    const response = await unifiedApi.draftOrders.create(draftOrderPayload(variant));

    // CHECK: 201 with a checkout link, and the draft is in the database
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('order_checkout_link');
    expect(await findDraftOrder(db.hub, companyId, body.id)).toBeDefined();
  });

  test('lists draft orders, fetches the first one and deletes it', async ({ unifiedApi, db }) => {
    // Step "list": GET /draft-orders → id of the first draft
    const id = await test.step('list', async () => {
      const response = await unifiedApi.draftOrders.list();
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.length).toBeGreaterThan(0);
      return data[0].id as string;
    });

    // Step "fetch by id": GET /draft-orders/{id} returns the same draft with a checkout link
    await test.step('fetch by id', async () => {
      const response = await unifiedApi.draftOrders.get(id);
      expect(response.status()).toBe(200);
      const order = await response.json();
      expect(order).toHaveProperty('id', id);
      expect(order).toHaveProperty('order_checkout_link');
    });

    // Step "delete": DELETE /draft-orders/{id}, then the row has deleted_at set (soft delete)
    await test.step('delete', async () => {
      const response = await unifiedApi.draftOrders.delete(id);
      expect(response.status()).toBe(200);
      expect(await findDeletedDraftOrder(db.hub, id)).toBeDefined();
    });
  });
});
