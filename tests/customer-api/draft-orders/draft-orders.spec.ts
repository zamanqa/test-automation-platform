// test, expect          ← src/fixtures/index.ts
// draftOrderPayload     ← src/data/payloads/customer-api/draft-orders.ts (unified body with raw db types)
// find...DraftOrder...  ← src/db/queries/hub/draft-orders.ts
// findSubscriptionVariant ← src/db/queries/hub/products.ts
import { test, expect } from '@fixtures';
import { draftOrderPayload } from '@data/payloads/customer-api/draft-orders';
import { findDeletedDraftOrder, findDraftOrderByDraftId } from '@db/queries/hub/draft-orders';
import { findSubscriptionVariant } from '@db/queries/hub/products';

/**
 * WHAT:   OLD Customer API — /draft-orders (quotes).
 * FROM:   cus-api cypress/e2e/customer-api/07-draft-orders/draft-orders.cy.js (4 tests → 2).
 * NEEDS:  an active subscription variant; existing drafts.
 * CHANGES DATA: yes — creates a draft; deletes the first listed one.
 * Known: the delete returns 404 when the first draft was already converted to an order.
 */
test.describe.configure({ mode: 'default' });

test.describe('Customer API - draft orders', () => {
  test('creates a draft order for a subscription product', async ({ customerApi, db }) => {
    // SETUP: newest active subscription variant ← hub db (companyId ← .env)
    const variant = await findSubscriptionVariant(db.hub, customerApi.companyId);

    // ACTION: POST /draft-orders
    const response = await customerApi.draftOrders.create(draftOrderPayload(variant));

    // CHECK: 201 + checkout link; this API returns the draft_id as `id`, so look up by draft_id
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('order_checkout_link');
    expect(await findDraftOrderByDraftId(db.hub, customerApi.companyId, body.id)).toBeDefined();
  });

  // Was tests 2-4 in Cypress, which passed the id between tests through Cypress.env.
  test('lists draft orders, fetches the first one and deletes it', async ({ customerApi, db }) => {
    // Step "list": GET /draft-orders → first id ← API response
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
