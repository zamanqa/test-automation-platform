import type { Database } from '@db/connection';

// Counts for the hub list filter tests. Each count uses the same base as the hub API list
// (QueryService.buildFilterable<List>) plus the filters: "Is" / matches = ILIKE value (exact text, any case),
// contains = ILIKE %value%, greater = >, between = from 00:00 to `to` 23:59:59.
// The pick* functions choose filter values from real data (never qa_auto) so a count is never 0.

async function count(hub: Database, sql: string, params: unknown[]): Promise<number> {
  const row = await hub.one<{ count: string }>(sql, params);
  return Number(row.count);
}

const BETWEEN = (column: string, from: string, to: string) => `${column} >= ${from}::date AND ${column} <= ${to}::date + interval '23:59:59'`;

// ---------- orders ----------

/** Orders with this status, payment status and origin. */
export function countOrdersByStatusPaymentOrigin(hub: Database, companyId: string, status: string, paymentStatus: string, origin: string) {
  return count(
    hub,
    `SELECT COUNT(DISTINCT o.id) AS count FROM public.orders o
      WHERE o.company_id = $1 AND o.status ILIKE $2 AND o.payment_status ILIKE $3 AND o.origin ILIKE $4`,
    [companyId, status, paymentStatus, origin],
  );
}

/** Email (customer) and day of the newest consumable order that is not qa_auto, or undefined. */
export function pickConsumableOrder(hub: Database, companyId: string) {
  return hub.maybeOne<{ email: string; day: string }>(
    `SELECT oc.email, to_char(o.created_at, 'YYYY-MM-DD') AS day
       FROM public.orders o JOIN public.order_customers oc ON oc.id = o.order_customer_id
      WHERE o.company_id = $1 AND o.subscription_type = 'consumable' AND oc.email NOT LIKE 'qa_auto%' AND oc.email <> ''
      ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Orders whose customer email contains `email`, created between two days, with this subscription type. */
export function countOrdersByEmailDateType(hub: Database, companyId: string, email: string, from: string, to: string, type: string) {
  return count(
    hub,
    `SELECT COUNT(DISTINCT o.id) AS count FROM public.orders o
       LEFT JOIN public.order_customers oc ON oc.id = o.order_customer_id AND oc.company_id = o.company_id
      WHERE o.company_id = $1 AND oc.email ILIKE '%' || $2 || '%' AND ${BETWEEN('o.created_at', '$3', '$4')}
        AND o.subscription_type ILIKE $5`,
    [companyId, email, from, to, type],
  );
}

/** Most used voucher code on subscription order items of open or fulfilled orders, or undefined. */
export function pickOrderVoucherCode(hub: Database, companyId: string) {
  return hub.maybeOne<{ voucher_code: string }>(
    `SELECT oi.voucher_code FROM public.order_items oi JOIN public.orders o ON o.order_id = oi.order_id
      WHERE oi.company_id = $1 AND oi.subscription = true AND COALESCE(oi.voucher_code, '') <> ''
        AND oi.voucher_code NOT LIKE 'qa_auto%' AND o.status IN ('open', 'fulfilled')
      GROUP BY oi.voucher_code ORDER BY COUNT(*) DESC LIMIT 1`,
    [companyId],
  );
}

/** Orders with one of these statuses that have a subscription item with this voucher code. */
export function countOrdersByStatusesAndVoucher(hub: Database, companyId: string, statuses: string[], voucherCode: string) {
  return count(
    hub,
    `SELECT COUNT(DISTINCT o.id) AS count FROM public.orders o
      WHERE o.company_id = $1 AND o.status ILIKE ANY($2)
        AND EXISTS (SELECT 1 FROM public.order_items oi
                     WHERE oi.order_id = o.order_id AND oi.company_id = $1 AND oi.subscription = true AND oi.voucher_code ILIKE $3)`,
    [companyId, statuses, voucherCode],
  );
}

// ---------- subscriptions and returns (list joins order_items, so a subscription with 2 items counts twice) ----------

/** Subscriptions with this status, type and frequency. */
export function countSubscriptionsByStatusTypeFrequency(hub: Database, companyId: string, status: string, type: string, frequency: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.status ILIKE $2 AND s.subscription_type ILIKE $3 AND s.subscription_frequency ILIKE $4`,
    [companyId, status, type, frequency],
  );
}

