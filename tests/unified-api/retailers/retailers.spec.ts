// test, expect                 ← src/fixtures/index.ts
// create/updateRetailerPayload ← src/data/payloads/shared/retailers.ts (same for both APIs)
// find...Retailer...           ← src/db/queries/hub/retailers.ts
import { test, expect } from '@fixtures';
import { createRetailerPayload, updateRetailerPayload } from '@data/payloads/shared/retailers';
import { findLatestRetailer, findRetailer, findRetailerByLocation } from '@db/queries/hub/retailers';

/**
 * WHAT:   Unified Customer API — /retailers.
 * FROM:   unified-customer-api cypress/e2e/customer-api/12-retailers/retailers.cy.js (4 tests → 3).
 * NEEDS:  at least one retailer.   CHANGES DATA: yes — creates and updates a retailer.
 */
test.describe('Unified API - retailers', () => {
  test('returns a list of retailers', async ({ unifiedApi }) => {
    // ACTION: GET /retailers
    const response = await unifiedApi.retailers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a retailer by location id', async ({ unifiedApi, db }) => {
    // SETUP: newest retailer ← hub db
    const companyId = await unifiedApi.companyId();
    const retailer = await findLatestRetailer(db.hub, companyId);

    // ACTION: GET /retailers/{location_id}
    const response = await unifiedApi.retailers.byLocation(retailer.location_id);

    // CHECK: same location_id back, and it exists in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('location_id', retailer.location_id);
    expect(await findRetailerByLocation(db.hub, companyId, retailer.location_id)).toBeDefined();
  });

  // Was tests 3-4 in Cypress, which passed the new id between tests through Cypress.env.
  test('creates a retailer and updates it', async ({ unifiedApi, db }) => {
    const companyId = await unifiedApi.companyId();

    // Step "create": POST /retailers (name gets the qa_auto_ prefix) → new id ← API response
    const retailerId = await test.step('create', async () => {
      const response = await unifiedApi.retailers.create(createRetailerPayload());
      expect([200, 201]).toContain(response.status());
      const { id } = await response.json();
      expect(id).toBeTruthy();
      expect(await findRetailer(db.hub, companyId, id)).toBeDefined(); // db column retailer_id = API `id`
      return id as string;
    });

    // Step "update": PUT /retailers/{id} → name must be 'Updated Retailer'
    await test.step('update', async () => {
      const response = await unifiedApi.retailers.update(retailerId, updateRetailerPayload());
      expect(response.status()).toBe(200);
      expect((await response.json()).name).toBe('Updated Retailer');
      expect(await findRetailer(db.hub, companyId, retailerId)).toBeDefined();
    });
  });
});
