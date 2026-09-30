// test, expect                 ← src/fixtures/index.ts
// create/updateRetailerPayload ← src/data/payloads/shared/retailers.ts
// find...Retailer...           ← src/db/queries/hub/retailers.ts
import { test, expect } from '@fixtures';
import { createRetailerPayload, updateRetailerPayload } from '@data/payloads/shared/retailers';
import { findLatestRetailer, findRetailer, findRetailerByLocation } from '@db/queries/hub/retailers';

/**
 * WHAT:   OLD Customer API — /retailers.
 * FROM:   cus-api cypress/e2e/customer-api/12-retailers/retailers.cy.js (4 tests → 3).
 * CHANGES DATA: yes — creates and updates a retailer.
 */
test.describe('Customer API - retailers', () => {
  test('returns a list of retailers', async ({ customerApi }) => {
    // ACTION: GET /retailers
    const response = await customerApi.retailers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a retailer by location id', async ({ customerApi, db }) => {
    // SETUP: newest retailer ← hub db
    const retailer = await findLatestRetailer(db.hub, customerApi.companyId);

    // ACTION: GET /retailers/{location_id}
    const response = await customerApi.retailers.byLocation(retailer.location_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('location_id', retailer.location_id);
    expect(await findRetailerByLocation(db.hub, customerApi.companyId, retailer.location_id)).toBeDefined();
  });

  // Was tests 3-4 in Cypress, which passed the new id between tests through Cypress.env.
  test('creates a retailer and updates it', async ({ customerApi, db }) => {
    // Step "create": POST /retailers → new id ← API response
    const retailerId = await test.step('create', async () => {
      const response = await customerApi.retailers.create(createRetailerPayload());
      expect([200, 201]).toContain(response.status());
      const { id } = await response.json();
      expect(id).toBeTruthy();
      expect(await findRetailer(db.hub, customerApi.companyId, id)).toBeDefined();
      return id as string;
    });

    // Step "update": PUT /retailers/{id}
    await test.step('update', async () => {
      const response = await customerApi.retailers.update(retailerId, updateRetailerPayload());
      expect(response.status()).toBe(200);
      expect((await response.json()).name).toBe('Updated Retailer');
      expect(await findRetailer(db.hub, customerApi.companyId, retailerId)).toBeDefined();
    });
  });
});