/** End day of the newest auto-renewed 'pending return' subscription, or undefined. */
export function pickPendingReturnRenewed(hub: Database, companyId: string) {
  return hub.maybeOne<{ day: string }>(
    `SELECT to_char(subscription_end, 'YYYY-MM-DD') AS day FROM public.subscriptions
      WHERE company_id = $1 AND status = 'pending return' AND auto_renewed = true AND subscription_end IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Subscriptions with this status and auto_renewed value, ending between two days. */
export function countSubscriptionsByStatusRenewedEnd(hub: Database, companyId: string, status: string, autoRenewed: boolean, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.status ILIKE $2 AND s.auto_renewed = $3 AND ${BETWEEN('s.subscription_end', '$4', '$5')}`,
    [companyId, status, autoRenewed, from, to],
  );
}

/** Customer email and item SKU of the newest active subscription (not qa_auto), or undefined. */
export function pickSubscriptionEmailAndSku(hub: Database, companyId: string) {
  return hub.maybeOne<{ email: string; sku: string }>(
    `SELECT c.email, oi.sku FROM public.subscriptions s
       JOIN public.customers c ON c.uid = s.customer_id AND c.company_id = s.company_id
       JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.status = 'active' AND c.email NOT LIKE 'qa_auto%' AND COALESCE(oi.sku, '') <> ''
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Subscriptions whose customer email contains `email`, item SKU = `sku`, with one of these statuses. */
export function countSubscriptionsByEmailSkuStatuses(hub: Database, companyId: string, email: string, sku: string, statuses: string[]) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.customers c ON c.uid = s.customer_id AND c.company_id = $1
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND c.email ILIKE '%' || $2 || '%' AND oi.sku ILIKE $3 AND s.status ILIKE ANY($4)`,
    [companyId, email, sku, statuses],
  );
}

/** Serial number of the newest normal 'pending return' subscription (not qa_auto), or undefined. */
export function pickPendingReturnSerial(hub: Database, companyId: string) {
  return hub.maybeOne<{ serial_number: string }>(
    `SELECT serial_number FROM public.subscriptions
      WHERE company_id = $1 AND status = 'pending return' AND subscription_type = 'normal'
        AND COALESCE(serial_number, '') <> '' AND serial_number NOT LIKE 'qa_auto%'
      ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Returns list: normal/consumable subscriptions in active / pending return / pending replacement, plus the filters. */
export function countReturnsByStatusTypeSerial(hub: Database, companyId: string, status: string, type: string, serial: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.subscription_type IN ('consumable', 'normal')
        AND s.status IN ('active', 'pending return', 'pending replacement')
        AND s.status ILIKE $2 AND s.subscription_type ILIKE $3 AND s.serial_number ILIKE '%' || $4 || '%'`,
    [companyId, status, type, serial],
  );
}

/** Subscriptions with this status, type and frequency, created between two days. */
export function countSubscriptionsByStatusTypeFrequencyCreated(
  hub: Database,
  companyId: string,
  status: string,
  type: string,
  frequency: string,
  from: string,
  to: string,
) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.status ILIKE $2 AND s.subscription_type ILIKE $3 AND s.subscription_frequency ILIKE $4
        AND ${BETWEEN('s.created_at', '$5', '$6')}`,
    [companyId, status, type, frequency, from, to],
  );
}

// ---------- payments (transactions) ----------

/** Invoice type with the most failed transactions, and the day of its newest one, or undefined. */
export function pickFailedTransactionType(hub: Database, companyId: string) {
  return hub.maybeOne<{ invoice_type: string; day: string }>(
    `SELECT invoice_type, to_char(MAX(created_at), 'YYYY-MM-DD') AS day FROM public.transactions
      WHERE company_id = $1 AND status = 'failed' AND COALESCE(invoice_type, '') <> ''
      GROUP BY invoice_type ORDER BY COUNT(*) DESC LIMIT 1`,
    [companyId],
  );
}

/** Transactions with this status and invoice type, created between two days. */
export function countTransactionsByStatusTypeDate(hub: Database, companyId: string, status: string, invoiceType: string, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.transactions t
      WHERE t.company_id = $1 AND t.status ILIKE $2 AND t.invoice_type ILIKE $3 AND ${BETWEEN('t.created_at', '$4', '$5')}`,
    [companyId, status, invoiceType, from, to],
  );
}

/** Transactions whose provider contains `provider`, with this status and amount paid above `amount`. */
export function countTransactionsByProviderStatusAmount(hub: Database, companyId: string, provider: string, status: string, amount: number) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.transactions t
      WHERE t.company_id = $1 AND t.payment_service_provider ILIKE '%' || $2 || '%' AND t.status ILIKE $3 AND t.amount_paid > $4`,
    [companyId, provider, status, amount],
  );
}

// ---------- invoices ----------

/** Invoices of this type and paid value, created between two days. */
export function countInvoicesByTypePaidDate(hub: Database, companyId: string, type: string, paid: boolean, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.invoices i
      WHERE i.company_id = $1 AND i."type" ILIKE $2 AND i.paid = $3 AND ${BETWEEN('i.created_at', '$4', '$5')}`,
    [companyId, type, paid, from, to],
  );
}

