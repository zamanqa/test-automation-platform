import { faker } from '@faker-js/faker';
import { test, expect } from '@fixtures';
import { findRecurringPaymentOnDate, findUpcomingBillingDates } from '@db/queries/hub/recurring-payments';

// Customer API - /deliveries (read only).
// Needs: upcoming billing dates.
// Changes data: no.
test.describe('Customer API - deliveries', () => {
  test('returns a list of deliveries', async ({ customerApi }) => {
    // ACTION: GET /deliveries
    const response = await customerApi.deliveries.list();

    // CHECK: a plain list, not empty
    expect(response.status()).toBe(200);
    expect((await response.json()).length).toBeGreaterThan(0);
  });

  test('returns the deliveries of an upcoming shipping date', async ({ customerApi, db }) => {
    // SETUP: up to 5 upcoming billing dates
    const dates = await findUpcomingBillingDates(db.hub, customerApi.companyId);
    expect(dates.length).toBeGreaterThan(0);
    const date = faker.helpers.arrayElement(dates);

    // ACTION: GET /deliveries/{date}
    const response = await customerApi.deliveries.onDate(date);

    // CHECK: API answers for that date, and the database has a recurring payment on it
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('shipping_date');
    expect(await findRecurringPaymentOnDate(db.hub, customerApi.companyId, date)).toBeDefined();
  });
});
