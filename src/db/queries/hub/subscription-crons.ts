import type { Database } from '@db/connection';

/** Queries for the subscription cron tests: auto renew, expired → pending return, force reactivate. */

export type SubscriptionSettings = {
  auto_renew: boolean;
  notice_period: number;
  auto_renew_custom_duration: boolean;
  auto_renew_duration: number;
  auto_renew_extend_by_billing_cycle: boolean;
  max_duration: number | null;
  return_until_period: number;
  reactivate_period: number;
  force_reactivate: boolean;
};

/** subscription_settings row of the company. Throws if none. */
export function getSubscriptionSettings(hub: Database, companyId: string) {
  return hub.one<SubscriptionSettings>(
    `SELECT auto_renew, notice_period, auto_renew_custom_duration, auto_renew_duration, auto_renew_extend_by_billing_cycle,
            max_duration, return_until_period, reactivate_period, force_reactivate
       FROM public.subscription_settings WHERE company_id = $1`,
    [companyId],
  );
}

/** email_settings.notify_pending_return of the company (false when no row). */
export async function getNotifyPendingReturn(hub: Database, companyId: string): Promise<boolean> {
  const row = await hub.maybeOne<{ on: boolean | null }>('SELECT notify_pending_return AS on FROM public.email_settings WHERE company_id = $1', [
    companyId,
  ]);
  return row?.on === true;
}

/** Switches force_reactivate of the company on or off. */
export function setForceReactivate(hub: Database, companyId: string, on: boolean) {
  return hub.query('UPDATE public.subscription_settings SET force_reactivate = $2 WHERE company_id = $1', [companyId, on]);
}

export type CronSubscription = {
  id: string; // numeric primary key, recurring_payments.subscription_id points at it
  subscription_id: string;
  status: string;
  subscription_type: string;
  subscription_frequency: string;
  subscription_frequency_interval: number;
  subscription_duration: number;
  subscription_start: string; // YYYY-MM-DD
  subscription_end: string | null;
  next_billing_date: string | null;
  real_end_date: string | null;
  return_until: string | null;
  return_reason: string | null;
  auto_renew: boolean;
  auto_renewed: boolean | null;
  auto_renew_count: number | null;
  reactivated_count: number | null;
  quantity: number;
  subscription_price: string;
  subscription_extension_price: string | null;
  product_id: string;
  cancellation_date: string | null;
  cancellation_type: string | null;
  cancellation_reason: string | null;
  cancelled_by_customer: boolean | null;
};

// dates as text, so the time zone of this computer does not shift them
const CRON_COLUMNS = `id, subscription_id, status, subscription_type, subscription_frequency, subscription_frequency_interval,
  subscription_duration, to_char(subscription_start, 'YYYY-MM-DD') AS subscription_start,
  to_char(subscription_end, 'YYYY-MM-DD') AS subscription_end, to_char(next_billing_date, 'YYYY-MM-DD') AS next_billing_date,
  to_char(real_end_date, 'YYYY-MM-DD') AS real_end_date, to_char(return_until, 'YYYY-MM-DD') AS return_until, return_reason,
  auto_renew, auto_renewed, auto_renew_count, reactivated_count, quantity, subscription_price, subscription_extension_price,
  product_id, to_char(cancellation_date, 'YYYY-MM-DD') AS cancellation_date, cancellation_type, cancellation_reason, cancelled_by_customer`;

/** One subscription with the fields the cron tests check. Throws if none. */
export function findCronSubscription(hub: Database, subscriptionId: string) {
  return hub.one<CronSubscription>(`SELECT ${CRON_COLUMNS} FROM public.subscriptions WHERE subscription_id = $1`, [subscriptionId]);
}

/**
 * Active monthly subscription of a type that the auto renew job will renew: auto_renew on, circuly recurring,
 * not from Shopify, not qa_auto, and still below max_duration after the renewal. Consumable: the longest interval first.
 * renewalMonths = cycles × interval when the interval counts (consumable or extendByCycle), else cycles. Or undefined.
 */
export function findSubscriptionForAutoRenew(
  hub: Database,
  companyId: string,
  type: string,
  cycles: number,
  extendByCycle: boolean,
  maxDuration: number,
) {
  return hub.maybeOne<CronSubscription>(
    `SELECT ${CRON_COLUMNS} FROM (
       SELECT s.*,
              (current_date - 1) + make_interval(months => $3 *
                 CASE WHEN s.subscription_type = 'consumable' OR $4 THEN s.subscription_frequency_interval ELSE 1 END) AS new_end
         FROM public.subscriptions s
        WHERE s.company_id = $1 AND s.status = 'active' AND s.subscription_type = $2
          AND s.auto_renew = true AND s.is_circuly_recurring = true AND s.origin = 'cms'
          AND s.subscription_frequency = 'monthly' AND s.subscription_frequency_interval >= 1
          AND s.subscription_start < current_date - 1
          AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%' AND s.order_id NOT LIKE 'qa_auto%'
     ) AS s
     WHERE ($5 = 0 OR extract(year from age(new_end, subscription_start)) * 12 + extract(month from age(new_end, subscription_start)) < $5 - 1)
     ORDER BY subscription_frequency_interval DESC, created_at DESC LIMIT 1`,
    [companyId, type, cycles, extendByCycle, maxDuration],
  );
}