/** Invoices whose transaction has this status and initial_invoice value, with amount above `amount`, created between two days. */
export function countInvoicesByPaymentStatusInitialAmount(
  hub: Database,
  companyId: string,
  paymentStatus: string,
  initialInvoice: boolean,
  amount: number,
  from: string,
  to: string,
) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.invoices i
      WHERE i.company_id = $1 AND i.amount > $4 AND ${BETWEEN('i.created_at', '$5', '$6')}
        AND EXISTS (SELECT 1 FROM public.transactions t JOIN public.customers c ON c.uid = t.customer_id
                     WHERE t.company_id = $1 AND t.transaction_id = i.transaction_id
                       AND t.status ILIKE $2 AND t.initial_invoice = $3)`,
    [companyId, paymentStatus, initialInvoice, amount, from, to],
  );
}

// ---------- recurring payments (list: enabled, not deleted) ----------

/** Billing day of the newest failed, unsettled enabled recurring payment, or undefined. */
export function pickFailedRecurringPayment(hub: Database, companyId: string) {
  return hub.maybeOne<{ day: string }>(
    `SELECT to_char(billing_date, 'YYYY-MM-DD') AS day FROM public.recurring_payments
      WHERE company_id = $1 AND enabled = true AND deleted_at IS NULL AND failed = true AND payment_settled = false
      ORDER BY billing_date DESC LIMIT 1`,
    [companyId],
  );
}

/** Recurring payments with these settled / failed values and a billing date between two days. */
export function countRecurringPaymentsBySettledFailedDate(hub: Database, companyId: string, settled: boolean, failed: boolean, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.recurring_payments rp
      WHERE rp.company_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL
        AND rp.payment_settled = $2 AND rp.failed = $3 AND ${BETWEEN('rp.billing_date', '$4', '$5')}`,
    [companyId, settled, failed, from, to],
  );
}

/** Subscription (text id) with the most settled stripe recurring payments, or undefined. */
export function pickSubscriptionWithSettledStripePayments(hub: Database, companyId: string) {
  return hub.maybeOne<{ subscription_id: string }>(
    `SELECT s.subscription_id FROM public.recurring_payments rp
       JOIN public.subscriptions s ON s.id = rp.subscription_id
       JOIN public.recurring_payments_with_status_view v ON v.id = rp.id
      WHERE rp.company_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL AND v.status = 'settled'
        AND rp.payment_system ILIKE 'stripe' AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%'
      GROUP BY s.subscription_id ORDER BY COUNT(*) DESC LIMIT 1`,
    [companyId],
  );
}

/** Recurring payments with this list status and payment system, of one subscription (text id). */
export function countRecurringPaymentsByStatusSystemSubscription(hub: Database, companyId: string, status: string, system: string, subscriptionId: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.recurring_payments rp
       JOIN public.subscriptions s ON s.id = rp.subscription_id
       LEFT JOIN public.recurring_payments_with_status_view v ON v.id = rp.id
      WHERE rp.company_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL
        AND v.status ILIKE $2 AND rp.payment_system ILIKE $3 AND s.subscription_id ILIKE $4`,
    [companyId, status, system, subscriptionId],
  );
}

// ---------- customers ----------

/** Customers created between two days with an account balance above `balance` (list joins customer_account). */
export function countCustomersByDateBalance(hub: Database, companyId: string, from: string, to: string, balance: number) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.customers c
       LEFT JOIN public.customer_account ca ON ca.referrer_customer_id = c.uid
      WHERE c.company_id = $1 AND ${BETWEEN('c.created_at', '$2', '$3')} AND ca.remaining_amount > $4`,
    [companyId, from, to, balance],
  );
}

/** Email domain part and day of the newest customer that is not qa_auto, or undefined. */
export function pickCustomerEmail(hub: Database, companyId: string) {
  return hub.maybeOne<{ email: string; day: string }>(
    `SELECT email, to_char(created_at, 'YYYY-MM-DD') AS day FROM public.customers
      WHERE company_id = $1 AND email NOT LIKE 'qa_auto%' AND email LIKE '%@%'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Customers whose email contains `email`, created between two days. */
export function countCustomersByEmailDate(hub: Database, companyId: string, email: string, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.customers c
       LEFT JOIN public.customer_account ca ON ca.referrer_customer_id = c.uid
      WHERE c.company_id = $1 AND c.email ILIKE '%' || $2 || '%' AND ${BETWEEN('c.created_at', '$3', '$4')}`,
    [companyId, email, from, to],
  );
}

