import type { Database } from '@db/connection';

/** Queries for the extra hub customer tests (edit, address, data transfer, search, balance validation). */

export type CustomerValues = {
  uid: string;
  email: string;
  phone: string | null;
  external_customer_id: string | null;
  marketing_consent: boolean | null;
  city: string | null;
};

const COLUMNS = 'uid, email, phone, external_customer_id, marketing_consent, city';

/** Newest real (not qa_auto) customer that has an order, with the values the edit test changes, or undefined. */
export function findCustomerToEdit(hub: Database, companyId: string) {
  return hub.maybeOne<CustomerValues>(
    `SELECT ${COLUMNS} FROM public.customers c
      WHERE c.company_id = $1 AND c.email NOT LIKE 'qa_auto%' AND COALESCE(c.city, '') <> ''
        AND EXISTS (SELECT 1 FROM public.order_customers oc WHERE oc.customer_id = c.uid)
      ORDER BY c.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** One customer's edit values. Throws if none. */
export function findCustomerValues(hub: Database, uid: string) {
  return hub.one<CustomerValues>(`SELECT ${COLUMNS} FROM public.customers WHERE uid = $1`, [uid]);
}

/** Writes the edit values back (cleanup). */
export function setCustomerValues(hub: Database, values: CustomerValues) {
  return hub.query('UPDATE public.customers SET phone = $2, external_customer_id = $3, marketing_consent = $4, city = $5 WHERE uid = $1', [
    values.uid,
    values.phone,
    values.external_customer_id,
    values.marketing_consent,
    values.city,
  ]);
}

/** Real customer with 1-3 orders and at least one subscription (source of a data transfer), or undefined. */
export function findTransferSource(hub: Database, companyId: string) {
  return hub.maybeOne<{ uid: string; email: string }>(
    `SELECT c.uid, c.email FROM public.customers c
      WHERE c.company_id = $1 AND c.email NOT LIKE 'qa_auto%'
        AND (SELECT COUNT(*) FROM public.order_customers oc WHERE oc.customer_id = c.uid) BETWEEN 1 AND 3
        AND EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.customer_id = c.uid)
        AND (SELECT COUNT(*) FROM public.customers x WHERE x.company_id = c.company_id AND x.email = c.email) = 1
      ORDER BY c.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Real customer without orders, subscriptions or transactions (target of a data transfer), or undefined. */
export function findEmptyCustomer(hub: Database, companyId: string) {
  return hub.maybeOne<{ uid: string; email: string }>(
    `SELECT c.uid, c.email FROM public.customers c
      WHERE c.company_id = $1 AND c.email NOT LIKE 'qa_auto%' AND c.email LIKE '%@%'
        AND NOT EXISTS (SELECT 1 FROM public.order_customers oc WHERE oc.customer_id = c.uid)
        AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.customer_id = c.uid)
        AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.customer_id = c.uid)
        AND (SELECT COUNT(*) FROM public.customers x WHERE x.company_id = c.company_id AND x.email = c.email) = 1
      ORDER BY c.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of order customers and subscriptions of a customer. */
export async function countCustomerData(hub: Database, uid: string) {
  const row = await hub.one<{ orders: string; subscriptions: string }>(
    `SELECT (SELECT COUNT(*) FROM public.order_customers WHERE customer_id = $1) AS orders,
            (SELECT COUNT(*) FROM public.subscriptions WHERE customer_id = $1) AS subscriptions`,
    [uid],
  );
  return { orders: Number(row.orders), subscriptions: Number(row.subscriptions) };
}

/** Number of orders of a customer (for expect.poll). */
export async function countCustomerOrders(hub: Database, uid: string): Promise<number> {
  return (await countCustomerData(hub, uid)).orders;
}

/** Number of customers of the company with exactly this email (any case). */
export async function countCustomersWithEmail(hub: Database, companyId: string, email: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.customers WHERE company_id = $1 AND email ILIKE $2', [companyId, email]);
  return Number(row.count);
}

/** Remaining account balance of a customer (0 when none). */
export async function getAccountBalance(hub: Database, uid: string): Promise<number> {
  const row = await hub.maybeOne<{ amount: string | null }>(
    'SELECT remaining_amount AS amount FROM public.customer_account WHERE referrer_customer_id = $1 LIMIT 1',
    [uid],
  );
  return Number(row?.amount ?? 0);
}

/** Newest real (not qa_auto) customer with 2 to 10 subscriptions, or undefined. */
export function findCustomerWithSubscriptions(hub: Database, companyId: string) {
  return hub.maybeOne<{ uid: string; email: string }>(
    `SELECT c.uid, c.email FROM public.customers c
      WHERE c.company_id = $1 AND c.email NOT LIKE 'qa_auto%'
        AND (SELECT COUNT(*) FROM public.subscriptions s WHERE s.customer_id = c.uid) BETWEEN 2 AND 10
      ORDER BY c.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Rows the customer page sections should show: orders, subscriptions (once per order item), payments (distinct transaction ids), assets (latest row per serial). */
export async function countCustomerSections(hub: Database, uid: string) {
  const row = await hub.one<{ orders: string; subscriptions: string; payments: string; assets: string }>(
    `SELECT (SELECT COUNT(*) FROM public.orders o JOIN public.order_customers oc ON oc.id = o.order_customer_id WHERE oc.customer_id = $1) AS orders,
            (SELECT COUNT(*) FROM public.subscriptions s LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
              WHERE s.customer_id = $1) AS subscriptions,
            (SELECT COUNT(DISTINCT transaction_id) FROM public.transactions WHERE customer_id = $1) AS payments,
            (SELECT COUNT(*) FROM public.product_trackings pt JOIN public.distinct_product_trackings_view v ON v.id = pt.id
              WHERE pt.customer_id = $1) AS assets`,
    [uid],
  );
  return { orders: Number(row.orders), subscriptions: Number(row.subscriptions), payments: Number(row.payments), assets: Number(row.assets) };
}
