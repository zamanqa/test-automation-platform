import type { Database } from '@db/connection';

/** Queries for the hub Payments (transactions) tab. */

/** Number of transactions of the company, optionally with one status. */
export async function countPayments(hub: Database, companyId: string, status?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.transactions WHERE company_id = $1 AND ($2::text IS NULL OR status = $2)',
    [companyId, status ?? null],
  );
  return Number(row.count);
}

export type PaymentRow = {
  transaction_id: string;
  amount_paid: string;
  payment_service_provider: string;
  payment_method: string | null;
  type: string;
  invoice_type: string;
  invoice_number: string;
  status: string;
  order_id: string;
  customer_id: string;
  subscription_id: string;
};

/** Newest succeeded transaction below 1000 € with an invoice, order, customer and subscription (not qa_auto), or undefined. */
export function findPaymentForDetail(hub: Database, companyId: string) {
  return hub.maybeOne<PaymentRow>(
    `SELECT t.transaction_id, t.amount_paid, t.payment_service_provider, t.payment_method, t."type", t.invoice_type,
            t.invoice_number, t.status, t.order_id, t.customer_id, t.subscription_id
       FROM public.transactions t
       JOIN public.invoices i ON i.invoice_number = t.invoice_number AND i.company_id = t.company_id
      WHERE t.company_id = $1 AND t.status = 'succeeded' AND t.amount_paid < 1000
        AND t.subscription_id IS NOT NULL AND t.order_id IS NOT NULL AND t.customer_id IS NOT NULL
        AND t.transaction_id NOT LIKE 'qa_auto%' AND t.order_id NOT LIKE 'qa_auto%'
      ORDER BY t.created_at DESC LIMIT 1`,
    [companyId],
  );
}
