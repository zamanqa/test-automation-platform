import type { Database } from '@db/connection';

/** email_entries rows written by "Resend email", and the company switches that allow those emails. */

export type EmailEntry = { id: string; template_id: string; to: string[]; success: boolean };

/** Newest email of an order newer than `afterId`, or undefined. */
export function findNewOrderEmail(hub: Database, orderId: string, afterId: number) {
  return hub.maybeOne<EmailEntry>(
    'SELECT id, template_id, "to", success FROM public.email_entries WHERE order_id = $1 AND id > $2 ORDER BY id DESC LIMIT 1',
    [orderId, afterId],
  );
}

/** Newest email of a transaction newer than `afterId`, or undefined. */
export function findNewTransactionEmail(hub: Database, transactionId: string, afterId: number) {
  return hub.maybeOne<EmailEntry>(
    'SELECT id, template_id, "to", success FROM public.email_entries WHERE transaction_id = $1 AND id > $2 ORDER BY id DESC LIMIT 1',
    [transactionId, afterId],
  );
}

/** Template id of the newest order email newer than `afterId`, or undefined (for expect.poll). */
export async function getNewOrderEmailTemplate(hub: Database, orderId: string, afterId: number) {
  return (await findNewOrderEmail(hub, orderId, afterId))?.template_id;
}

/** Template id of the newest transaction email newer than `afterId`, or undefined (for expect.poll). */
export async function getNewTransactionEmailTemplate(hub: Database, transactionId: string, afterId: number) {
  return (await findNewTransactionEmail(hub, transactionId, afterId))?.template_id;
}

/** email_settings.notify_orders and notify_transactions of the company. Throws if no row. */
export function getOrderAndTransactionNotify(hub: Database, companyId: string) {
  return hub.one<{ notify_orders: boolean; notify_transactions: boolean }>(
    'SELECT notify_orders, notify_transactions FROM public.email_settings WHERE company_id = $1',
    [companyId],
  );
}

/** Switches email_settings.notify_orders (setup, and cleanup puts the old value back). */
export function setNotifyOrders(hub: Database, companyId: string, on: boolean) {
  return hub.query('UPDATE public.email_settings SET notify_orders = $2 WHERE company_id = $1', [companyId, on]);
}

/** Switches email_settings.notify_transactions (setup, and cleanup puts the old value back). */
export function setNotifyTransactions(hub: Database, companyId: string, on: boolean) {
  return hub.query('UPDATE public.email_settings SET notify_transactions = $2 WHERE company_id = $1', [companyId, on]);
}