/** Active subscription of a type for the pending-return job: origin cms, not qa_auto, real_end_date empty. Or undefined. */
export function findSubscriptionForPendingReturn(hub: Database, companyId: string, type: string) {
  return hub.maybeOne<CronSubscription>(
    `SELECT ${CRON_COLUMNS} FROM public.subscriptions s
      WHERE s.company_id = $1 AND s.status = 'active' AND s.subscription_type = $2 AND s.origin = 'cms'
        AND s.real_end_date IS NULL
        AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%' AND s.order_id NOT LIKE 'qa_auto%'
        AND EXISTS (SELECT 1 FROM public.recurring_payments rp
                     WHERE rp.subscription_id = s.id AND rp.payment_settled = false AND rp.failed = false
                       AND rp.enabled = true AND rp.invoice_id IS NULL AND rp.cumulated_invoice_id IS NULL)
      ORDER BY s.created_at DESC LIMIT 1`,
    [companyId, type],
  );
}

/** Normal 'pending return' subscription with auto_reactivate on, origin cms, not qa_auto, with unsettled RPs. Or undefined. */
export function findSubscriptionForReactivate(hub: Database, companyId: string) {
  return hub.maybeOne<CronSubscription>(
    `SELECT ${CRON_COLUMNS} FROM public.subscriptions s
      WHERE s.company_id = $1 AND s.status = 'pending return' AND s.subscription_type = 'normal' AND s.origin = 'cms'
        AND s.auto_reactivate = true
        AND COALESCE(s.serial_number, '') NOT LIKE 'qa_auto%' AND s.order_id NOT LIKE 'qa_auto%'
        AND EXISTS (SELECT 1 FROM public.recurring_payments rp WHERE rp.subscription_id = s.id AND rp.payment_settled = false)
      ORDER BY s.updated_at DESC LIMIT 1`,
    [companyId],
  );
}

/** Sets subscription_end to today minus `days` (test setup). */
export function setSubscriptionEndDaysAgo(hub: Database, subscriptionId: string, days: number) {
  return hub.query('UPDATE public.subscriptions SET subscription_end = current_date - $2::int WHERE subscription_id = $1', [
    subscriptionId,
    days,
  ]);
}

/** Switches auto_renew of one subscription (test setup). */
export function setSubscriptionAutoRenew(hub: Database, subscriptionId: string, on: boolean) {
  return hub.query('UPDATE public.subscriptions SET auto_renew = $2 WHERE subscription_id = $1', [subscriptionId, on]);
}

/** Sets return_until to today minus `days` (test setup). */
export function setReturnUntilDaysAgo(hub: Database, subscriptionId: string, days: number) {
  return hub.query('UPDATE public.subscriptions SET return_until = current_date - $2::int WHERE subscription_id = $1', [
    subscriptionId,
    days,
  ]);
}

/** Writes return_until directly ('YYYY-MM-DD' or null) - cleanup: put the old value back. */
export function setReturnUntil(hub: Database, subscriptionId: string, date: string | null) {
  return hub.query('UPDATE public.subscriptions SET return_until = $2::date WHERE subscription_id = $1', [subscriptionId, date]);
}

/** Number of active subscriptions without auto renew that ended before yesterday (the pending-return job takes all of them). */
export async function countExpiredActiveSubscriptions(hub: Database, companyId: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.subscriptions
      WHERE company_id = $1 AND status = 'active' AND auto_renew = false AND subscription_end::date < current_date - 1`,
    [companyId],
  );
  return Number(row.count);
}

/** auto_renew_count of a subscription (0 when empty). */
export async function getAutoRenewCount(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.maybeOne<{ count: number | null }>('SELECT auto_renew_count AS count FROM public.subscriptions WHERE subscription_id = $1', [
    subscriptionId,
  ]);
  return row?.count ?? 0;
}

/** reactivated_count of a subscription (0 when empty). */
export async function getReactivatedCount(hub: Database, subscriptionId: string): Promise<number> {
  const row = await hub.maybeOne<{ count: number | null }>('SELECT reactivated_count AS count FROM public.subscriptions WHERE subscription_id = $1', [
    subscriptionId,
  ]);
  return row?.count ?? 0;
}

/** Latest order_items.subscription_duration of a subscription, or 1 when empty or 0 (same as the auto renew job). */
export async function getOrderItemDuration(hub: Database, companyId: string, subscriptionId: string): Promise<number> {
  const row = await hub.maybeOne<{ duration: number | null }>(
    `SELECT subscription_duration AS duration FROM public.order_items
      WHERE company_id = $1 AND subscription_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [companyId, subscriptionId],
  );
  return row?.duration && row.duration > 0 ? row.duration : 1;
}

