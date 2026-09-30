// test, expect                    ← src/fixtures/index.ts
// partialRefundPayload            ← src/data/payloads/unified-api/invoices.ts (refund 0.10 body)
// find...Invoice...               ← src/db/queries/hub/invoices.ts
// findRefundOf                    ← src/db/queries/hub/transactions.ts
import { test, expect } from '@fixtures';
import { partialRefundPayload } from '@data/payloads/unified-api/invoices';
import { findInvoiceByNumber, findLatestInvoice, findRefundableInvoice, findUnpaidInvoice } from '@db/queries/hub/invoices';
import { findRefundOf } from '@db/queries/hub/transactions';

/**
 * WHAT:   Unified Customer API — invoice endpoints.
 * FROM:   unified-customer-api cypress/e2e/customer-api/03-invoices/invoices.cy.js (4 tests).
 * NEEDS:  invoices; an unpaid one (settle) and a paid Stripe one (refund) — else skipped.
 * CHANGES DATA: yes — settles one invoice, refunds 0.10 of another.
 * Labels: SETUP / ACTION / CHECK, "← from:" = where a value comes from.
 */
test.describe.configure({ mode: 'default' });

test.describe('Unified API - invoices', () => {
  test('returns a paginated list of invoices', async ({ unifiedApi }) => {
    // ACTION: GET /paginated-invoices
    const response = await unifiedApi.invoices.list();

    // CHECK: 200 and a non-empty list
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches an invoice by number', async ({ unifiedApi, db }) => {
    // SETUP: latest invoice of the company ← hub db
    const invoice = await findLatestInvoice(db.hub, await unifiedApi.companyId());

    // ACTION: GET /invoices/{invoice_number}
    const response = await unifiedApi.invoices.get(invoice.invoice_number);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findInvoiceByNumber(db.hub, invoice.invoice_number)).toBeDefined();
  });

  test('settles the latest unpaid invoice', async ({ unifiedApi, db }) => {
    // SETUP: latest unpaid, never-cancelled invoice (may not exist → test is skipped)
    const unpaid = await findUnpaidInvoice(db.hub, await unifiedApi.companyId());
    test.skip(!unpaid, 'No unpaid invoice in the database');

    // ACTION: POST /invoices/{number}/settle    (the `!` tells TypeScript "exists here", checked by skip above)
    const response = await unifiedApi.invoices.settle(unpaid!.invoice_number);

    // CHECK: API message, and the invoice is now paid=true in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Invoice is settled successfully!');
    expect((await findInvoiceByNumber(db.hub, unpaid!.invoice_number))?.paid).toBe(true);
  });

  test('partially refunds the latest paid invoice', async ({ unifiedApi, db }) => {
    // SETUP: latest paid Stripe invoice that was never refunded (else skipped)
    const invoice = await findRefundableInvoice(db.hub, await unifiedApi.companyId());
    test.skip(!invoice, 'No refundable paid invoice in the database');

    // ACTION: POST /invoices/{id}/refund — body: refund 0.10 as one product line
    //         invoice_id, order_id ← the row found above
    const response = await unifiedApi.invoices.refund(invoice!.invoice_id, partialRefundPayload(invoice!.invoice_id, invoice!.order_id));

    // CHECK: API answer, and a refund transaction points at the original transaction
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Refund Payment Success'); // was a plain string before 2026-09-28
    expect(await findRefundOf(db.hub, invoice!.transaction_id)).toBeDefined();
  });
});
