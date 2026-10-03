import { faker } from '@faker-js/faker';
import { test, expect } from '@fixtures';
import { findRecurringPaymentOnDate, findUpcomingBillingDates } from '@db/queries/hub/recurring-payments';

// Unified API - /css/api/deliveries (read only).
// Needs: upcoming billing dates in recurring_payments.
// Changes data: no.
test.describe('Unified API - deliveries', () => {
  test('returns a list of deliveries', async ({ unifiedApi }) => {
    // ACTION: GET /css/api/deliveries (no company id in this URL)
    const response = await unifiedApi.deliveries.list();

    // CHECK: this endpoint returns a plain list
    expect(response.status()).toBe(200);
    expect((await response.json()).length).toBeGreaterThan(0);
  });

  test('returns the deliveries of an upcoming shipping date', async ({ unifiedApi, db }) => {
    // SETUP: up to 5 upcoming billing dates (= shipping dates)
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
