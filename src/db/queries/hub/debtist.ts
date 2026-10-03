import type { Database } from '@db/connection';

/** Queries on debtist_claims (debt collection) and invoices that can be claimed. */

export type ClaimRow = { claim_id: string; status: string; stage: string; invoice_ids: string[] | string; customer_id: string | null };

const COLUMNS = 'claim_id, status, stage, invoice_ids, customer_id';

/** Newest debt-collection claim of the company. Throws if none. */
export function findLatestClaim(hub: Database, companyId: string) {
  return hub.one<ClaimRow>(
    `SELECT ${COLUMNS} FROM public.debtist_claims WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}

/** invoice_ids comes back as an array or a single value depending on the row. */
export function firstInvoiceIdOf(claim: ClaimRow): string {
  return Array.isArray(claim.invoice_ids) ? claim.invoice_ids[0] : claim.invoice_ids;
}

/** Claim by claim_id, or undefined. */
export function findClaim(hub: Database, companyId: string, claimId: string) {
  return hub.maybeOne<ClaimRow>(
    `SELECT ${COLUMNS} FROM public.debtist_claims WHERE company_id = $1 AND claim_id = $2`,
    [companyId, claimId],
  );
}

/** Newest claim that contains the given invoice id, or undefined. */
export function findClaimOfInvoice(hub: Database, companyId: string, invoiceId: string) {
  return hub.maybeOne<ClaimRow>(
    `SELECT ${COLUMNS} FROM public.debtist_claims
      WHERE company_id = $1 AND $2 = ANY(invoice_ids::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, invoiceId],
  );
}

/** Latest unpaid invoice with no claim yet. */
export function findClaimableInvoice(hub: Database, companyId: string) {
  return hub.one<{ invoice_id: string; transaction_id: string }>(
    `SELECT i.id AS invoice_id, i.transaction_id
       FROM public.transactions t
       JOIN public.invoices i ON i.company_id = t.company_id AND i.transaction_id = t.transaction_id
      WHERE i.company_id = $1 AND i.paid = false AND i.claim_id IS NULL AND t.invoice_number IS NOT NULL
      ORDER BY i.created_at DESC LIMIT 1`,
    [companyId],
  );
}

/**
 * Makes an invoice claimable: backdates the invoice and its transaction by 3 days
 * and marks the transaction failed, as claims need an overdue, failed payment.
 */
export function backdateInvoiceAsFailed(hub: Database, companyId: string, transactionId: string) {
  return hub.query(
    `WITH update_invoice AS (
       UPDATE public.invoices
          SET created_at = NOW() - INTERVAL '3 days', updated_at = NOW() - INTERVAL '3 days'
        WHERE company_id = $1 AND transaction_id = $2)
     UPDATE public.transactions
        SET status = 'failed',
            collection_date = NOW() - INTERVAL '3 days',
            created_at = NOW() - INTERVAL '3 days',
            updated_at = NOW() - INTERVAL '3 days'
      WHERE company_id = $1 AND transaction_id = $2`,
    [companyId, transactionId],
  );
}

/** Newest claim with its customer id and status/stage (hub debt-collection page), or undefined. */
export function findLatestClaimWithCustomer(hub: Database, companyId: string) {
  return hub.maybeOne<{ claim_id: string; status: string; stage: string; customer_id: string | null }>(
    `SELECT claim_id, status, stage, customer_id
       FROM public.debtist_claims
      WHERE company_id = $1 AND customer_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
}
