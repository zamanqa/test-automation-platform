import type { Database } from '@db/connection';

/** Queries for the extra hub Returns tests (mark as returned / bought, list counts, search). */

export type ReturnCandidate = { id: string; subscription_id: string; order_id: string; serial_number: string };

/**
 * Newest active normal subscription (not qa_auto) with a unique serial number, a tracking row and open recurring payments,
 * skipping the given subscription ids, or undefined.
 */
export function findReturnCandidate(hub: Database, companyId: string, skipIds: string[] = []) {
  return hub.maybeOne<ReturnCandidate>(
    `SELECT s.id, s.subscription_id, s.order_id, s.serial_number
       FROM public.subscriptions s
      WHERE s.company_id = $1 AND s.status = 'active' AND s.subscription_type = 'normal'
        AND COALESCE(s.serial_number, '') NOT IN ('', 'no-serial-number-found')
        AND s.serial_number NOT LIKE 'qa_auto%' AND s.subscription_id NOT LIKE 'qa_auto%'
        AND NOT (s.subscription_id = ANY($2::text[]))
        AND EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id = s.order_id AND o.company_id = s.company_id AND o.status IN ('open', 'fulfilled'))
        AND (SELECT COUNT(*) FROM public.subscriptions x WHERE x.company_id = s.company_id AND x.serial_number = s.serial_number) = 1
        AND EXISTS (SELECT 1 FROM public.product_trackings pt WHERE pt.company_id = s.company_id AND pt.subscription_id = s.subscription_id)
        AND EXISTS (SELECT 1 FROM public.recurring_payments rp
                     WHERE rp.subscription_id = s.id AND rp.enabled = true AND rp.payment_settled = false
                       AND rp.failed = false AND rp.invoice_id IS NULL AND rp.cumulated_invoice_id IS NULL)
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId, skipIds],
  );
}

/** Number of open (enabled, not settled, not invoiced) recurring payments of a subscription (subscriptions.id). */
export async function countOpenEnabledRps(hub: Database, subscriptionRowId: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments
      WHERE subscription_id = $1 AND enabled = true AND payment_settled = false AND failed = false
        AND invoice_id IS NULL AND cumulated_invoice_id IS NULL`,
    [subscriptionRowId],
  );
  return Number(row.count);
}

/** status and real_end_date (YYYY-MM-DD) of a subscription. Throws if none. */
export function getSubscriptionEnd(hub: Database, subscriptionId: string) {
  return hub.one<{ status: string; real_end_date: string | null }>(
    `SELECT status, to_char(real_end_date, 'YYYY-MM-DD') AS real_end_date FROM public.subscriptions WHERE subscription_id = $1`,
    [subscriptionId],
  );
}

/** Latest location status of the asset of a subscription, or undefined. */
export async function getSubscriptionAssetStatus(hub: Database, companyId: string, subscriptionId: string) {
  const row = await hub.maybeOne<{ location_status: string }>(
    'SELECT location_status FROM public.product_trackings WHERE company_id = $1 AND subscription_id = $2 ORDER BY id DESC LIMIT 1',
    [companyId, subscriptionId],
  );
  return row?.location_status;
}

/** Rows of the Returns list: normal/consumable subscriptions in active / pending return / pending replacement (once per order item), optionally one status. */
export async function countReturnsList(hub: Database, companyId: string, status?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.subscriptions s
       LEFT JOIN public.order_items oi ON oi.subscription_id = s.subscription_id
      WHERE s.company_id = $1 AND s.subscription_type IN ('consumable', 'normal')
        AND s.status IN ('active', 'pending return', 'pending replacement')
        AND ($2::text IS NULL OR s.status = $2)`,
    [companyId, status ?? null],
  );
  return Number(row.count);
}

/** Newest 'pending return' subscription in the Returns list (not qa_auto), or undefined. */
export function findPendingReturn(hub: Database, companyId: string) {
  return hub.maybeOne<{ subscription_id: string; order_id: string }>(
    `SELECT subscription_id, order_id FROM public.subscriptions
      WHERE company_id = $1 AND status = 'pending return' AND subscription_type IN ('consumable', 'normal')
        AND subscription_id NOT LIKE 'qa_auto%' AND order_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}