// ---------- debt collection ----------

/** Claims with this status and stage, created between two days. */
export function countClaimsByStatusStageDate(hub: Database, companyId: string, status: string, stage: string, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.debtist_claims
      WHERE company_id = $1 AND status ILIKE $2 AND stage ILIKE $3 AND ${BETWEEN('created_at', '$4', '$5')}`,
    [companyId, status, stage, from, to],
  );
}

// ---------- assets and repairs (latest row per serial number) ----------

/** SKU with the most assets whose latest status is `status`, or undefined. */
export function pickAssetSku(hub: Database, companyId: string, status: string) {
  return hub.maybeOne<{ sku: string; first_day: string; last_day: string }>(
    `SELECT pt.sku, to_char(MIN(pt.created_at), 'YYYY-MM-DD') AS first_day, to_char(MAX(pt.created_at), 'YYYY-MM-DD') AS last_day
       FROM public.product_trackings pt JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND pt.location_status = $2 AND COALESCE(pt.sku, '') <> '' AND pt.serial_number NOT LIKE 'qa_auto%'
      GROUP BY pt.sku ORDER BY COUNT(*) DESC LIMIT 1`,
    [companyId, status],
  );
}

/** Assets (latest row per serial) with one of these statuses and this SKU, created between two days. */
export function countAssetsByStatusesSkuDate(hub: Database, companyId: string, statuses: string[], sku: string, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.product_trackings pt
       JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND pt.location_status ILIKE ANY($2) AND pt.sku ILIKE $3 AND ${BETWEEN('pt.created_at', '$4', '$5')}`,
    [companyId, statuses, sku, from, to],
  );
}

/** A word from the product name of the newest rented-out asset, and that asset's day, or undefined. */
export function pickRentedAssetName(hub: Database, companyId: string) {
  return hub.maybeOne<{ product_name: string; day: string }>(
    `SELECT pt.product_name, to_char(pt.created_at, 'YYYY-MM-DD') AS day
       FROM public.product_trackings pt JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND pt.location_status = 'rented out' AND COALESCE(pt.product_name, '') <> ''
        AND pt.serial_number NOT LIKE 'qa_auto%'
      ORDER BY pt.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Assets (latest row per serial) with one of these statuses, product name containing `name`, created between two days. */
export function countAssetsByStatusesNameDate(hub: Database, companyId: string, statuses: string[], name: string, from: string, to: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.product_trackings pt
       JOIN public.distinct_product_trackings_view v ON v.id = pt.id
      WHERE pt.company_id = $1 AND pt.location_status ILIKE ANY($2) AND pt.product_name ILIKE '%' || $3 || '%'
        AND ${BETWEEN('pt.created_at', '$4', '$5')}`,
    [companyId, statuses, name, from, to],
  );
}

// ---------- products, vouchers, stores ----------

/** Products with these active / allow_order_create values and stock above `stock`. */
export function countProductsByActiveOrderableStock(hub: Database, companyId: string, active: boolean, orderable: boolean, stock: number) {
  return count(
    hub,
    'SELECT COUNT(*) AS count FROM public.products WHERE company_id = $1 AND active = $2 AND allow_order_create = $3 AND stock > $4',
    [companyId, active, orderable, stock],
  );
}

/** Vouchers with these valid / one_time_use values and a discount amount above `amount`. */
export function countVouchersByValidOneTimeAmount(hub: Database, companyId: string, valid: boolean, oneTimeUse: boolean, amount: number) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM checkout.checkout_voucher_codes
      WHERE company_id = $1 AND valid = $2 AND one_time_use = $3 AND discount_amount > $4`,
    [companyId, valid, oneTimeUse, amount],
  );
}

/** First word of the name of the newest enabled store, or undefined. */
export function pickStoreName(hub: Database, companyId: string) {
  return hub.maybeOne<{ name: string }>(
    `SELECT name FROM public.retailers
      WHERE company_id = $1 AND enabled = true AND deleted_at IS NULL AND name NOT LIKE 'qa_auto%' AND COALESCE(name, '') <> ''
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Stores (not deleted) with this enabled value and a name containing `name`. */
export function countStoresByEnabledName(hub: Database, companyId: string, enabled: boolean, name: string) {
  return count(
    hub,
    `SELECT COUNT(*) AS count FROM public.retailers
      WHERE company_id = $1 AND deleted_at IS NULL AND enabled = $2 AND name ILIKE '%' || $3 || '%'`,
    [companyId, enabled, name],
  );
}
