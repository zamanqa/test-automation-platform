import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/css-e2e/05-update-payment-method.spec.ts
//   tests/css-e2e/06-hub-update-payment-method.spec.ts
//   tests/hub-e2e/orders/order-payment-method.spec.ts

/** Queries on customer_payment_methods (the saved cards / accounts of a customer, one row per order). */

export type PaymentMethodRow = { id: string; order_id: string | null; enabled: boolean; payment_method: string; last_4_digit: string | null };

/**
 * Newest payment method (id desc) of a customer for one order, or undefined.
 * An update can add rows for several orders of the customer, so always filter by the order too (owner).
 */
export function findNewestPaymentMethod(hub: Database, customerId: string, orderId: string) {
  return hub.maybeOne<PaymentMethodRow>(
    `SELECT id, order_id, enabled, payment_method, last_4_digit
       FROM public.customer_payment_methods
      WHERE customer_id = $1 AND order_id = $2
      ORDER BY id DESC
      LIMIT 1`,
    [customerId, orderId],
  );
}
