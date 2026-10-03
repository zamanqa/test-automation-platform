import type { Database } from '@db/connection';

/** Queries on customer_payment_methods (the saved cards / accounts of a customer, one row per order). */

export type PaymentMethodRow = { id: string; order_id: string | null; enabled: boolean; payment_method: string; last_4_digit: string | null };

/**
 * Newest payment method (id desc) of a customer for one order, or undefined.
 * An update can add rows for several orders of the customer, so always filter by the order too.
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

/** Id of the newest payment method of a customer for one order, or undefined. */
export async function getNewestPaymentMethodId(hub: Database, customerId: string, orderId: string) {
  const row = await findNewestPaymentMethod(hub, customerId, orderId);
  return row?.id;
}
