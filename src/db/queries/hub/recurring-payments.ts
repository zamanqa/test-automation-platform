import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/customer-api/css/css.spec.ts
//   tests/customer-api/deliveries/deliveries.spec.ts
//   tests/css-e2e/01-css-login.spec.ts
//   tests/customer-api/recurring-payments/recurring-payments.spec.ts
//   tests/hub-e2e/cron/cron.spec.ts
//   tests/hub-e2e/orders/order-detail.spec.ts
//   tests/hub-e2e/subscriptions/subscription-recurring-payments.spec.ts
//   tests/unified-api/css/css.spec.ts
//   tests/unified-api/deliveries/deliveries.spec.ts
//   tests/unified-api/recurring-payments/recurring-payments.spec.ts

/** Queries on recurring_payments. */

/** Up to `limit` upcoming billing (= shipping) dates, as YYYY-MM-DD. */
export async function findUpcomingBillingDates(hub: Database, companyId: string, limit = 5): Promise<string[]> {
  const rows = await hub.query<{ shipping_date: string }>(
    `SELECT DISTINCT TO_CHAR(billing_date, 'YYYY-MM-DD') AS shipping_date
       FROM public.recurring_payments
      WHERE company_id = $1
        AND enabled = true
        AND deleted_at IS NULL
        AND billing_date IS NOT NULL
        AND billing_date >= CURRENT_DATE
      ORDER BY shipping_date ASC
      LIMIT $2`,
    [companyId, limit],
  );
  return rows.map((r) => r.shipping_date);
}

/** An enabled recurring payment billed on `date` (YYYY-MM-DD), or undefined. */
export function findRecurringPaymentOnDate(hub: Database, companyId: string, date: string) {
  return hub.maybeOne<{ id: string; subscription_id: string }>(
    `SELECT id, subscription_id
       FROM public.recurring_payments
      WHERE company_id = $1
        AND TO_CHAR(billing_date, 'YYYY-MM-DD') = $2
        AND enabled = true
        AND deleted_at IS NULL
      LIMIT 1`,
    [companyId, date],
  );
}

/** Newest enabled, not-deleted recurring payment of the company. Throws if none. */
export function findLatestEnabledRecurringPayment(hub: Database, companyId: string) {
  return hub.one<{ id: string; subscription_id: string; status: string }>(
    `SELECT id, subscription_id, status
       FROM public.recurring_payments
      WHERE company_id = $1 AND deleted_at IS NULL AND enabled = true
      ORDER BY created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Recurring payment by numeric id, or undefined. */
export function findRecurringPayment(hub: Database, id: string | number) {
  return hub.maybeOne<{ id: string; subscription_id: string; status: string }>(
    'SELECT id, subscription_id, status FROM public.recurring_payments WHERE id = $1',
    [id],
  );
}

/** Open (chargeable) recurring payments of a subscription, by the subscription's numeric id. */
export async function countRecurringPaymentsOf(hub: Database, subscriptionPk: string | number): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments
      WHERE subscription_id = $1
        AND deleted_at IS NULL AND invoice_id IS NULL AND cumulated_invoice_id IS NULL
        AND payment_settled = false AND enabled = true AND failed = false`,
    [subscriptionPk],
  );
  return Number(row.count);
}

/** Columns the hub UI tests check on a recurring payment. amount is text like '20.0000'. */
export type RecurringPaymentRow = { id: string; deleted_at: string | null; payment_settled: boolean; invoice_id: string | null; amount: string };

/** Recurring payment by id with deleted_at / payment_settled / invoice_id / amount, or undefined. */
export function findRecurringPaymentRow(hub: Database, id: string | number) {
  return hub.maybeOne<RecurringPaymentRow>(
    'SELECT id, deleted_at, payment_settled, invoice_id, amount FROM public.recurring_payments WHERE id = $1',
    [id],
  );
}

/** true / false = payment_settled of a recurring payment, or undefined if not found. */
export async function isPaymentSettled(hub: Database, id: string | number) {
  const row = await findRecurringPaymentRow(hub, id);
  return row?.payment_settled;
}

/** Invoice id of a recurring payment (null = no invoice yet), or undefined if not found. */
export async function getPaymentInvoiceId(hub: Database, id: string | number) {
  const row = await findRecurringPaymentRow(hub, id);
  return row?.invoice_id;
}

/** Amount of a recurring payment as text with 4 decimals ('20.0000'), or undefined. */
export async function getPaymentAmount(hub: Database, id: string | number) {
  const row = await findRecurringPaymentRow(hub, id);
  return row?.amount;
}

