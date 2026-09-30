// test, expect  ← src/fixtures/index.ts
// find...       ← src/db/queries/hub/recurring-payments.ts
import { test, expect } from '@fixtures';
import { findLatestEnabledRecurringPayment, findRecurringPayment } from '@db/queries/hub/recurring-payments';

/**
 * WHAT:   Unified Customer API — /recurring-payments (read only).
 * FROM:   unified-customer-api cypress/e2e/customer-api/09-recurring-payments/recurring-payments.cy.js (2 tests).
 * NEEDS:  an enabled recurring payment.   CHANGES DATA: no.
 */
test.describe('Unified API - recurring payments', () => {
  test('returns a list of recurring payments', async ({ unifiedApi }) => {
    // ACTION: GET /recurring-payments
    const response = await unifiedApi.recurringPayments.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a recurring payment by id', async ({ unifiedApi, db }) => {
    // SETUP: newest enabled, not-deleted recurring payment ← hub db
    const rp = await findLatestEnabledRecurringPayment(db.hub, await unifiedApi.companyId());

    // ACTION: GET /recurring-payments/{id}   (numeric id)
    const response = await unifiedApi.recurringPayments.get(rp.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findRecurringPayment(db.hub, rp.id)).toBeDefined();
  });
});
