import { testName } from '@data/random';

// USED BY (files that import this one):
//   tests/customer-api/retailers/retailers.spec.ts
//   tests/unified-api/retailers/retailers.spec.ts

/** Request bodies for /retailers. Same for both APIs. Values from unified-customer-api retailers.cy.js. */

const address = { street: 'Hansaallee 139', postal_code: '60320', city: 'Frankfurt', country: 'Germany', alpha2: 'DE' };

/** POST /retailers body: unique name (qa_auto_ prefix) and location_id "retailer-<timestamp>". */
export function createRetailerPayload() {
  const suffix = Date.now();
  return {
    name: testName(`retailer_${suffix}`),
    password: 'password',
    enabled: true,
    location_id: `retailer-${suffix}`,
    address: { ...address, company: 'Circuly Test' },
  };
}

/** PUT /retailers/{id} body: renames it to 'Updated Retailer' (the test checks this name). */
export function updateRetailerPayload() {
  return {
    name: 'Updated Retailer',
    password: 'password',
    enabled: true,
    address: { ...address, company: 'Circuly Updated' },
  };
}
