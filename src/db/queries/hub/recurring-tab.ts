import type { Database } from '@db/connection';

/** Queries for the hub Recurring payments tab. The list shows enabled, not deleted recurring payments. */

/** Number of recurring payments in the list, optionally with one list status ('settled', 'not settled', 'failed' ...). */
export async function countListRecurringPayments(hub: Database, companyId: string, status?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments rp
       LEFT JOIN public.recurring_payments_with_status_view v ON v.id = rp.id
      WHERE rp.company_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL AND ($2::text IS NULL OR v.status = $2)`,
    [companyId, status ?? null],
  );
  return Number(row.count);
}

/** Number of listed recurring payments of one subscription (text id). */
export async function countSubscriptionListPayments(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments rp JOIN public.subscriptions s ON s.id = rp.subscription_id
      WHERE s.subscription_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL`,
    [subscriptionId],
  );
  return Number(row.count);
}

/**
 * Active normal checkout subscription (card, Stripe) with 4+ open recurring payments, and its first 4 payment ids.
 * Takes the 4th such subscription, so it does not clash with subscription-recurring-payments.spec (it takes the 2nd).
 */
export function findSubscriptionForRecurringTab(hub: Database, companyId: string) {
  return hub.maybeOne<{ subscription_id: string; order_id: string; rp1: string; rp2: string; rp3: string; rp4: string }>(
    `WITH open_rps AS (
       SELECT s.subscription_id, s.order_id, r.id,
              ROW_NUMBER() OVER (PARTITION BY s.subscription_id ORDER BY r.id ASC) AS rn
         FROM subscriptions s
         JOIN orders o ON o.order_id = s.order_id AND o.company_id = s.company_id
         JOIN recurring_payments r ON r.subscription_id = s.id AND r.company_id = s.company_id
        WHERE o.company_id = $1 AND o.payment_method_token IN ('visa', 'mastercard', 'card') AND o.payment_provider = 'stripe'
          AND o.status IN ('open', 'fulfilled') AND o.origin = 'checkout'
          AND s.subscription_type = 'normal' AND s.status = 'active' AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%'
          AND r.enabled = true AND r.deleted_at IS NULL AND r.payment_settled = false AND r.failed = false AND r.invoice_id IS NULL)
     SELECT subscription_id, MAX(order_id) AS order_id,
            MAX(CASE WHEN rn = 1 THEN id END) AS rp1, MAX(CASE WHEN rn = 2 THEN id END) AS rp2,
            MAX(CASE WHEN rn = 3 THEN id END) AS rp3, MAX(CASE WHEN rn = 4 THEN id END) AS rp4
       FROM open_rps WHERE rn <= 4 GROUP BY subscription_id HAVING COUNT(id) >= 4
      ORDER BY subscription_id LIMIT 1 OFFSET 3`,
    [companyId],
  );
}

/** A settled, listed recurring payment (not qa_auto) with its subscription text id, or undefined. */
export function findSettledListPayment(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; subscription_id: string }>(
    `SELECT rp.id, s.subscription_id FROM public.recurring_payments rp JOIN public.subscriptions s ON s.id = rp.subscription_id
      WHERE rp.company_id = $1 AND rp.enabled = true AND rp.deleted_at IS NULL AND rp.payment_settled = true
        AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%'
      ORDER BY rp.billing_date DESC LIMIT 1`,
    [companyId],
  );
}

/** Amount (4 decimals as text) and quantity of a recurring payment. Throws if none. */
export function findPaymentAmountAndQuantity(hub: Database, id: string) {
  return hub.one<{ amount: string; quantity: number }>('SELECT amount, quantity FROM public.recurring_payments WHERE id = $1', [id]);
}

/** Writes amount and quantity directly (cleanup: put the old values back). */
export function setPaymentAmountAndQuantity(hub: Database, id: string, amount: string, quantity: number) {
  return hub.query('UPDATE public.recurring_payments SET amount = $2, quantity = $3 WHERE id = $1', [id, amount, quantity]);
}

/** Marks a recurring payment as failed or not (test setup / cleanup). */
export function setPaymentFailed(hub: Database, id: string, failed: boolean, reason: string) {
  return hub.query('UPDATE public.recurring_payments SET failed = $2, fail_reason = $3 WHERE id = $1', [id, failed, reason]);
}
