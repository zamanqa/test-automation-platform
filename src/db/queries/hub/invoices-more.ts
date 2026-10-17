import type { Database } from '@db/connection';

/** Queries for the extra hub invoice tests (regenerate, e-invoice download, unblock, edit, zip, type filter, refund limit, payments table). */

/** Newest invoice of this type and paid value (not qa_auto transaction), or undefined. */
export function findInvoiceOfType(hub: Database, companyId: string, type: string, paid?: boolean) {
  return hub.maybeOne<{ id: string; invoice_number: string; transaction_id: string | null }>(
    `SELECT id, invoice_number, transaction_id FROM public.invoices
      WHERE company_id = $1 AND "type" = $2 AND ($3::boolean IS NULL OR paid = $3)
        AND COALESCE(transaction_id, '') NOT LIKE 'qa_auto%'
      ORDER BY id DESC LIMIT 1`,
    [companyId, type, paid ?? null],
  );
}

/** updated_at of an invoice with microseconds, as text. */
export async function getInvoiceUpdatedAt(hub: Database, id: string): Promise<string> {
  const row = await hub.one<{ updated: string }>(`SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS.US') AS updated FROM public.invoices WHERE id = $1`, [id]);
  return row.updated;
}

/** Number of e_invoices rows of an invoice in one format ('zugferd' | 'xrechnung'). */
export async function countEInvoices(hub: Database, invoiceId: string, format: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.e_invoices WHERE invoice_id = $1 AND format = $2', [invoiceId, format]);
  return Number(row.count);
}

/** Sets auto_claim_blocked of an invoice directly (test setup). */
export function setAutoClaimBlocked(hub: Database, id: string, blocked: boolean) {
  return hub.query('UPDATE public.invoices SET auto_claim_blocked = $2 WHERE id = $1', [id, blocked]);
}

/** HTML body of an invoice. */
export async function getInvoiceBody(hub: Database, id: string): Promise<string> {
  const row = await hub.one<{ body: string | null }>('SELECT body FROM public.invoices WHERE id = $1', [id]);
  return row.body ?? '';
}

/** Writes the HTML body of an invoice back (cleanup). */
export function setInvoiceBody(hub: Database, id: string, body: string) {
  return hub.query('UPDATE public.invoices SET body = $2 WHERE id = $1', [id, body]);
}

/** Number of invoices of the company, optionally of one type. */
export async function countCompanyInvoices(hub: Database, companyId: string, type?: string): Promise<number> {
  const row = await hub.one<{ count: string }>(
    'SELECT COUNT(*) AS count FROM public.invoices WHERE company_id = $1 AND ($2::text IS NULL OR "type" = $2)',
    [companyId, type ?? null],
  );
  return Number(row.count);
}

/** Paid recurring invoice with 2+ transactions (not qa_auto) and how many it has, or undefined. */
export function findInvoiceWithTransactions(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; invoice_number: string; transaction_ids: string[] }>(
    `SELECT i.id, i.invoice_number, array_agg(t.transaction_id ORDER BY t.id) AS transaction_ids
       FROM public.invoices i JOIN public.transactions t ON t.invoice_number = i.invoice_number AND t.company_id = i.company_id
      WHERE i.company_id = $1 AND t.transaction_id NOT LIKE 'qa_auto%'
      GROUP BY i.id, i.invoice_number HAVING COUNT(*) BETWEEN 2 AND 10
      ORDER BY i.id DESC LIMIT 1`,
    [companyId],
  );
}

/** Highest uploads.id now (read before a zip download). */
export async function getLastUploadId(hub: Database): Promise<number> {
  const row = await hub.one<{ id: string | null }>('SELECT MAX(id) AS id FROM public.uploads');
  return Number(row.id ?? 0);
}

/** true when the company has a zip upload newer than `afterId` (bulk invoice download started). */
export async function hasNewZipUpload(hub: Database, companyId: string, afterId: number): Promise<boolean> {
  const row = await hub.one<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM public.uploads WHERE company_id = $1 AND extension = 'zip' AND id > $2) AS found`,
    [companyId, afterId],
  );
  return row.found;
}

/** Newest paid recurring invoice (not qa_auto transaction) that has no e_invoices rows yet, or undefined. */
export function findInvoiceWithoutEInvoice(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; invoice_number: string }>(
    `SELECT i.id, i.invoice_number FROM public.invoices i
      WHERE i.company_id = $1 AND i."type" = 'recurring payment' AND i.paid = true
        AND COALESCE(i.transaction_id, '') NOT LIKE 'qa_auto%'
        AND NOT EXISTS (SELECT 1 FROM public.e_invoices e WHERE e.invoice_id = i.id)
      ORDER BY i.id DESC LIMIT 1`,
    [companyId],
  );
}

/** Number of e_invoices rows of an invoice (any format). */
export async function countAllEInvoices(hub: Database, invoiceId: string): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.e_invoices WHERE invoice_id = $1', [invoiceId]);
  return Number(row.count);
}
