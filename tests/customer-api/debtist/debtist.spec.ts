// test, expect ← src/fixtures/index.ts
// ...          ← src/db/queries/hub/debtist.ts (debtist_claims = debt-collection cases)
import { test, expect } from '@fixtures';
import {
  backdateInvoiceAsFailed,
  findClaim,
  findClaimableInvoice,
  findLatestClaim,
  firstInvoiceIdOf,
} from '@db/queries/hub/debtist';

/**
 * WHAT:   OLD Customer API — /debtist (debt collection).
 * FROM:   cus-api cypress/e2e/customer-api/16-debtist/debtist.cy.js (5 tests).
 * CHANGES DATA: yes — backdates one invoice/transaction by 3 days (failed) and files a claim;
 *         uploads a small test PDF to the newest claim (sent to Debtist dev).
 */

/** Some endpoints return a bare array, others { data: [...] } — this returns the list either way. */
async function listIn(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as unknown[] | { data: unknown[] };
  return Array.isArray(body) ? body : body.data;
}

test.describe('Customer API - debtist (debt collection)', () => {
  test('returns a list of claims', async ({ customerApi }) => {
    // ACTION: GET /debtist/claims
    const response = await customerApi.debtist.claims();

    // CHECK: paginated list with at least one claim
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.is_paginated).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('fetches a claim by id', async ({ customerApi, db }) => {
    // SETUP: newest claim ← hub db (companyId ← .env)
    const claim = await findLatestClaim(db.hub, customerApi.companyId);

    // ACTION: GET /debtist/claims/{claim_id}
    const response = await customerApi.debtist.claim(claim.claim_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findClaim(db.hub, customerApi.companyId, claim.claim_id)).toBeDefined();
  });

  test('fetches the claim of an invoice', async ({ customerApi, db }) => {
    // SETUP: first invoice id of the newest claim
    const claim = await findLatestClaim(db.hub, customerApi.companyId);
    const invoiceId = firstInvoiceIdOf(claim);
    expect(invoiceId).toBeTruthy();

    // ACTION: GET /debtist/invoice/{invoiceId}/claim
    const response = await customerApi.debtist.claimOfInvoice(invoiceId);

    // CHECK
    expect(response.status()).toBe(200);
  });

  test('uploads a PDF to a claim and downloads it again', async ({ customerApi, db }) => {
    // SETUP: first invoice of the newest claim; a tiny PDF with a unique name
    const claim = await findLatestClaim(db.hub, customerApi.companyId);
    const invoiceId = firstInvoiceIdOf(claim);
    const fileName = `qa_auto_claim_${Date.now()}.pdf`;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

    // ACTION: POST /debtist/invoice/{invoiceId}/uploads (form-data "file")
    const upload = await customerApi.debtist.uploadFile(invoiceId, fileName, pdf);

    // CHECK: uploaded; upload_id = "media/<folder>/<date>-<code>-<file name>"
    expect(upload.status()).toBe(201);
    const { success, upload_id } = await upload.json();
    expect(success).toBe(true);
    expect(upload_id).toContain(fileName);

    // ACTION: GET /debtist/invoice/{invoiceId}/uploads/{upload_id}
    const download = await customerApi.debtist.downloadFile(invoiceId, upload_id);

    // CHECK: we get a PDF back
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain('application/pdf');
    expect((await download.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('files a claim for an overdue invoice', async ({ customerApi, db }) => {
    // SETUP: unpaid invoice without claim → make it "overdue + failed" in the database
    const invoice = await findClaimableInvoice(db.hub, customerApi.companyId);
    await backdateInvoiceAsFailed(db.hub, customerApi.companyId, invoice.transaction_id);

    // ACTION: POST /debtist/invoice/{invoice_id}/claim
    const response = await customerApi.debtist.fileClaim(invoice.invoice_id);

    // CHECK
    expect([200, 201]).toContain(response.status());
  });

  test('returns debtist invoices', async ({ customerApi }) => {
    // ACTION: GET /debtist/invoices
    const response = await customerApi.debtist.invoices();

    // CHECK: a list (may be empty)
    expect(response.status()).toBe(200);
    expect(Array.isArray(await listIn(response))).toBe(true);
  });

  test('returns debtist customers', async ({ customerApi }) => {
    // ACTION: GET /debtist/customers
    const response = await customerApi.debtist.customers();

    // CHECK: a list (may be empty)
    expect(response.status()).toBe(200);
    expect(Array.isArray(await listIn(response))).toBe(true);
  });
});
