import { test, expect } from '@fixtures';
import { oneTimePaymentPayload } from '@data/payloads/shared/payments';
import { findOrderEligibleForOneTimePayment } from '@db/queries/hub/orders';
import { findLatestOneTimePayment } from '@db/queries/hub/transactions';

// Customer API - POST /payments/one-time-payments.
// Needs: an open Stripe/visa order that has a transaction (else skipped).
// Changes data: creates a 20.00 one-time payment invoice.
test.describe('Customer API - payments', () => {
  test('issues a one-time payment and creates its invoice', async ({ customerApi, db }) => {
    // SETUP: an order that can take a one-time payment
    const order = await findOrderEligibleForOneTimePayment(db.hub, customerApi.companyId);
    test.skip(!order, 'No open Stripe/visa order with a transaction in the database');

    // ACTION: POST /payments/one-time-payments
    const response = await customerApi.payments.createOneTimePayment(oneTimePaymentPayload(order!.order_id));

    // CHECK: 201 + message, and a 'one time payment' transaction exists
    expect(response.status()).toBe(201);
    expect((await response.json()).message).toBe('Invoice is created and sent successfully!');
    expect(await findLatestOneTimePayment(db.hub, order!.order_id)).toBeDefined();
  });
});
