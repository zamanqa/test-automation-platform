import { test, expect } from '@fixtures';
import {
  backdateInvoiceAsFailed,
  findClaim,
  findClaimableInvoice,
  findLatestClaim,
  firstInvoiceIdOf,
} from '@db/queries/hub/debtist';

// Unified API - /debtist (debt collection).
// Needs: an existing claim; an unpaid invoice without claim.
// Changes data: backdates one invoice + transaction by 3 days, marks it failed,
// and files a debt-collection claim for it.

// some endpoints return a plain list, others { data: [...] }
async function listIn(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as unknown[] | { data: unknown[] };
  return Array.isArray(body) ? body : body.data;
}

test.describe('Unified API - debtist (debt collection)', () => {
  test('fetches a claim by id', async ({ unifiedApi, db }) => {
    // SETUP: newest claim
    const companyId = await unifiedApi.companyId();
    const claim = await findLatestClaim(db.hub, companyId);

    // ACTION: GET /debtist/claims/{claim_id}
    const response = await unifiedApi.debtist.claim(claim.claim_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findClaim(db.hub, companyId, claim.claim_id)).toBeDefined();
  });

  test('fetches the claim of an invoice', async ({ unifiedApi, db }) => {
    // SETUP: first invoice id of the newest claim (invoice_ids is a list in the db)
    const claim = await findLatestClaim(db.hub, await unifiedApi.companyId());
    const invoiceId = firstInvoiceIdOf(claim);
    expect(invoiceId).toBeTruthy();

    // ACTION: GET /debtist/invoice/{invoiceId}/claim
    const response = await unifiedApi.debtist.claimOfInvoice(invoiceId);

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('files a claim for an overdue invoice', async ({ unifiedApi, db }) => {
    // SETUP: latest unpaid invoice without claim, then make it "overdue + failed" in the database
    // (claims are only allowed for overdue failed payments)
    const companyId = await unifiedApi.companyId();
    const invoice = await findClaimableInvoice(db.hub, companyId);
    await backdateInvoiceAsFailed(db.hub, companyId, invoice.transaction_id);

    // ACTION: POST /debtist/invoice/{invoice_id}/claim
    const response = await unifiedApi.debtist.fileClaim(invoice.invoice_id);

    // CHECK
    expect([200, 201]).toContain(response.status());
  });

  test('returns debtist invoices', async ({ unifiedApi }) => {
    // ACTION: GET /debtist/invoices
    const response = await unifiedApi.debtist.invoices();

    // CHECK: a list (may be empty)
    expect(response.status()).toBe(200);
    expect(Array.isArray(await listIn(response))).toBe(true);
  });

  test('returns debtist customers', async ({ unifiedApi }) => {
    // ACTION: GET /debtist/customers
    const response = await unifiedApi.debtist.customers();

    // CHECK: a list (may be empty)
    expect(response.status()).toBe(200);
    expect(Array.isArray(await listIn(response))).toBe(true);
  });
});
