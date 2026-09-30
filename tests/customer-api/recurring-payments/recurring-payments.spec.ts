// test, expect ← src/fixtures/index.ts
// find...      ← src/db/queries/hub/recurring-payments.ts
import { test, expect } from '@fixtures';
import { findLatestEnabledRecurringPayment, findRecurringPayment } from '@db/queries/hub/recurring-payments';

/**
 * WHAT:   OLD Customer API — /recurring-payments (read only).
 * FROM:   cus-api cypress/e2e/customer-api/09-recurring-payments/recurring-payments.cy.js (2 tests).
 * CHANGES DATA: no.
 */
test.describe('Customer API - recurring payments', () => {
  test('returns a list of recurring payments', async ({ customerApi }) => {
    // ACTION: GET /recurring-payments
    const response = await customerApi.recurringPayments.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a recurring payment by id', async ({ customerApi, db }) => {
    // SETUP: newest enabled recurring payment ← hub db (companyId ← .env)
    const rp = await findLatestEnabledRecurringPayment(db.hub, customerApi.companyId);

    // ACTION: GET /recurring-payments/{id}
    const response = await customerApi.recurringPayments.get(rp.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findRecurringPayment(db.hub, rp.id)).toBeDefined();
  });
});