/** subscription_extension_price of the subscription's variant (product_id = shop_variant_id), or 0. */
export async function getVariantExtensionPrice(hub: Database, companyId: string, productId: string): Promise<number> {
  const row = await hub.maybeOne<{ price: number | null }>(
    'SELECT subscription_extension_price AS price FROM public.product_variants WHERE company_id = $1 AND shop_variant_id = $2 LIMIT 1',
    [companyId, productId],
  );
  return Number(row?.price ?? 0);
}

/** Highest recurring_payments.id of a subscription (by its numeric id), or 0. */
export async function getLastRecurringPaymentId(hub: Database, subscriptionPk: string): Promise<number> {
  const row = await hub.one<{ id: string | null }>('SELECT MAX(id) AS id FROM public.recurring_payments WHERE subscription_id = $1', [subscriptionPk]);
  return Number(row.id ?? 0);
}

export type CronRecurringPayment = {
  id: string;
  billing_date: string;
  amount: string;
  quantity: number;
  payment_settled: boolean;
  enabled: boolean;
};

/** Recurring payments of a subscription with an id above `afterId` (the ones a job created), oldest first. */
export function findRecurringPaymentsAfter(hub: Database, subscriptionPk: string, afterId: number) {
  return hub.query<CronRecurringPayment>(
    `SELECT id, to_char(billing_date, 'YYYY-MM-DD') AS billing_date, amount, quantity, payment_settled, enabled
       FROM public.recurring_payments WHERE subscription_id = $1 AND id > $2 ORDER BY id`,
    [subscriptionPk, afterId],
  );
}

/** Number of open (unsettled, not failed, not invoiced) recurring payments of a subscription that are still enabled. */
export async function countEnabledOpenPayments(hub: Database, subscriptionPk: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    `SELECT COUNT(*) AS count FROM public.recurring_payments
      WHERE subscription_id = $1 AND payment_settled = false AND failed = false AND enabled = true
        AND invoice_id IS NULL AND cumulated_invoice_id IS NULL`,
    [subscriptionPk],
  );
  return Number(row.count);
}

/** Number of unsettled recurring payments of a subscription that are disabled. */
export async function countDisabledUnsettledPayments(hub: Database, subscriptionPk: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.recurring_payments WHERE subscription_id = $1 AND payment_settled = false AND enabled = false',
    [subscriptionPk],
  );
  return Number(row.count);
}

/** Highest email_entries.id, or 0 (read before an action, then look for newer rows). */
export async function getLastEmailEntryId(hub: Database): Promise<number> {
  const row = await hub.one<{ id: string | null }>('SELECT MAX(id) AS id FROM public.email_entries');
  return Number(row.id ?? 0);
}

/** Newest email_entries row of a subscription with this template, newer than `afterId`, or undefined. */
export function findNewEmailEntry(hub: Database, subscriptionId: string, templateId: string, afterId: number) {
  return hub.maybeOne<{ id: string; to: string; subject: string; success: boolean; error: string | null }>(
    `SELECT id, "to", subject, success, error FROM public.email_entries
      WHERE subscription_id = $1 AND template_id = $2 AND id > $3 ORDER BY id DESC LIMIT 1`,
    [subscriptionId, templateId, afterId],
  );
}


/** Cycles the auto renew job adds: auto_renew_duration when custom duration is on, else the order item duration. */
export async function getRenewalCycles(hub: Database, companyId: string, settings: SubscriptionSettings, subscriptionId: string) {
  if (settings.auto_renew_custom_duration) return settings.auto_renew_duration;
  return getOrderItemDuration(hub, companyId, subscriptionId);
}

/** Price of a renewed recurring payment: subscription extension price, else the variant's, else the subscription price. */
export async function getRenewalAmount(hub: Database, companyId: string, subscription: CronSubscription): Promise<number> {
  if (Number(subscription.subscription_extension_price ?? 0) > 0) return Number(subscription.subscription_extension_price);
  const variantPrice = await getVariantExtensionPrice(hub, companyId, subscription.product_id);
  if (variantPrice > 0) return variantPrice;
  return Number(subscription.subscription_price);
}

/** true when the subscription has an email_entries row with this template newer than `afterId` (for expect.poll). */
export async function hasNewEmailEntry(hub: Database, subscriptionId: string, templateId: string, afterId: number) {
  return (await findNewEmailEntry(hub, subscriptionId, templateId, afterId)) !== undefined;
}

/** Number of jobs still in these queues (public.jobs; a job row is removed when it has run). */
export async function countQueueJobs(hub: Database, queues: string[]): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.jobs WHERE queue = ANY($1)', [queues]);
  return Number(row.count);
}

/** Id of the cms_crons row that runs the worker of this queue ("... queue:work ... --queue=<queue>"). Throws if none. */
export async function getQueueWorkerCronId(hub: Database, queue: string): Promise<string> {
  const row = await hub.one<{ id: string }>(
    `SELECT id FROM public.cms_crons WHERE command ~ ('queue:work.*--queue=' || $1 || '( |$)') ORDER BY id LIMIT 1`,
    [queue],
  );
  return row.id;
}
