import type { Database } from '@db/connection';

/** Queries on transactions. */

export type TransactionRow = { transaction_id: string; invoice_number: string | null; type: string; status: string; order_id: string | null };

/** Newest transaction of the company. Throws if none. */
export function findLatestTransaction(hub: Database, companyId: string) {
  return hub.one<TransactionRow>(
    `SELECT transaction_id, invoice_number, "type", status, order_id
       FROM public.transactions
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Transaction by its text transaction_id ("pi_..." / "TR_..."), or undefined. */
export function findTransaction(hub: Database, companyId: string, transactionId: string) {
  return hub.maybeOne<TransactionRow>(
    `SELECT transaction_id, invoice_number, "type", status, order_id
       FROM public.transactions
      WHERE company_id = $1 AND transaction_id = $2`,
    [companyId, transactionId],
  );
}

/** How many transactions of the given invoice numbers are still 'pending' (cron test waits for 0). */
export async function countPendingTransactions(hub: Database, invoiceNumbers: string[]): Promise<number> {
  const row = await hub.one<{ count: string }>(
    "SELECT COUNT(*) AS count FROM public.transactions WHERE invoice_number = ANY($1) AND status = 'pending'",
    [invoiceNumbers],
  );
  return Number(row.count);
}

/** The refund transaction created for an original transaction. */
export function findRefundOf(hub: Database, transactionId: string) {
  return hub.maybeOne<{ invoice_number: string; refunded_transaction_id: string; status: string }>(
    'SELECT invoice_number, refunded_transaction_id, status FROM public.transactions WHERE refunded_transaction_id = $1',
    [transactionId],
  );
}

/**
 * Latest one-time-payment transaction of the company that owns the order.
 * (Joined by company, not by order.)
 */
export function findLatestOneTimePayment(hub: Database, orderId: string) {
  return hub.maybeOne<{ invoice_number: string; type: string }>(
    `SELECT t.invoice_number, t."type"
       FROM public.transactions t
       JOIN public.orders o ON o.company_id = t.company_id
      WHERE o.order_id = $1 AND t."type" = 'one time payment'
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [orderId],
  );
}

// ---------- CSS "Outstanding amount" (tests/css-e2e/02-outstanding-amount.spec.ts) ----------

/** Transactions of an invoice_number (status + type), or [] if none. */
export function findTransactionsOfInvoice(hub: Database, invoiceNumber: string) {
  return hub.query<TransactionRow>(
    'SELECT transaction_id, invoice_number, "type", status, order_id FROM public.transactions WHERE invoice_number = $1 ORDER BY created_at',
    [invoiceNumber],
  );
}

/** Sets transactions.status for every transaction of an invoice_number (test setup, e.g. 'failed'). */
export function setTransactionStatusOfInvoice(hub: Database, invoiceNumber: string, status: string) {
  return hub.query('UPDATE public.transactions SET status = $2 WHERE invoice_number = $1', [invoiceNumber, status]);
}
