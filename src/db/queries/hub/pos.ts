import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/pos-e2e/login.spec.ts
//   tests/pos-e2e/orders.spec.ts
//   tests/pos-e2e/create-order.spec.ts
//   tests/pos-e2e/subscriptions.spec.ts

/**
 * Queries for the POS portal (StoreConnect). The POS login is a row in `retailers`
 * (location_id = POS_LOCATION_ID). A POS order is a quote: draft_orders.draft_id = 'quote_…',
 * its items are in draft_items, its customer in order_customers.
 */

export type RetailerRow = { retailer_id: string; name: string; company_id: string };

/** The retailer (POS location) that logs in with this location id. Throws if none. */
export function findRetailer(hub: Database, locationId: string) {
  return hub.one<RetailerRow>(
    `SELECT retailer_id, name, company_id FROM public.retailers
      WHERE location_id = $1 AND deleted_at IS NULL`,
    [locationId],
  );
}

/** Number of quotes in the POS "Order list" (open + completed; cancelled quotes are soft-deleted). */
export async function countRetailerQuotes(hub: Database, retailerId: string, companyId: string) {
  const row = await hub.one<{ count: string }>(
    `SELECT count(*) FROM public.draft_orders
      WHERE retailer_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [retailerId, companyId],
  );
  return Number(row.count);
}

/** Newest quote of the retailer that is not deleted and not made for a qa_auto customer, or undefined. */
export function findNewestRetailerQuote(hub: Database, retailerId: string, companyId: string) {
  return hub.maybeOne<{ draft_id: string; status: string }>(
    `SELECT d.draft_id, d.status FROM public.draft_orders d
       JOIN public.order_customers c ON c.id = d.order_customer_id
      WHERE d.retailer_id = $1 AND d.company_id = $2 AND d.deleted_at IS NULL
        AND c.email NOT LIKE 'qa\\_auto%'
      ORDER BY d.id DESC LIMIT 1`,
    [retailerId, companyId],
  );
}

export type DraftOrderRow = {
  draft_id: string;
  status: string;
  amount: string;
  retailer_id: string;
  company_id: string;
  order_checkout_link: string;
  order_customer_id: number;
  deleted_at: Date | null;
};

/** The quote with this draft_id (also when cancelled = soft-deleted), or undefined. */
export function findDraftOrder(hub: Database, draftId: string) {
  return hub.maybeOne<DraftOrderRow>(
    `SELECT draft_id, status, amount, retailer_id, company_id, order_checkout_link, order_customer_id, deleted_at
       FROM public.draft_orders WHERE draft_id = $1`,
    [draftId],
  );
}

/** Items of a quote (draft_items). */
export function findDraftItems(hub: Database, draftId: string) {
  return hub.query<{ sku: string; name: string; quantity: number; price: string }>(
    'SELECT sku, name, quantity, price FROM public.draft_items WHERE draft_id = $1 ORDER BY id',
    [draftId],
  );
}

/** The customer saved for a quote (order_customers). Throws if none. */
export function findOrderCustomer(hub: Database, orderCustomerId: number) {
  return hub.one<{ email: string; billing_first_name: string; billing_last_name: string; phone: string; billing_city: string }>(
    `SELECT email, billing_first_name, billing_last_name, phone, billing_city
       FROM public.order_customers WHERE id = $1`,
    [orderCustomerId],
  );
}

export type PosProductRow = { product_name: string; variant_name: string; sku: string };

/**
 * A product the POS can sell, with one of its variants — names as the POS shows them (English
 * translation if there is one). Product and variant active + orderable, variant in stock and with
 * sku + name, nothing starting with qa_auto, and the product has 2+ such variants (so the
 * "Variant" step of Add item is shown). Throws if none.
 */
export function findPosProduct(hub: Database, companyId: string) {
  return hub.one<PosProductRow>(
    `SELECT COALESCE(p.title_translations->>'en', p.title) AS product_name,
            COALESCE(v.title_translations->>'en', v.title) AS variant_name,
            v.sku
       FROM public.products p
       JOIN public.product_variants v ON v.product_id = p.id
      WHERE p.company_id = $1 AND p.active = true AND p.allow_order_create = true
        AND v.active = true AND v.allow_order_create = true AND v.stock > 0
        AND COALESCE(v.sku, '') <> '' AND COALESCE(v.title, '') <> ''
        AND p.title NOT LIKE 'qa\\_auto%' AND v.title NOT LIKE 'qa\\_auto%'
        AND (SELECT count(*) FROM public.product_variants v2
              WHERE v2.product_id = p.id AND v2.active = true AND v2.allow_order_create = true AND v2.stock > 0) >= 2
      ORDER BY p.id DESC, v.id LIMIT 1`,
    [companyId],
  );
}

/** Number of subscriptions in the POS "Subscriptions - started" tab (subscriptions of the retailer's orders). */
export async function countRetailerSubscriptions(hub: Database, retailerId: string) {
  const row = await hub.one<{ count: string }>(
    `SELECT count(*) FROM public.subscriptions s
       JOIN public.orders o ON o.order_id = s.order_id
      WHERE o.retailer_id = $1`,
    [retailerId],
  );
  return Number(row.count);
}

/** The subscription started with this serial number, or undefined. */
export function findSubscriptionBySerial(hub: Database, serialNumber: string) {
  return hub.maybeOne<{ subscription_id: string; order_id: string; status: string }>(
    'SELECT subscription_id, order_id, status FROM public.subscriptions WHERE serial_number = $1',
    [serialNumber],
  );
}

/** Number of quotes in the Order list with this status ('open', 'completed' ...), as the Status filter shows them. */
export async function countRetailerQuotesByStatus(hub: Database, retailerId: string, companyId: string, status: string) {
  const row = await hub.one<{ count: string }>(
    `SELECT count(*) FROM public.draft_orders
      WHERE retailer_id = $1 AND company_id = $2 AND deleted_at IS NULL AND status = $3`,
    [retailerId, companyId, status],
  );
  return Number(row.count);
}

/** Number of the retailer's subscriptions with this status ('active', 'ended' ...). */
export async function countRetailerSubscriptionsByStatus(hub: Database, retailerId: string, status: string) {
  const row = await hub.one<{ count: string }>(
    `SELECT count(*) FROM public.subscriptions s
       JOIN public.orders o ON o.order_id = s.order_id
      WHERE o.retailer_id = $1 AND s.status = $2`,
    [retailerId, status],
  );
  return Number(row.count);
}

/**
 * For the Add item filters: one checkbox filter option (e.g. Material → "Plastic") that active products have,
 * with the names of those products as the POS shows them. Empty list if no option is used by a product.
 */
export function findProductsOfFilterOption(hub: Database, companyId: string) {
  return hub.query<{ option_label: string; product_name: string }>(
    `WITH used AS (
       SELECT o.id AS option_id, o.label, p.id AS product_id, COALESCE(p.title_translations->>'en', p.title) AS product_name
         FROM public.product_attribute_options o
         JOIN public.product_attribute_definitions d ON d.id = o.attribute_definition_id
         JOIN public.product_attribute_values pav ON pav.value_option_id = o.id
         JOIN public.product_variants v ON pav.entity_type = 'variant' AND v.id = pav.entity_id AND v.active = true
         JOIN public.products p ON p.id = v.product_id AND p.active = true
        WHERE d.company_id = $1 AND d.is_filterable = true AND d.is_active = true AND d.filter_type = 'checkbox'
          AND o.is_active = true)
     SELECT DISTINCT label AS option_label, product_name FROM used
      WHERE option_id = (SELECT option_id FROM used ORDER BY option_id LIMIT 1)
      ORDER BY product_name`,
    [companyId],
  );
}
