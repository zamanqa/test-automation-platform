import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/checkout-e2e/adyen.spec.ts
//   tests/checkout-e2e/braintree.spec.ts
//   tests/checkout-e2e/mollie.spec.ts
//   tests/checkout-e2e/stripe.spec.ts
//   tests/customer-api/orders/orders.spec.ts
//   tests/hub-e2e/orders/order-payment-method.spec.ts
//   tests/customer-api/payments/payments.spec.ts
//   tests/hub-e2e/customers/customers.spec.ts
//   tests/hub-e2e/orders/create-order.spec.ts
//   tests/hub-e2e/orders/order-detail.spec.ts
//   tests/hub-e2e/orders/order-list.spec.ts
//   tests/hub-e2e/orders/order-workflow.spec.ts
//   tests/unified-api/orders/orders.spec.ts
//   tests/unified-api/payments/payments.spec.ts

/**
 * Queries on the hub `orders` / `order_items` tables. Shared by every suite.
 *
 * Pattern shared by every file in src/db/queries/:
 *   - plain functions (no class), grouped by table
 *   - first parameter = which database (a `Database` from the db fixture, e.g. db.hub)
 *   - return typed rows:  one() = must exist (throws), maybeOne() = row or undefined,
 *     query() = all rows. The TEST decides what to assert.
 *   - used by tests like:  const order = await findOrder(db.hub, orderId);
 *
 * Reading the SQL:
 *   hub.one<OrderRow>(`SELECT ... WHERE o.company_id = $1`, [companyId])
 *     $1, $2 ...   = placeholders; the database driver fills them with the values in the
 *                    array after the SQL (1st value → $1). Safe against quotes / SQL injection.
 *     <OrderRow>   = the TypeScript shape of the returned row (defined below), so the
 *                    editor can autocomplete order.order_id, order.status ...
 *     ORDER_COLUMNS = the column list reused by several queries (defined below).
 */

export type OrderRow = {
  order_id: string;
  company_id: string;
  status: string;
  payment_status: string;
  payment_provider: string;
  payment_method_token: string;
  origin: string;
  transaction_id: string | null;
};

const ORDER_COLUMNS = `
  o.order_id, o.company_id, o.status, o.payment_status, o.payment_provider,
  o.payment_method_token, o.origin, o.transaction_id`;

