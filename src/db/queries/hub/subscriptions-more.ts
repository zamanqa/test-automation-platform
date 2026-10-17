import type { Database } from '@db/connection';

/** Queries for the extra hub subscription tests (CSV import, serial exists, validation, ended menu, tabs, search). */

/** Subscription item of an open order whose subscription does not exist yet and whose SKU is the only one of its kind in the order. */
export function findImportableOrderItem(hub: Database, companyId: string) {
  return hub.maybeOne<{ order_id: string; sku: string; subscription_id: string }>(
    `SELECT oi.order_id, oi.sku, oi.subscription_id
       FROM public.order_items oi JOIN public.orders o ON o.order_id = oi.order_id AND o.company_id = oi.company_id
      WHERE o.company_id = $1 AND o.status = 'open' AND oi.subscription = true AND o.order_id NOT LIKE 'qa_auto%'
        AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.subscription_id = oi.subscription_id)
        AND (SELECT COUNT(*) FROM public.order_items x WHERE x.order_id = oi.order_id AND x.sku = oi.sku) = 1
      ORDER BY o.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Serial number of another active subscription (not this one, not qa_auto), or undefined. */
export function findOtherActiveSerial(hub: Database, companyId: string, subscriptionId: string) {
  return hub.maybeOne<{ serial_number: string }>(
    `SELECT serial_number FROM public.subscriptions
      WHERE company_id = $1 AND status = 'active' AND subscription_id <> $2
        AND COALESCE(serial_number, '') <> '' AND serial_number NOT LIKE 'qa_auto%' AND serial_number <> 'no-serial-number-found'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, subscriptionId],
  );
}

/** Newest ended normal subscription (not qa_auto), or undefined. */
export function findEndedSubscription(hub: Database, companyId: string) {
  return hub.maybeOne<{ subscription_id: string }>(
    `SELECT subscription_id FROM public.subscriptions
      WHERE company_id = $1 AND status = 'ended' AND subscription_type = 'normal' AND COALESCE(serial_number, '') NOT LIKE 'qa_auto%'
      ORDER BY updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** First 3 recurring payment ids (not deleted) of an active normal subscription with duration > 4 and 3+ of them, or undefined. */
export function findSubscriptionWithThreePayments(hub: Database, companyId: string) {
  return hub.maybeOne<{ subscription_id: string; ids: string[] }>(
    `SELECT s.subscription_id, (array_agg(rp.id ORDER BY rp.billing_date, rp.id))[1:3]::text[] AS ids
       FROM public.subscriptions s JOIN public.recurring_payments rp ON rp.subscription_id = s.id
      WHERE s.company_id = $1 AND s.status = 'active' AND s.subscription_type = 'normal'
        AND s.subscription_duration > 4
        AND rp.deleted_at IS NULL AND rp.enabled = true AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%'
      GROUP BY s.subscription_id, s.created_at HAVING COUNT(*) BETWEEN 3 AND 40
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Serial number of the newest active subscription (not qa_auto) and how many subscriptions have it, or undefined. */
export function findSearchableSerial(hub: Database, companyId: string) {
  return hub.maybeOne<{ serial_number: string; count: string }>(
    `SELECT s.serial_number, (SELECT COUNT(*) FROM public.subscriptions x WHERE x.company_id = $1 AND x.serial_number ILIKE '%' || s.serial_number || '%') AS count
       FROM public.subscriptions s
      WHERE s.company_id = $1 AND s.status = 'active' AND COALESCE(s.serial_number, '') <> ''
        AND s.serial_number NOT LIKE 'qa_auto%' AND s.serial_number <> 'no-serial-number-found' AND length(s.serial_number) > 8
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Newest email_entries row of a subscription newer than `afterId`, or undefined. */
export function findNewSubscriptionEmail(hub: Database, subscriptionId: string, afterId: number) {
  return hub.maybeOne<{ id: string; template_id: string; to: string[]; success: boolean }>(
    `SELECT id, template_id, "to", success FROM public.email_entries
      WHERE subscription_id = $1 AND id > $2 ORDER BY id DESC LIMIT 1`,
    [subscriptionId, afterId],
  );
}

/** Template id of the newest email of a subscription newer than `afterId`, or undefined (for expect.poll). */
export async function getNewSubscriptionEmailTemplate(hub: Database, subscriptionId: string, afterId: number) {
  return (await findNewSubscriptionEmail(hub, subscriptionId, afterId))?.template_id;
}

/** email_settings.notify_subscriptions of the company (false when no row). */
export async function getNotifySubscriptions(hub: Database, companyId: string): Promise<boolean> {
  const row = await hub.maybeOne<{ on: boolean | null }>('SELECT notify_subscriptions AS on FROM public.email_settings WHERE company_id = $1', [
    companyId,
  ]);
  return row?.on === true;
}

/** Switches email_settings.notify_subscriptions (setup, and cleanup puts the old value back). */
export function setNotifySubscriptions(hub: Database, companyId: string, on: boolean) {
  return hub.query('UPDATE public.email_settings SET notify_subscriptions = $2 WHERE company_id = $1', [companyId, on]);
}
