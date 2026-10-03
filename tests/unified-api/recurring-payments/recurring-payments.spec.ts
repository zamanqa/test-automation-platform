import { test, expect } from '@fixtures';
import { findLatestEnabledRecurringPayment, findRecurringPayment } from '@db/queries/hub/recurring-payments';

// Unified API - /recurring-payments (read only).
// Needs: an enabled recurring payment.
// Changes data: no.
test.describe('Unified API - recurring payments', () => {
  test('returns a list of recurring payments', async ({ unifiedApi }) => {
    // ACTION: GET /recurring-payments
    const response = await unifiedApi.recurringPayments.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a recurring payment by id', async ({ unifiedApi, db }) => {
    // SETUP: newest enabled, not-deleted recurring payment
    const rp = await findLatestEnabledRecurringPayment(db.hub, await unifiedApi.companyId());

    // ACTION: GET /recurring-payments/{id}   (numeric id)
    const response = await unifiedApi.recurringPayments.get(rp.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findRecurringPayment(db.hub, rp.id)).toBeDefined();
  });
});
