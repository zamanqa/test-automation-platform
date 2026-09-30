import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/css-e2e/02-outstanding-amount.spec.ts
//   tests/customer-api/invoices/invoices.spec.ts
//   tests/hub-e2e/cron/cron.spec.ts
//   tests/hub-e2e/invoices/invoice-list.spec.ts
//   tests/unified-api/invoices/invoices.spec.ts

/** Queries on invoices (and the transactions they belong to). */

export type InvoiceRow = { id: string; invoice_number: string; transaction_id: string; paid: boolean; type: string; amount: string };

/** Newest invoice of the company. Throws if none. */
export function findLatestInvoice(hub: Database, companyId: string) {
  return hub.one<InvoiceRow>(
    `SELECT id, invoice_number, transaction_id, paid, "type", amount
       FROM public.invoices
      WHERE company_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Invoice by invoice_number (e.g. "invoice-_22360"), or undefined. Use `.paid` to check payment. */
export function findInvoiceByNumber(hub: Database, invoiceNumber: string) {
  return hub.maybeOne<InvoiceRow>(
    'SELECT id, invoice_number, transaction_id, paid, "type", amount FROM public.invoices WHERE invoice_number = $1',
    [invoiceNumber],
  );
}

/**
 * Latest unpaid invoice whose transaction is still open (TR_ = Circuly transaction).
 * The Unified API tests also require it was never cancelled; the Customer API tests do not.
 */
export function findUnpaidInvoice(hub: Database, companyId: string, { neverCancelled = true } = {}) {
  return hub.maybeOne<{ invoice_number: string }>(
    `SELECT t.invoice_number
       FROM transactions t
       LEFT JOIN invoices i ON i.transaction_id = t.transaction_id AND i.company_id = t.company_id
      WHERE t.company_id = $1
        AND t.status NOT IN ('succeeded', 'in debt collection')
        AND i.paid = false
        AND t.transaction_id ILIKE '%TR_%'
        ${neverCancelled ? 'AND i.cancellation_count = 0' : ''}
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Invoices of a company; optional filters on transaction status(es), type or paid flag. */
export async function countInvoices(
  hub: Database,
  companyId: string,
  filter: { transactionStatuses?: string[]; type?: string; paid?: boolean } = {},
): Promise<number> {
  const row = await hub.one<{ total: string }>(
    `SELECT COUNT(DISTINCT i.id) AS total
       FROM public.invoices i
       LEFT JOIN public.transactions t ON i.invoice_number = t.invoice_number AND i.company_id = t.company_id
      WHERE i.company_id = $1
        AND ($2::text[] IS NULL OR t.status = ANY($2))
        AND ($3::text IS NULL OR i."type" = $3)
        AND ($4::boolean IS NULL OR i.paid = $4)`,
    [companyId, filter.transactionStatuses ?? null, filter.type ?? null, filter.paid ?? null],
  );
  return Number(row.total);
}

/**
 * Paid recurring-payment invoice of an open visa checkout order that was never
 * cancelled, replaced or refunded. `nth` 0 = latest, 1 = the one before.
 */
export function findRefundableRecurringInvoice(hub: Database, companyId: string, nth = 0) {
  return hub.one<{ id: string; invoice_number: string }>(
    `SELECT i.id, i.invoice_number
       FROM public.invoices i
       LEFT JOIN public.transactions t ON i.invoice_number = t.invoice_number AND i.company_id = t.company_id
       LEFT JOIN orders o ON o.order_id = t.order_id AND o.company_id = t.company_id
      WHERE t.status IN ('succeeded', 'settled')
        AND i."type" = 'recurring payment'
        AND i.paid = true
        AND i.cancelled_invoice_id IS NULL
        AND i.original_invoice_id IS NULL
        AND i.replaced_invoice_id IS NULL
        AND i.company_id = $1
        AND o.payment_method_token = 'visa'
        AND o.status = 'open'
        AND o.origin = 'checkout'
        AND t.transaction_id NOT IN (SELECT refunded_transaction_id FROM public.transactions WHERE refunded_transaction_id IS NOT NULL)
        -- not our own test payments (e.g. qa_auto_offline_1790670856107): they have no real payment to refund (owner, 2026-09-29)
        AND t.transaction_id NOT LIKE 'qa\\_auto%'
        -- Stripe only: a Stripe refund writes a refund transaction (refunded_transaction_id) → a refunded invoice drops out.
        -- Other payments (e.g. "TR_…") are refunded without that row and would be picked again (2026-09-29).
        AND t.payment_service_provider = 'stripe'
        -- something was really paid (an invoice paid fully by account balance has amount 0 → "Refund invoice" disabled)
        AND i.amount > 0
      ORDER BY i.created_at DESC
      LIMIT 1 OFFSET $2`,
    [companyId, nth],
  );
}

/** Invoice by numeric id incl. company, cancellation link, HTML body and errors, or undefined. */
export function findInvoiceById(hub: Database, id: string | number) {
  return hub.maybeOne<{ id: string; invoice_number: string; company_id: string; cancelled_invoice_id: string | null; body: string | null; errors: unknown }>(
    'SELECT id, invoice_number, company_id, cancelled_invoice_id, body, errors FROM public.invoices WHERE id = $1',
    [id],
  );
}

/** cancelled_invoice_id of an invoice (null = not cancelled), or undefined if not found. */
export async function getCancelledInvoiceId(hub: Database, id: string | number) {
  const row = await findInvoiceById(hub, id);
  return row?.cancelled_invoice_id;
}

/** Company and invoice number of several invoices by id (each invoice once, even if an id is repeated). */
export function findInvoicesByIds(hub: Database, ids: (string | number)[]) {
  return hub.query<{ id: string; company_id: string; invoice_number: string }>(
    'SELECT id, company_id, invoice_number FROM public.invoices WHERE id = ANY($1) ORDER BY id ASC',
    [ids.map(String)],
  );
}

/** Latest paid invoice with a number — can be downloaded as PDF. */
export function findLatestPaidInvoice(hub: Database, companyId: string) {
  return hub.maybeOne<InvoiceRow>(
    `SELECT id, invoice_number, transaction_id, paid, "type", amount
       FROM public.invoices
      WHERE company_id = $1 AND paid = true AND invoice_number IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest paid Stripe (pi_) invoice that has not been refunded yet (not even one item partly). */
export function findRefundableInvoice(hub: Database, companyId: string) {
  return hub.maybeOne<{ invoice_id: string; order_id: string; invoice_number: string; transaction_id: string }>(
    `SELECT i.id AS invoice_id, t.order_id, t.invoice_number, t.transaction_id
       FROM transactions t
       LEFT JOIN invoices i ON i.transaction_id = t.transaction_id AND i.company_id = t.company_id
      WHERE t.company_id = $1
        AND t.transaction_id ILIKE '%pi_%'
        AND t.status = 'succeeded'
        AND i.paid = true
        AND t.invoice_number IS NOT NULL
        AND t.refunded_transaction_id IS NULL
        AND invoice_type = 'invoice'
        AND t.transaction_id NOT IN (SELECT refunded_transaction_id FROM public.transactions WHERE refunded_transaction_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = i.id AND ii.refunded_amount > 0)
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

export type InvoiceItemRow = { id: string; title: string; subtotal_incl_vat: string; refunded_amount: string };

/** Items (lines) of an invoice, oldest first. subtotal_incl_vat = what the line cost; refunded_amount = refunded so far. */
export function findInvoiceItems(hub: Database, invoiceId: string) {
  return hub.query<InvoiceItemRow>(
    'SELECT id, title, subtotal_incl_vat, refunded_amount FROM public.invoice_items WHERE invoice_id = $1 ORDER BY id ASC',
    [invoiceId],
  );
}

/**
 * Amount of the refund invoice made for an original transaction, or 0 while it is not there yet.
 * The refund invoice appears a few seconds after the refund (Stripe webhook) → poll this.
 */
export async function getRefundInvoiceAmount(hub: Database, originalTransactionId: string): Promise<number> {
  const row = await hub.maybeOne<{ amount: string }>(
    `SELECT i.amount
       FROM public.transactions t
       JOIN public.invoices i ON i.transaction_id = t.transaction_id AND i.company_id = t.company_id
      WHERE t.refunded_transaction_id = $1 AND i."type" = 'refund'
      ORDER BY i.created_at DESC LIMIT 1`,
    [originalTransactionId],
  );
  return row ? Number(row.amount) : 0;
}

// ---------- hub invoice detail actions (tests/hub-e2e/invoices/invoice-actions.spec.ts) ----------

/** Latest unpaid Circuly (TR_) invoice with no claim and not cancelled — "Mark as paid" / "Block auto-claim" work on it, or undefined. */
export function findUnpaidInvoiceForActions(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; invoice_number: string }>(
    `SELECT i.id, i.invoice_number
       FROM public.invoices i
       JOIN public.transactions t ON t.transaction_id = i.transaction_id AND t.company_id = i.company_id
      WHERE i.company_id = $1
        AND i.paid = false
        AND i.claim_id IS NULL
        AND i.cancelled_invoice_id IS NULL
        AND i.auto_claim_blocked IS NOT TRUE
        AND t.transaction_id ILIKE 'TR_%'
        AND t.status NOT IN ('succeeded', 'in debt collection')
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** Latest unpaid invoice whose card payment (pi_) failed — "Charge invoice" is offered for it, or undefined. */
export function findFailedCardInvoice(hub: Database, companyId: string) {
  return hub.maybeOne<{ id: string; invoice_number: string; transaction_id: string }>(
    `SELECT i.id, i.invoice_number, i.transaction_id
       FROM public.invoices i
       JOIN public.transactions t ON t.transaction_id = i.transaction_id AND t.company_id = i.company_id
      WHERE i.company_id = $1 AND i.paid = false AND i.claim_id IS NULL
        AND t.status = 'failed' AND t.transaction_id LIKE 'pi_%'
      ORDER BY i.created_at DESC
      LIMIT 1`,
    [companyId],
  );
}

/** paid flag of an invoice, or undefined. */
export async function isInvoicePaid(hub: Database, id: string | number) {
  const row = await hub.maybeOne<{ paid: boolean }>('SELECT paid FROM public.invoices WHERE id = $1', [id]);
  return row?.paid;
}

/** auto_claim_blocked of an invoice (true = skipped by automatic debt collection), or undefined. */
export async function isAutoClaimBlocked(hub: Database, id: string | number) {
  const row = await hub.maybeOne<{ auto_claim_blocked: boolean | null }>('SELECT auto_claim_blocked FROM public.invoices WHERE id = $1', [id]);
  return row?.auto_claim_blocked ?? false;
}

/** Unblocks the automatic claim again (cleanup of the "Block auto-claim" test). */
export function unblockAutoClaim(hub: Database, id: string | number) {
  return hub.query(
    'UPDATE public.invoices SET auto_claim_blocked = false, auto_claim_block_reason = NULL, auto_claim_blocked_by_user_id = NULL, auto_claim_blocked_at = NULL WHERE id = $1',
    [id],
  );
}

/** claim_id of an invoice (set once it is in debt collection), or null/undefined. */
export async function getInvoiceClaimId(hub: Database, id: string | number) {
  const row = await hub.maybeOne<{ claim_id: string | null }>('SELECT claim_id FROM public.invoices WHERE id = $1', [id]);
  return row?.claim_id;
}

/** Status of the transaction behind an invoice ('failed', 'succeeded', 'pending' ...), or undefined. */
export async function getInvoiceTransactionStatus(hub: Database, id: string | number) {
  const row = await hub.maybeOne<{ status: string }>(
    `SELECT t.status FROM public.invoices i
       JOIN public.transactions t ON t.transaction_id = i.transaction_id AND t.company_id = i.company_id
      WHERE i.id = $1`,
    [id],
  );
  return row?.status;
}

// ---------- CSS "Outstanding amount" (tests/css-e2e/02-outstanding-amount.spec.ts) ----------

/** Invoice number ("invoice-_24110") of an invoice id. Throws if none. */
export async function getInvoiceNumber(hub: Database, id: string | number): Promise<string> {
  const row = await hub.one<{ invoice_number: string }>('SELECT invoice_number FROM public.invoices WHERE id = $1', [id]);
  return row.invoice_number;
}

/** Sets invoices.paid for one invoice_number (test setup: makes a paid invoice "outstanding"). */
export function setInvoicePaidByNumber(hub: Database, invoiceNumber: string, paid: boolean) {
  return hub.query('UPDATE public.invoices SET paid = $2 WHERE invoice_number = $1', [invoiceNumber, paid]);
}

/** true / false = invoices.paid of an invoice_number, or undefined if not found. */
export async function isInvoicePaidByNumber(hub: Database, invoiceNumber: string) {
  const row = await hub.maybeOne<{ paid: boolean }>('SELECT paid FROM public.invoices WHERE invoice_number = $1', [invoiceNumber]);
  return row?.paid;
}