/** Latest open checkout order paid by visa that has no subscription yet. */
export function findOpenCheckoutOrderWithoutSubscription(hub: Database, companyId: string) {
  return hub.one<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
       LEFT JOIN subscriptions s ON s.order_id = o.order_id AND s.company_id = o.company_id
      WHERE o.company_id = $1
        AND s.order_id IS NULL
        AND o.payment_method_token = 'visa'
        AND o.status = 'open'
        AND o.origin = 'checkout'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Newest order of the company. Throws if none. */
export function findLatestOrder(hub: Database, companyId: string) {
  return hub.one<OrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.company_id = $1 ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Latest open Stripe/visa order that already has a transaction — can take a one-time payment. */
export function findOrderEligibleForOneTimePayment(hub: Database, companyId: string) {
  return hub.maybeOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
      WHERE o.payment_provider = 'stripe'
        AND o.payment_method_token = 'visa'
        AND o.status = 'open'
        AND o.transaction_id IS NOT NULL
        AND o.company_id = $1
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest open Stripe order created in the hub (cms) that still needs payment. */
export function findChargeableCmsOrder(hub: Database, companyId: string) {
  return hub.one<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
      WHERE o.company_id = $1
        AND o.payment_status = 'payment_required'
        AND o.status = 'open'
        AND o.payment_provider = 'stripe'
        AND o.origin = 'cms'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest pending order whose transaction is an initial invoice — can get its invoice generated. */
export function findInvoiceableOrder(hub: Database, companyId: string) {
  return hub.one<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
       JOIN transactions t ON t.order_id = o.order_id AND t.company_id = o.company_id
      WHERE o.company_id = $1
        AND o.payment_status = 'pending'
        AND o.transaction_id IS NOT NULL
        AND t.initial_invoice = true
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/**
 * Latest open/fulfilled checkout order paid by card or PayPal that has no subscription
 * yet (hub tests: order detail, mark fulfilled).
 */
export function findCheckoutOrderWithoutSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
       LEFT JOIN subscriptions s ON o.order_id = s.order_id AND o.company_id = s.company_id
      WHERE o.company_id = $1
        AND s.order_id IS NULL
        AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
        AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
        AND o.status IN ('open', 'fulfilled')
        AND o.origin = 'checkout'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest hub-created (cms) order that is still waiting for its first payment. */
export function findCmsOrderAwaitingPayment(hub: Database, companyId: string) {
  return hub.one<OrderRow & { amount: string }>(
    `SELECT ${ORDER_COLUMNS}, o.amount
       FROM orders o
      WHERE o.company_id = $1
        AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
        AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
        AND o.status IN ('open', 'fulfilled')
        AND o.transaction_id IS NULL
        AND o.payment_status = 'payment_required'
        AND o.origin = 'cms'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Number of orders of the company (compared with the "of N" label in the hub list). */
export async function countOrders(hub: Database, companyId: string): Promise<number> {
  const row = await hub.one<{ total: string }>('SELECT COUNT(*) AS total FROM orders WHERE company_id = $1', [companyId]);
  return Number(row.total);
}

/** An order created in the hub UI (origin = cms). */
export function findCmsOrder(hub: Database, orderId: string) {
  return hub.maybeOne<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.order_id = $1 AND o.origin = 'cms'`, [orderId]);
}

/** Order by order_id, or undefined. Typical check: expect(await findOrder(db.hub, id)).toBeDefined(). */
export function findOrder(hub: Database, orderId: string) {
  return hub.maybeOne<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.order_id = $1`, [orderId]);
}

/** Just the status text of an order ('open', 'fulfilled', 'cancelled' ...), or undefined. */
export async function getOrderStatus(hub: Database, orderId: string): Promise<string | undefined> {
  const row = await hub.maybeOne<{ status: string }>('SELECT status FROM orders WHERE order_id = $1', [orderId]);
  return row?.status;
}

/** transaction_id of an order (null = not charged yet), or undefined if not found. */
export async function getOrderTransactionId(hub: Database, orderId: string) {
  const row = await hub.maybeOne<{ transaction_id: string | null }>('SELECT transaction_id FROM orders WHERE order_id = $1', [orderId]);
  return row?.transaction_id;
}

/**
 * Latest pay-by-invoice order that has no invoice yet — "Create invoice" can be used on it.
 * Filter from the owner (2026-09-28): offlinegateway + invoice + no transaction_id + payment_required,
 * plus: still open, and a row in `transactions` exists for it — without one the hub answers
 * 404 "No query results for model [Transaction]" (e.g. 'clone' orders made by "Edit order").
 */
export function findPayByInvoiceOrderWithoutInvoice(hub: Database, companyId: string) {
  return hub.maybeOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
      WHERE o.company_id = $1
        AND o.payment_provider IN ('offlinegateway')
        AND o.payment_method_token IN ('invoice')
        AND o.transaction_id IS NULL
        AND o.payment_status IN ('payment_required')
        AND o.status = 'open'
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.order_id = o.order_id AND t.company_id = o.company_id)
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest open, paid order — "Mark as fulfilled" is enabled on it (unpaid or fulfilled orders do not offer it). */
export function findOpenPaidOrder(hub: Database, companyId: string) {
  return hub.maybeOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
      WHERE o.company_id = $1 AND o.status = 'open' AND o.payment_status = 'paid'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest checkout order that already has at least one subscription (its Subscriptions tab shows rows), or undefined. */
export function findCheckoutOrderWithSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<OrderRow>(
    `SELECT ${ORDER_COLUMNS}
       FROM orders o
      WHERE o.company_id = $1
        AND o.origin = 'checkout'
        AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.order_id = o.order_id AND s.company_id = o.company_id)
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Tag of an order ('delivery', 'qa_auto_tag' ...), or undefined. */
export async function getOrderTag(hub: Database, orderId: string) {
  const row = await hub.maybeOne<{ tag: string | null }>('SELECT tag FROM orders WHERE order_id = $1', [orderId]);
  return row?.tag ?? undefined;
}

/** Sets the tag directly in the database (cleanup: put the old tag back). */
export function setOrderTag(hub: Database, orderId: string, tag: string | null) {
  return hub.query('UPDATE orders SET tag = $2 WHERE order_id = $1', [orderId, tag]);
}

/** Customer id (cus_...) of an order's customer, or undefined. */
export async function getOrderCustomerId(hub: Database, orderId: string) {
  // orders.order_customer_id → order_customers.id (the order's copy of the customer); its customer_id = cus_...
  const row = await hub.maybeOne<{ customer_id: string }>(
    `SELECT oc.customer_id
       FROM orders o
       JOIN order_customers oc ON oc.id = o.order_customer_id
      WHERE o.order_id = $1`,
    [orderId],
  );
  return row?.customer_id;
}

/** Number of subscriptions created for an order. */
export async function countSubscriptionsOfOrder(hub: Database, orderId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM subscriptions WHERE order_id = $1', [orderId]);
  return Number(row.count);
}

/** All order_items rows of an order (by order_id). */
export function findOrderItems(hub: Database, orderId: string) {
  return hub.query<{ id: string; sku: string; quantity: number }>(
    'SELECT id, sku, quantity FROM order_items WHERE order_id = $1 ORDER BY id ASC',
    [orderId],
  );
}

/** Number of items (order_items rows) of an order. */
export async function countOrderItems(hub: Database, orderId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM order_items WHERE order_id = $1', [orderId]);
  return Number(row.count);
}

/**
 * Newest checkout order that has no row in subscriptions yet (owner's rule for "Process open orders", 2026-09-29),
 * with its customer id (cus_...). Or undefined.
 */
export function findCheckoutOrderNotInSubscriptions(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string; customer_id: string }>(
    `SELECT o.order_id, oc.customer_id
       FROM orders o
       JOIN order_customers oc ON oc.id = o.order_customer_id
      WHERE o.company_id = $1
        AND o.origin = 'checkout'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.order_id = o.order_id AND s.company_id = o.company_id)
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/**
 * Newest checkout order (origin 'checkout') paid by Stripe card that has a customer — for "update payment method"
 * (tests/hub-e2e/orders/order-payment-method.spec.ts, owner: latest checkout order). Skips qa_auto order ids,
 * transaction ids and customer emails (owner rule). Returns order_id + customer_id (cus_…), or undefined.
 */
export function findLatestCheckoutCardOrder(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string; customer_id: string }>(
    `SELECT o.order_id, oc.customer_id
       FROM orders o
       JOIN order_customers oc ON oc.id = o.order_customer_id
       JOIN customers c ON c.uid = oc.customer_id
      WHERE o.company_id = $1
        AND o.origin = 'checkout'
        AND o.payment_provider = 'stripe'
        AND o.payment_method_token IN ('visa', 'mastercard', 'card')
        AND o.order_id NOT LIKE 'qa\_auto%'
        AND COALESCE(o.transaction_id, '') NOT LIKE 'qa\_auto%'
        AND COALESCE(c.email, '') NOT LIKE 'qa\_auto%'
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}
