import { test, expect } from '@fixtures';
import { oneTimePaymentPayload } from '@data/payloads/shared/payments';
import { findOrderEligibleForOneTimePayment } from '@db/queries/hub/orders';
import { findLatestOneTimePayment } from '@db/queries/hub/transactions';

// Unified API - POST /one-time-payments.
// Needs: an open Stripe/visa order that already has a transaction - else skipped.
// Changes data: creates a 20.00 one-time payment invoice on that order.
test.describe('Unified API - payments', () => {
  test('issues a one-time payment and creates its invoice', async ({ unifiedApi, db }) => {
    // SETUP: pick an order that can take a one-time payment
    const order = await findOrderEligibleForOneTimePayment(db.hub, await unifiedApi.companyId());
    test.skip(!order, 'No open Stripe/visa order with a transaction in the database');

    // ACTION: POST /one-time-payments with 2 product lines for that order
    const response = await unifiedApi.payments.createOneTimePayment(oneTimePaymentPayload(order!.order_id));

    // CHECK: 201 + message, and a 'one time payment' transaction exists in the database
    expect(response.status()).toBe(201);
    expect((await response.json()).message).toBe('Invoice is created and sent successfully!');
    expect(await findLatestOneTimePayment(db.hub, order!.order_id)).toBeDefined();
  });
});
