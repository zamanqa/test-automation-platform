import type { Database } from '@db/connection';

/** Queries for the extra hub order tests (bulk fulfil, item edit and serial, quotes, draft orders, consumables). */

/** Newest open + paid checkout orders without subscription items (not qa_auto). */
export function findOrdersToFulfil(hub: Database, companyId: string, count: number) {
  return hub.query<{ order_id: string }>(
    `SELECT o.order_id FROM public.orders o
      WHERE o.company_id = $1 AND o.status = 'open' AND o.payment_status = 'paid' AND o.origin = 'checkout'
        AND o.order_id NOT LIKE 'qa_auto%'
        AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.order_id AND oi.subscription = true)
      ORDER BY o.created_at DESC LIMIT $2`,
    [companyId, count],
  );
}

/** Status and fulfillment day of an order, or undefined. */
export function findOrderStatus(hub: Database, orderId: string) {
  return hub.maybeOne<{ status: string; fulfillment_date: string | null }>(
    `SELECT status, to_char(fulfillment_date, 'YYYY-MM-DD') AS fulfillment_date FROM public.orders WHERE order_id = $1`,
    [orderId],
  );
}

/** Status of an order, or undefined (for expect.poll). */
export async function getOrderStatus(hub: Database, orderId: string) {
  return (await findOrderStatus(hub, orderId))?.status;
}

/** Newest order with this status (not qa_auto), or undefined. */
export function findOrderWithStatus(hub: Database, companyId: string, status: string) {
  return hub.maybeOne<{ order_id: string }>(
    `SELECT order_id FROM public.orders WHERE company_id = $1 AND status = $2 AND order_id NOT LIKE 'qa_auto%'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, status],
  );
}

export type OrderItemValues = {
  order_id: string;
  order_item_id: string;
  sku: string;
  price: string;
  subscription_duration: number;
  tracking_number: string | null;
  serial_number: string | null;
};

const ITEM_COLUMNS = 'oi.order_id, oi.order_item_id, oi.sku, oi.price, oi.subscription_duration, oi.tracking_number, oi.serial_number';

/** Subscription item whose subscription is not created yet, of an open checkout order (editable), or undefined. */
export function findEditableOrderItem(hub: Database, companyId: string) {
  return hub.maybeOne<OrderItemValues>(
    `SELECT ${ITEM_COLUMNS} FROM public.order_items oi JOIN public.orders o ON o.order_id = oi.order_id AND o.company_id = oi.company_id
      WHERE o.company_id = $1 AND o.status = 'open' AND oi.subscription = true AND oi.serial_number IS NULL
        AND o.order_id NOT LIKE 'qa_auto%'
        AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.subscription_id = oi.subscription_id)
      ORDER BY o.created_at DESC, oi.id LIMIT 1`,
    [companyId],
  );
}

/** One order item by its order_item_id. Throws if none. */
export function findOrderItemValues(hub: Database, orderItemId: string) {
  return hub.one<OrderItemValues>(`SELECT ${ITEM_COLUMNS} FROM public.order_items oi WHERE oi.order_item_id = $1`, [orderItemId]);
}

/** serial_number of an order item, or null. */
export async function getOrderItemSerial(hub: Database, orderItemId: string) {
  return (await findOrderItemValues(hub, orderItemId)).serial_number;
}

/** Writes price, duration, tracking number and serial back (cleanup). */
export function setOrderItemValues(hub: Database, item: OrderItemValues) {
  return hub.query(
    'UPDATE public.order_items SET price = $2, subscription_duration = $3, tracking_number = $4, serial_number = $5 WHERE order_item_id = $1',
    [item.order_item_id, item.price, item.subscription_duration, item.tracking_number, item.serial_number],
  );
}

/** Newest draft order (orders.status 'draft') with items, not qa_auto, and its customer, or undefined. */
export function findDraftOrder(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string; order_customer_id: string }>(
    `SELECT o.order_id, o.order_customer_id FROM public.orders o
      WHERE o.company_id = $1 AND o.status = 'draft' AND o.order_id NOT LIKE 'qa_auto%'
        AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.order_id)
      ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Highest orders.id now (read before an action, then look for newer orders). */
export async function getLastOrderPk(hub: Database): Promise<number> {
  const row = await hub.one<{ id: string | null }>('SELECT MAX(id) AS id FROM public.orders');
  return Number(row.id ?? 0);
}

/** Number of orders of the company newer than `afterPk`, optionally only of one origin. */
export async function countOrdersAfter(hub: Database, companyId: string, afterPk: number, origin?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.orders WHERE company_id = $1 AND id > $2 AND ($3::text IS NULL OR origin = $3)',
    [companyId, afterPk, origin ?? null],
  );
  return Number(row.count);
}

