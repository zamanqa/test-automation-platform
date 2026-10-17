import type { Database } from '@db/connection';

/** Queries for the extra hub debt-collection tests (download, timeline, financial details, payments, bad upload, banner). */

export type ClaimDetails = {
  claim_id: string;
  reference: string;
  file_urls: string[];
  payment_count: number;
  original_amount_due: string;
  total_paid: string;
  invoice_sum: string | null;
};

/** Newest claim of the company that has files and payments, with the sum of its invoices, or undefined. */
export async function findClaimWithPayments(hub: Database, companyId: string) {
  const row = await hub.maybeOne<Omit<ClaimDetails, 'file_urls'> & { file_urls: string }>(
    `SELECT c.claim_id, c.reference, c.file_urls #>> '{}' AS file_urls,
            jsonb_array_length(c.payments) AS payment_count, c.original_amount_due, c.total_paid,
            (SELECT SUM(i.amount) FROM public.invoices i
              WHERE i.id::text IN (SELECT jsonb_array_elements_text(c.invoice_ids))) AS invoice_sum
       FROM public.debtist_claims c
      WHERE c.company_id = $1 AND jsonb_typeof(c.payments) = 'array' AND jsonb_array_length(c.payments) > 0
        AND c.file_urls::text LIKE '%media/%'
      ORDER BY c.created_at DESC LIMIT 1`,
    [companyId],
  );
  if (!row) return undefined;
  // file_urls is saved as a JSON text inside jsonb
  const files = JSON.parse(row.file_urls) as string[] | string;
  return { ...row, payment_count: Number(row.payment_count), file_urls: Array.isArray(files) ? files : [files] };
}

/** true when the claim's activities contain this comment text. */
export async function claimHasComment(hub: Database, claimId: string, comment: string): Promise<boolean> {
  const row = await hub.one<{ found: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM public.debtist_claims WHERE claim_id = $1 AND activities::text LIKE '%' || $2 || '%') AS found`,
    [claimId, comment],
  );
  return row.found;
}

/** file_urls of a claim as text (compared before and after an upload). */
export async function getClaimFiles(hub: Database, claimId: string): Promise<string> {
  const row = await hub.one<{ files: string | null }>('SELECT file_urls::text AS files FROM public.debtist_claims WHERE claim_id = $1', [claimId]);
  return row.files ?? '';
}

/** Blocks the automatic claim of an invoice with a reason (test setup for the banner). */
export function blockAutoClaimWithReason(hub: Database, id: string, reason: string) {
  return hub.query('UPDATE public.invoices SET auto_claim_blocked = true, auto_claim_block_reason = $2, auto_claim_blocked_at = now() WHERE id = $1', [id, reason]);
}
