// faker         = random helpers (pick a random date from a list)
// test, expect  ← src/fixtures/index.ts
// find...       ← src/db/queries/hub/recurring-payments.ts (a delivery = a recurring payment's billing date)
import { faker } from '@faker-js/faker';
import { test, expect } from '@fixtures';
import { findRecurringPaymentOnDate, findUpcomingBillingDates } from '@db/queries/hub/recurring-payments';

/**
 * WHAT:   Unified Customer API — /css/api/deliveries (read only).
 * FROM:   unified-customer-api cypress/e2e/customer-api/06-deliveries/deliveries.cy.js (2 tests).
 * NEEDS:  upcoming billing dates in recurring_payments.   CHANGES DATA: no.
 */
test.describe('Unified API - deliveries', () => {
  test('returns a list of deliveries', async ({ unifiedApi }) => {
    // ACTION: GET /css/api/deliveries (CSS URL pattern: no company id in the path)
    const response = await unifiedApi.deliveries.list();

    // CHECK: this endpoint returns a bare array (not { data: [...] })
    expect(response.status()).toBe(200);
    expect((await response.json()).length).toBeGreaterThan(0);
  });

  test('returns the deliveries of an upcoming shipping date', async ({ unifiedApi, db }) => {
    // SETUP: up to 5 upcoming billing dates (= shipping dates) ← hub db; pick one at random
    const companyId = await unifiedApi.companyId();
    const dates = await findUpcomingBillingDates(db.hub, companyId);
    expect(dates.length).toBeGreaterThan(0);
    const date = faker.helpers.arrayElement(dates); // e.g. "2026-10-01"

    // ACTION: GET /css/api/deliveries/{date}
    const response = await unifiedApi.deliveries.onDate(date);

    // CHECK: response has shipping_date, and the database has a recurring payment on that date
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('shipping_date');
    expect(await findRecurringPaymentOnDate(db.hub, companyId, date)).toBeDefined();
  });
});
