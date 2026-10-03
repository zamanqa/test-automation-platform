import { test, expect } from '@fixtures';
import { draftOrderPayload } from '@data/payloads/customer-api/draft-orders';
import { findDeletedDraftOrder, findDraftOrderByDraftId } from '@db/queries/hub/draft-orders';
import { findSubscriptionVariant } from '@db/queries/hub/products';

// Customer API - /draft-orders (quotes).
// Needs: an active subscription variant; existing drafts.
// Changes data: creates a draft; deletes the first listed one.
// Known: the delete returns 404 when the first draft was already converted to an order.
test.describe.configure({ mode: 'default' });

test.describe('Customer API - draft orders', () => {
  test('creates a draft order for a subscription product', async ({ customerApi, db }) => {
    // SETUP: newest active subscription variant
    const variant = await findSubscriptionVariant(db.hub, customerApi.companyId);

    // ACTION: POST /draft-orders
    const response = await customerApi.draftOrders.create(draftOrderPayload(variant));

    // CHECK: 201 and a checkout link. Here `id` is the draft_id.
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('order_checkout_link');
    expect(await findDraftOrderByDraftId(db.hub, customerApi.companyId, body.id)).toBeDefined();
  });

  test('lists draft orders, fetches the first one and deletes it', async ({ customerApi, db }) => {
    // Step "list": GET /draft-orders → first id
    const id = await test.step('list', async () => {
      const response = await customerApi.draftOrders.list();
      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.length).toBeGreaterThan(0);
      return data[0].id as string;
    });

    // Step "fetch by id": GET /draft-orders/{id}
    await test.step('fetch by id', async () => {
      const response = await customerApi.draftOrders.get(id);
      expect(response.status()).toBe(200);
      const order = await response.json();
      expect(order).toHaveProperty('id', id);
      expect(order).toHaveProperty('order_checkout_link');
    });

    // Step "delete": DELETE /draft-orders/{id} → row gets deleted_at (soft delete)
    await test.step('delete', async () => {
      const response = await customerApi.draftOrders.delete(id);
      expect(response.status()).toBe(200);
      expect(await findDeletedDraftOrder(db.hub, id)).toBeDefined();
    });
  });
});
