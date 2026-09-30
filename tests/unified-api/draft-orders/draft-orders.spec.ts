// test, expect        ← src/fixtures/index.ts
// draftOrderPayload   ← src/data/payloads/unified-api/draft-orders.ts (built from a product variant row)
// find...DraftOrder   ← src/db/queries/hub/draft-orders.ts
// findSubscriptionVariant ← src/db/queries/hub/products.ts
import { test, expect } from '@fixtures';
import { draftOrderPayload } from '@data/payloads/unified-api/draft-orders';
import { findDeletedDraftOrder, findDraftOrder } from '@db/queries/hub/draft-orders';
import { findSubscriptionVariant } from '@db/queries/hub/products';

/**
 * WHAT:   Unified Customer API — /draft-orders (quotes).
 * FROM:   unified-customer-api cypress/e2e/customer-api/07-draft-orders/draft-orders.cy.js (4 tests → 2).
 * NEEDS:  an active subscription product variant; existing draft orders.
 * CHANGES DATA: yes — creates a draft order; deletes (soft) the first listed one.
 */
test.describe.configure({ mode: 'default' });

test.describe('Unified API - draft orders', () => {
  test('creates a draft order for a subscription product', async ({ unifiedApi, db }) => {
    // SETUP: newest active variant that can be sold as subscription ← hub db
    const companyId = await unifiedApi.companyId();
    const variant = await findSubscriptionVariant(db.hub, companyId);

    // ACTION: POST /draft-orders — body uses the variant's product id, variant id, sku, price, name
    const response = await unifiedApi.draftOrders.create(draftOrderPayload(variant));

    // CHECK: 201 with a checkout link, and the draft (by `id` ← response) is in the database
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('order_checkout_link');
    expect(await findDraftOrder(db.hub, companyId, body.id)).toBeDefined();
  });

  // Was tests 2-4 in Cypress, which passed the id between tests through Cypress.env.
  test('lists draft orders, fetches the first one and deletes it', async ({ unifiedApi, db }) => {
    // Step "list": GET /draft-orders → id of the first draft ← API response
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