/** How many of the given recurring payments already have an invoice (or a cumulated invoice). */
export async function countInvoicedPayments(hub: Database, ids: (string | number)[]): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments
      WHERE id = ANY($1) AND (invoice_id IS NOT NULL OR cumulated_invoice_id IS NOT NULL)`,
    [ids.map(String)],
  );
  return Number(row.count);
}

/** Sets payment_settled directly in the database (test setup). */
export function setRecurringPaymentSettled(hub: Database, id: string | number, settled = true) {
  return hub.query('UPDATE public.recurring_payments SET payment_settled = $2 WHERE id = $1', [id, settled]);
}

/** Open recurring payments of a subscription, by its subscription_id (text). */
export async function countOpenRecurringPayments(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.one<{ rp_count: string }>(
    `SELECT COUNT(r.id) AS rp_count
       FROM subscriptions s
       LEFT JOIN recurring_payments r ON r.subscription_id = s.id AND r.company_id = s.company_id
      WHERE s.subscription_id = $1
        AND r.enabled = true AND r.deleted_at IS NULL AND r.payment_settled = false AND r.invoice_id IS NULL`,
    [subscriptionId],
  );
  return Number(row.rp_count);
}

/**
 * An active normal checkout subscription with at least 4 open recurring payments,
 * and the ids of its first four. Takes the second match (OFFSET 1), as the Cypress query did.
 */
export function findSubscriptionWithFourOpenPayments(hub: Database, companyId: string) {
  return hub.one<{ subscription_id: string; rp1: string; rp2: string; rp3: string; rp4: string }>(
    `WITH open_rps AS (
       SELECT s.subscription_id, r.id,
              ROW_NUMBER() OVER (PARTITION BY s.subscription_id ORDER BY r.id ASC) AS rn
         FROM subscriptions s
         LEFT JOIN orders o ON o.order_id = s.order_id AND o.company_id = s.company_id
         LEFT JOIN recurring_payments r ON r.subscription_id = s.id AND r.company_id = s.company_id
        WHERE o.company_id = $1
          AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
          AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
          AND o.status IN ('open', 'fulfilled')
          AND o.origin = 'checkout'
          AND s.subscription_type = 'normal'
          AND s.status = 'active'
          AND r.enabled = true AND r.deleted_at IS NULL AND r.payment_settled = false AND r.invoice_id IS NULL)
     SELECT subscription_id,
            MAX(CASE WHEN rn = 1 THEN id END) AS rp1,
            MAX(CASE WHEN rn = 2 THEN id END) AS rp2,
            MAX(CASE WHEN rn = 3 THEN id END) AS rp3,
            MAX(CASE WHEN rn = 4 THEN id END) AS rp4
       FROM open_rps
      WHERE rn <= 4
      GROUP BY subscription_id
     HAVING COUNT(id) >= 4
      LIMIT 1 OFFSET 1`,
    [companyId],
  );
}

/**
 * Latest active normal/consumable checkout subscription with at least 4 open recurring
 * payments, its company and its first four payment ids (cron test).
 */
export function findLatestSubscriptionWithFourOpenPayments(hub: Database, companyId: string) {
  return hub.one<{ subscription_id: string; company_id: string; rp1: string; rp2: string; rp3: string; rp4: string }>(
    `WITH open_rps AS (
       SELECT s.subscription_id, s.company_id, s.created_at, r.id,
              ROW_NUMBER() OVER (PARTITION BY s.subscription_id ORDER BY r.id ASC) AS rn
         FROM subscriptions s
         LEFT JOIN orders o ON o.order_id = s.order_id AND o.company_id = s.company_id
         LEFT JOIN recurring_payments r ON r.subscription_id = s.id AND r.company_id = s.company_id
        WHERE o.company_id = $1
          AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
          AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
          AND o.status IN ('open', 'fulfilled')
          AND o.origin = 'checkout'
          AND s.subscription_type IN ('normal', 'consumable')
          AND s.status = 'active'
          AND r.enabled = true AND r.deleted_at IS NULL AND r.payment_settled = false AND r.invoice_id IS NULL)
     SELECT subscription_id, MAX(company_id) AS company_id,
            MAX(CASE WHEN rn = 1 THEN id END) AS rp1,
            MAX(CASE WHEN rn = 2 THEN id END) AS rp2,
            MAX(CASE WHEN rn = 3 THEN id END) AS rp3,
            MAX(CASE WHEN rn = 4 THEN id END) AS rp4
       FROM open_rps
      WHERE rn <= 4
      GROUP BY subscription_id
     HAVING COUNT(id) >= 4
      ORDER BY MAX(created_at) DESC
      LIMIT 1`,
    [companyId],
  );
}

/** date: YYYY-MM-DD */
export function setBillingDate(hub: Database, id: string | number, date: string) {
  return hub.query('UPDATE public.recurring_payments SET billing_date = $2 WHERE id = $1', [id, `${date} 00:00:00.000`]);
}

/** Invoice (or cumulated invoice) ids of recurring payments, in id order. */
export function findPaymentInvoices(hub: Database, ids: (string | number)[]) {
  return hub.query<{ id: string; invoice_id: string | null; cumulated_invoice_id: string | null }>(
    'SELECT id, invoice_id, cumulated_invoice_id FROM public.recurring_payments WHERE id = ANY($1) ORDER BY id ASC',
    [ids.map(String)],
  );
}

/** First open (unsettled, not invoiced) delivery of an active consumable subscription. */
export function findOpenConsumableDelivery(hub: Database, companyId: string) {
  return hub.one<{ id: string; subscription_id: string }>(
    `SELECT DISTINCT ON (r.subscription_id) r.id, r.subscription_id
       FROM public.recurring_payments r
       JOIN public.subscriptions s ON r.subscription_id = s.id
      WHERE s.company_id = $1
        AND s.status = 'active'
        AND s.subscription_type = 'consumable'
        AND r.company_id = $1
        AND r.enabled = true
        AND r.deleted_at IS NULL
        AND r.payment_settled = false
        AND r.invoice_id IS NULL
      ORDER BY r.subscription_id, r.id ASC
      LIMIT 1`,
    [companyId],
  );
}

/** Ids of the first `limit` open recurring payments of a subscription (by subscription_id text), earliest billing date first. */
export async function findOpenRecurringPaymentIds(hub: Database, subscriptionId: string, limit: number): Promise<string[]> {
  const rows = await hub.query<{ id: string }>(
    `SELECT r.id
       FROM subscriptions s
       JOIN recurring_payments r ON r.subscription_id = s.id AND r.company_id = s.company_id
      WHERE s.subscription_id = $1
        AND r.enabled = true AND r.deleted_at IS NULL AND r.payment_settled = false AND r.invoice_id IS NULL
      ORDER BY r.billing_date ASC, r.id ASC
      LIMIT $2`,
    [subscriptionId, limit],
  );
  return rows.map((r) => String(r.id));
}