/** Newest open quote (draft_orders) that is not qa_auto, or undefined. */
export function findOpenQuote(hub: Database, companyId: string) {
  return hub.maybeOne<{ draft_id: string }>(
    `SELECT draft_id FROM public.draft_orders
      WHERE company_id = $1 AND status = 'open' AND deleted_at IS NULL AND draft_id NOT LIKE 'qa_auto%'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Status of a quote and whether it is deleted, or undefined. */
export function findQuoteStatus(hub: Database, draftId: string) {
  return hub.maybeOne<{ status: string; deleted: boolean }>(
    'SELECT status, deleted_at IS NOT NULL AS deleted FROM public.draft_orders WHERE draft_id = $1',
    [draftId],
  );
}

/** Status of a quote, or undefined (for expect.poll). */
export async function getQuoteStatus(hub: Database, draftId: string) {
  return (await findQuoteStatus(hub, draftId))?.status;
}

/** A tag used on orders (not qa_auto) and the email of the newest checkout order customer, or undefined. */
export function findOrderTagAndEmail(hub: Database, companyId: string) {
  return hub.maybeOne<{ tag: string; email: string }>(
    `SELECT (SELECT tag FROM public.orders WHERE company_id = $1 AND COALESCE(tag, '') <> '' AND tag NOT LIKE 'qa_auto%'
              GROUP BY tag ORDER BY COUNT(*) DESC LIMIT 1) AS tag,
            (SELECT oc.email FROM public.orders o JOIN public.order_customers oc ON oc.id = o.order_customer_id
              WHERE o.company_id = $1 AND o.origin = 'checkout' AND oc.email NOT LIKE 'qa_auto%'
              ORDER BY o.created_at DESC LIMIT 1) AS email`,
    [companyId],
  );
}

/** Number of orders with this tag (any case, like the list filter). */
export async function countOrdersWithTag(hub: Database, companyId: string, tag: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.orders WHERE company_id = $1 AND tag ILIKE $2', [companyId, tag]);
  return Number(row.count);
}

/** Number of orders whose customer email is exactly this email. */
export async function countOrdersOfEmail(hub: Database, companyId: string, email: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.orders o JOIN public.order_customers oc ON oc.id = o.order_customer_id
      WHERE o.company_id = $1 AND oc.email ILIKE $2`,
    [companyId, email],
  );
  return Number(row.count);
}

/** Writes the status of an order directly (cleanup: put the old status back). */
export function setOrderStatus(hub: Database, orderId: string, status: string) {
  return hub.query('UPDATE public.orders SET status = $2 WHERE order_id = $1', [orderId, status]);
}

/** Highest subscriptions.id of an order now (0 when none), read before the bulk fulfil. */
export async function getLastSubscriptionIdOfOrder(hub: Database, orderId: string): Promise<number> {
  const row = await hub.one<{ id: string | null }>('SELECT MAX(id) AS id FROM public.subscriptions WHERE order_id = $1', [orderId]);
  return Number(row.id ?? 0);
}

/** Number of subscriptions of an order with an id above `afterId` (started by the bulk fulfil). */
export async function countNewSubscriptionsOfOrder(hub: Database, orderId: string, afterId: number): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.subscriptions WHERE order_id = $1 AND id > $2', [orderId, afterId]);
  return Number(row.count);
}

/** Deletes subscriptions of an order with an id above `afterId`, with their recurring payments and asset rows (cleanup). */
export async function deleteNewSubscriptionsOfOrder(hub: Database, orderId: string, afterId: number) {
  const subs = await hub.query<{ id: string; subscription_id: string }>('SELECT id, subscription_id FROM public.subscriptions WHERE order_id = $1 AND id > $2', [
    orderId,
    afterId,
  ]);
  for (const sub of subs) {
    await hub.query('DELETE FROM public.recurring_payments WHERE subscription_id = $1', [sub.id]);
    await hub.query('DELETE FROM public.product_trackings WHERE subscription_id = $1', [sub.subscription_id]);
    await hub.query('UPDATE public.order_items SET subscription_id = NULL WHERE subscription_id = $1', [sub.subscription_id]);
    await hub.query('DELETE FROM public.subscriptions WHERE id = $1', [sub.id]);
  }
}

/** Newest fulfilled order (not qa_auto) without subscriptions - the cancel time limit does not apply to it, or undefined. */
export function findFulfilledOrderWithoutSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string }>(
    `SELECT o.order_id FROM public.orders o
      WHERE o.company_id = $1 AND o.status = 'fulfilled' AND o.order_id NOT LIKE 'qa_auto%'
        AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.order_id = o.order_id AND s.company_id = o.company_id)
      ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Newest cancelled order (not qa_auto) not changed in the last 10 minutes (O2 may still be busy with its own order), or undefined. */
export function findSettledCancelledOrder(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string }>(
    `SELECT order_id FROM public.orders
      WHERE company_id = $1 AND status = 'cancelled' AND order_id NOT LIKE 'qa_auto%' AND updated_at < now() - interval '10 minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Newest order (not qa_auto) with a consumable subscription where every item already has a subscription, or undefined. */
export function findConsumableOrderWithAllSubscriptions(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string; items: string }>(
    `SELECT o.order_id, (SELECT COUNT(*) FROM public.order_items oi WHERE oi.order_id = o.order_id) AS items
       FROM public.orders o
      WHERE o.company_id = $1 AND o.order_id NOT LIKE 'qa_auto%' AND o.status IN ('open', 'fulfilled')
        AND EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.order_id = o.order_id AND s.company_id = o.company_id AND s.subscription_type = 'consumable')
        AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.order_id)
        AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.order_id AND COALESCE(oi.subscription_id, '') = '')
      ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}
