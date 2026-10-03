import type { Database } from '@db/connection';

/** Queries on subscriptions, and on order items that can become subscriptions. */

export type SubscriptionRow = {
  subscription_id: string;
  order_id: string;
  product_id: string;
  status: string;
  auto_renew: boolean;
  serial_number: string | null;
  real_end_date: string | null;
  subscription_type: string;
};

const COLUMNS = 'subscription_id, order_id, product_id, status, auto_renew, serial_number, real_end_date, subscription_type';

/** Newest active subscription of the company. Throws if none. */
export function findLatestActiveSubscription(hub: Database, companyId: string) {
  return hub.one<SubscriptionRow>(
    `SELECT ${COLUMNS} FROM public.subscriptions
      WHERE company_id = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Active 'normal' subscription without an end date. */
export function findActiveNormalSubscriptionWithoutEnd(hub: Database, companyId: string) {
  return hub.maybeOne<SubscriptionRow>(
    `SELECT ${COLUMNS} FROM public.subscriptions
      WHERE company_id = $1 AND real_end_date IS NULL AND subscription_type = 'normal' AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/**
 * Newest active 'normal' subscription that has an asset (product_trackings row).
 * The bought_out action needs the asset, else the API answers "Product serial not found".
 */
export function findActiveNormalSubscriptionWithAsset(hub: Database, companyId: string) {
  return hub.maybeOne<SubscriptionRow>(
    `SELECT s.subscription_id, s.order_id, s.product_id, s.status, s.auto_renew, s.serial_number,
            s.real_end_date, s.subscription_type
       FROM public.subscriptions s
      WHERE s.company_id = $1 AND s.status = 'active' AND s.subscription_type = 'normal'
        AND EXISTS (SELECT 1 FROM public.product_trackings pt
                     WHERE pt.company_id = s.company_id AND pt.subscription_id = s.subscription_id)
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Subscription by subscription_id (text id), or undefined. Fields: see SubscriptionRow above. */
export function findSubscription(hub: Database, subscriptionId: string) {
  return hub.maybeOne<SubscriptionRow>(`SELECT ${COLUMNS} FROM public.subscriptions WHERE subscription_id = $1`, [subscriptionId]);
}

/** Active subscription of a type ('normal' | 'consumable'): latest, or the first created with `oldest`. */
export function findActiveSubscriptionOfType(hub: Database, companyId: string, type: string, { oldest = false } = {}) {
  return hub.one<SubscriptionRow>(
    `SELECT ${COLUMNS} FROM public.subscriptions
      WHERE company_id = $1 AND status = 'active' AND subscription_type = $2
      ORDER BY created_at ${oldest ? 'ASC' : 'DESC'} LIMIT 1`,
    [companyId, type],
  );
}

/** Active normal subscription paid by card via Stripe on a paid order: can be bought out. */
export function findStripeBuyoutSubscription(hub: Database, companyId: string) {
  return hub.one<SubscriptionRow>(
    `SELECT s.subscription_id, s.order_id, s.product_id, s.status, s.auto_renew, s.serial_number,
            s.real_end_date, s.subscription_type
       FROM public.subscriptions s
       LEFT JOIN public.orders o ON s.order_id = o.order_id
      WHERE s.company_id = $1
        AND s.status = 'active'
        AND s.subscription_type = 'normal'
        AND s.payment_method_token NOT IN ('offlinegateway', 'invoice')
        AND s.payment_method_token NOT ILIKE '%paypal%'
        AND o.payment_provider = 'stripe'
        AND o.status IN ('open', 'TEST', 'fulfilled')
        AND o.payment_status = 'paid'
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** A paid consumable order item whose variant is in stock: parent for a customer-created order, or undefined. */
export function findReorderableConsumableItem(hub: Database, companyId: string) {
  return hub.maybeOne<{ parent_order_id: string; variant_id: string; sku: string }>(
    `SELECT oi.order_id AS parent_order_id, pv.shop_variant_id AS variant_id, oi.sku
       FROM public.order_items oi
       JOIN public.orders o ON o.order_id = oi.order_id AND o.company_id = oi.company_id
       JOIN public.product_variants pv ON pv.sku = oi.sku AND pv.company_id = oi.company_id
      WHERE oi.company_id = $1
        AND oi.subscription = true
        AND oi.subscription_type = 'consumable'
        AND o.payment_status = 'paid'
        AND o.status IN ('open', 'fulfilled')
        AND pv.stock > 0
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

// ---------- hub UI tests ----------

export type SubscriptionDetailRow = SubscriptionRow & {
  id: string;
  quantity: number | null;
  subscription_frequency_interval: number;
  subscription_duration: number;
  subscription_price: string;
};

/** Full row incl. the numeric primary key `id` (recurring_payments.subscription_id points at it). */
export function findSubscriptionRow(hub: Database, subscriptionId: string) {
  return hub.maybeOne<SubscriptionDetailRow>(
    `SELECT id, ${COLUMNS}, quantity, subscription_frequency_interval, subscription_duration, subscription_price
       FROM public.subscriptions WHERE subscription_id = $1`,
    [subscriptionId],
  );
}

/**
 * Latest active normal subscription from a card/PayPal checkout order, longer than
 * 3 cycles and not the parent of another subscription - safe to run menu actions on.
 */
export function findSubscriptionForActions(hub: Database, companyId: string) {
  return hub.one<{ subscription_id: string }>(
    `SELECT s.subscription_id
       FROM subscriptions s
       LEFT JOIN orders o ON o.order_id = s.order_id AND o.company_id = s.company_id
      WHERE o.company_id = $1
        AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
        AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
        AND o.status IN ('open', 'fulfilled')
        AND o.origin = 'checkout'
        AND s.subscription_type = 'normal'
        AND s.status = 'active'
        AND s.subscription_duration > 3
        AND s.subscription_id NOT IN (SELECT parent_id FROM subscriptions WHERE parent_id IS NOT NULL)
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Serial number of the latest long (>5 cycles) active normal checkout subscription: returned, then repaired. */
export async function findSerialNumberForReturn(hub: Database, companyId: string): Promise<string> {
  const row = await hub.one<{ serial_number: string }>(
    `SELECT s.serial_number
       FROM subscriptions s
       LEFT JOIN orders o ON o.order_id = s.order_id AND o.company_id = s.company_id
      WHERE o.company_id = $1
        AND o.payment_method_token IN ('visa', 'mastercard', 'card', 'paypal')
        AND o.payment_provider IN ('stripe', 'mollie', 'adyen', 'braintree')
        AND o.status IN ('open', 'fulfilled')
        AND o.origin = 'checkout'
        AND s.subscription_type = 'normal'
        AND s.status = 'active'
        AND s.serial_number IS NOT NULL
        AND s.subscription_duration > 5
        AND s.serial_number <> 'no-serial-number-found'
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [companyId],
  );
  return row.serial_number;
}

// ---------- one value of a subscription (for expect.poll in the hub tests) ----------

/** Status of a subscription ('active', 'ended', 'pending return' ...), or undefined. */
export async function getSubscriptionStatus(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ status: string }>('SELECT status FROM public.subscriptions WHERE subscription_id = $1', [subscriptionId]);
  return row?.status;
}

/** Billing interval of a subscription as text ('1', '2' ...), or undefined. */
export async function getBillingInterval(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ interval: string }>(
    'SELECT subscription_frequency_interval::text AS interval FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return row?.interval;
}

/** Quantity of a subscription as a number, or undefined. */
export async function getSubscriptionQuantity(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ quantity: string }>('SELECT quantity FROM public.subscriptions WHERE subscription_id = $1', [subscriptionId]);
  return row ? Number(row.quantity) : undefined;
}

/** Installment price of a subscription as text with 4 decimals ('22.0000'), or undefined. */
export async function getSubscriptionPrice(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ subscription_price: string }>(
    'SELECT subscription_price FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return row?.subscription_price;
}

/**
 * subscription_duration as a number, or undefined.
 * Note: subscription_duration = hub "Subscription length" − prepaid months
 * (order_items.subscription_duration_prepaid, see getPrepaidMonths). E.g. length 12, prepaid 1 → 11.
 */
export async function getSubscriptionDuration(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ subscription_duration: string }>(
    'SELECT subscription_duration FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return row ? Number(row.subscription_duration) : undefined;
}

/** Prepaid months of a subscription (order_items.subscription_duration_prepaid of its order item); 0 if not set. */
export async function getPrepaidMonths(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.maybeOne<{ prepaid: string | null }>(
    'SELECT subscription_duration_prepaid AS prepaid FROM public.order_items WHERE subscription_id = $1 LIMIT 1',
    [subscriptionId],
  );
  return Number(row?.prepaid ?? 0);
}

/** Extension price of a subscription as a number, or undefined. */
export async function getExtensionPrice(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ subscription_extension_price: string }>(
    'SELECT subscription_extension_price FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return row ? Number(row.subscription_extension_price) : undefined;
}

/** Serial number of a subscription, or undefined. */
export async function getSerialNumber(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ serial_number: string | null }>(
    'SELECT serial_number FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
  return row?.serial_number ?? undefined;
}

/** Number of subscriptions of a company, optionally by status and/or type. */
export async function countSubscriptions(hub: Database, companyId: string, filter: { status?: string; type?: string } = {}) {
  const row = await hub.one<{ total: string }>(
    `SELECT COUNT(*) AS total FROM public.subscriptions
      WHERE company_id = $1
        AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR subscription_type = $3)`,
    [companyId, filter.status ?? null, filter.type ?? null],
  );
  return Number(row.total);
}

/** Changes subscription_type directly in the database (test setup, e.g. to 'digital'). */
export function setSubscriptionType(hub: Database, subscriptionId: string, type: string) {
  return hub.query('UPDATE subscriptions SET subscription_type = $2 WHERE subscription_id = $1', [subscriptionId, type]);
}

/** Changes type and quantity directly in the database (test setup / cleanup). */
export function setSubscriptionTypeAndQuantity(hub: Database, subscriptionId: string, type: string, quantity: number) {
  return hub.query('UPDATE subscriptions SET subscription_type = $2, quantity = $3 WHERE subscription_id = $1', [
    subscriptionId,
    type,
    quantity,
  ]);
}

/** Quantity and additional_infos of a subscription - read before a test changes them. Throws if none. */
export function findQuantityAndAdditionalInfos(hub: Database, subscriptionId: string) {
  return hub.one<{ quantity: number; additional_infos: Record<string, string> | null }>(
    'SELECT quantity, additional_infos FROM public.subscriptions WHERE subscription_id = $1',
    [subscriptionId],
  );
}

/** Writes additional_infos directly in the database (cleanup: put the old value back). */
export function setAdditionalInfos(hub: Database, subscriptionId: string, additionalInfos: Record<string, string> | null) {
  const value = additionalInfos === null ? null : JSON.stringify(additionalInfos);
  return hub.query('UPDATE public.subscriptions SET additional_infos = $2 WHERE subscription_id = $1', [subscriptionId, value]);
}

/** Changes status directly in the database (test setup, e.g. 'ended', 'pending return'). */
export function setSubscriptionStatus(hub: Database, subscriptionId: string, status: string) {
  return hub.query('UPDATE public.subscriptions SET status = $2 WHERE subscription_id = $1', [subscriptionId, status]);
}

/** Deletes a subscription row (not used by tests yet). */
export function deleteSubscription(hub: Database, companyId: string, subscriptionId: string) {
  return hub.query('DELETE FROM public.subscriptions WHERE subscription_id = $1 AND company_id = $2', [subscriptionId, companyId]);
}

// ---------- order items that do not have a subscription yet ----------

export type OpenSubscriptionItem = {
  order_id: string;
  order_item_id: string;
  sku: string;
  subscription_id: string;
  subscription_type: string;
};

/** Latest non-bundle subscription order item whose subscription was never created. */
export function findItemWithoutSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<OpenSubscriptionItem>(
    `SELECT oi.order_id, oi.order_item_id, oi.sku, oi.subscription_id, oi.subscription_type
       FROM order_items oi
      WHERE oi.company_id = $1
        AND oi.subscription = true
        AND oi.is_bundle = false
        AND oi.bundle_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.subscription_id = oi.subscription_id AND s.company_id = oi.company_id)
      ORDER BY oi.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/**
 * A monthly, prepaid-1 order item of a paid, open visa checkout order that has no
 * subscription yet (subscription id = order_id_order_item_id_sku). Used by the
 * Customer API tests; `type` is 'consumable' or 'normal'. item_id is order_items.id.
 */
export function findPaidCheckoutItemWithoutSubscription(hub: Database, companyId: string, type: 'consumable' | 'normal') {
  return hub.maybeOne<{ item_id: string; order_id: string; order_item_id: string; sku: string }>(
    `SELECT oi.id AS item_id, oi.order_id, oi.order_item_id, oi.sku
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id AND o.company_id = oi.company_id
      WHERE oi.subscription = true
        AND oi.subscription_frequency = 'monthly'
        AND oi.subscription_duration_prepaid = 1
        AND oi.is_bundle = false
        AND oi.subscription_type = $2
        AND o.payment_status = 'paid'
        AND o.parent_id IS NULL
        AND o.origin = 'checkout'
        AND o.payment_method_token = 'visa'
        AND o.status = 'open'
        AND o.transaction_id IS NOT NULL
        AND o.company_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
           WHERE s.subscription_id = oi.order_id || '_' || oi.order_item_id || '_' || oi.sku
             AND s.company_id = oi.company_id)
      LIMIT 1`,
    [companyId, type],
  );
}

/** Latest bundle subscription order item whose subscription was never created, with its bundle variant. */
export function findBundleItemWithoutSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<OpenSubscriptionItem & { pv_id: string; shop_variant_id: string; pv_title: string }>(
    `SELECT oi.order_id, oi.order_item_id, oi.sku, oi.subscription_id, oi.subscription_type,
            pv.id AS pv_id, pv.shop_variant_id, pv.title AS pv_title
       FROM order_items oi
       JOIN product_variants pv ON oi.sku = pv.shop_variant_id::text AND oi.bundle_id = pv.bundle_id
      WHERE oi.company_id = $1
        AND oi.subscription = true
        AND oi.is_bundle = true
        AND oi.bundle_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.subscription_id = oi.subscription_id AND s.company_id = oi.company_id)
      ORDER BY oi.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** auto_reactivate of a subscription (true = reactivated automatically if the item is not returned), or undefined. */
export async function getAutoReactivate(hub: Database, subscriptionId: string) {
  const row = await hub.maybeOne<{ auto_reactivate: boolean }>('SELECT auto_reactivate FROM public.subscriptions WHERE subscription_id = $1', [subscriptionId]);
  return row?.auto_reactivate;
}

/** Number of buyout invoices of a subscription (invoice → its transaction of type 'buyout' for this subscription). */
export async function countBuyoutInvoices(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM public.invoices i
       JOIN public.transactions t ON t.transaction_id = i.transaction_id AND t.company_id = i.company_id
      WHERE t.subscription_id = $1 AND t."type" = 'buyout' AND i."type" = 'buyout'`,
    [subscriptionId],
  );
  return Number(row.count);
}

/**
 * Undoes a CSS cancellation (test setup): status 'active', cancellation_date / cancellation_type /
 * cancellation_reason = NULL, cancelled_by_customer = false. Only status is not enough - the CSS hides the actions.
 */
export function resetCssCancellation(hub: Database, subscriptionId: string) {
  return hub.query(
    `UPDATE public.subscriptions
        SET status = 'active', cancellation_date = NULL, cancellation_type = NULL, cancellation_reason = NULL, cancelled_by_customer = false
      WHERE subscription_id = $1`,
    [subscriptionId],
  );
}
