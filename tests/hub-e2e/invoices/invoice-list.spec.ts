// test, expect  ← src/fixtures/index.ts
// countInvoices, getCancelledInvoiceId, findRefundableRecurringInvoice ← src/db/queries/hub/invoices.ts
import { test, expect } from '@fixtures';
import { countInvoices, getCancelledInvoiceId, findRefundableRecurringInvoice } from '@db/queries/hub/invoices';

/**
 * WHAT:   Hub UI → Invoices list + invoice detail: search, filters vs database, refund, cancel, PDF.
 * FROM:   hub-e2e-automation cypress/e2e/04-invoice-page/invoiceListpage.cy.js (8 tests).
 * NEEDS:  paid recurring-payment invoices of open visa checkout orders (never refunded/cancelled).
 * CHANGES DATA: yes — FULL REFUND of one invoice, then a PARTIAL REFUND (0.01 €) of the next, CANCEL (+ regenerate) of another.
 * invoiceListPage methods ← src/pages/hub/InvoiceListPage.ts
 * findRefundableRecurringInvoice(db, company, nth): nth 0 = newest suitable invoice (full refund), 1 = the one before
 *   (partial refund), 2 = the one before that (cancel). No DB check after "Successfully requested!" (owner).
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - invoices', () => {
  // Before each test: open /en/cms/invoices
  test.beforeEach(async ({ invoiceListPage }) => {
    await invoiceListPage.goto();
  });

  test('finds an invoice by number', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: a suitable invoice ← hub db
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);

    // ACTION: clear filters left from earlier tests (the list remembers them), then search
    await invoiceListPage.clearAllFilters();
    // ACTION + CHECK: search() types the number and waits until the first row shows it
    await invoiceListPage.search(invoice.invoice_number);
  });

  test('filters by status Succeeded + Settled', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: clear, then Status = Succeeded AND Settled (multi-select)
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByStatus('Succeeded', 'Settled');

    // CHECK: some invoices shown
    await expect.poll(() => invoiceListPage.totalCount()).toBeGreaterThan(0);
    // INFO only (Cypress only logged it): database count → report annotation
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { transactionStatuses: ['succeeded', 'settled'] });
    test.info().annotations.push({ type: 'database total', description: String(dbTotal) });
  });

  test('filters by type Recurring payment and matches the database', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: clear, then Type = Recurring payment
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByType('Recurring payment');
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { type: 'recurring payment' });

    // CHECK: UI total = database count
    await expect.poll(() => invoiceListPage.totalCount()).toBe(dbTotal);
  });

  test('filters by payment status Paid and matches the database', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: clear, then Payment status = Paid
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByPaymentStatus('Paid');
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { paid: true });

    // CHECK
    await expect.poll(() => invoiceListPage.totalCount()).toBe(dbTotal);
  });

  test('opens a paid recurring-payment invoice', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);

    // ACTION + CHECK: search → click the row link → URL contains /invoices/
    await invoiceListPage.openInvoice(invoice.invoice_number);
  });

  test('fully refunds a paid invoice', async ({ invoiceListPage, db, hubCompanyId, page }) => {
    // SETUP: open the newest suitable invoice
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);
    test.info().annotations.push({ type: 'invoice', description: invoice.invoice_number });
    await invoiceListPage.openInvoice(invoice.invoice_number);

    // ACTION: Refund → switch "Full refund" → Refund → "Successfully requested!"
    await invoiceListPage.fullRefund();

    // CHECK: the invoice now shows the "fully refunded" badge
    await expect(page.getByText('fully refunded').first(), `"fully refunded" badge on invoice ${invoice.invoice_number}`).toBeVisible();
  });

  // Runs right AFTER the full refund (owner's order: full refund first, then partial).
  // The refund of the full-refund test can take a while to reach the DB, so its invoice may still match the
  // query → this test takes the SECOND suitable invoice (nth = 1).
  test('refunds 0.01 € of one invoice line (partial refund)', async ({ invoiceListPage, db, hubCompanyId, page }) => {
    // SETUP: second newest paid recurring-payment invoice never refunded ← hub db
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId, 1);
    test.info().annotations.push({ type: 'invoice', description: invoice.invoice_number });
    await invoiceListPage.openById(invoice.id);

    // ACTION + CHECK: Refund invoice → tick the first line → 0.01 → Refund → "Successfully requested!"
    //                 (no DB check after that message — the refund invoice can take a while to be created; owner 2026-09-29)
    await invoiceListPage.refundFirstLine('0.01');

    // CHECK: the invoice is NOT shown as fully refunded (v2.23 fix: partial refunds set the full-refund flag)
    await page.reload();
    await expect(page.getByText('fully refunded'), 'partly refunded invoice must not say "fully refunded"').toHaveCount(0);
  });

  test('cancels an invoice and generates a new one', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: the THIRD newest suitable invoice (nth = 2) — nth 0 and 1 were refunded above (their refund may not be in the DB yet)
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId, 2);
    await invoiceListPage.openInvoice(invoice.invoice_number);

    // ACTION: Cancel invoice → cancel page → "generate a new invoice" → Cancel → close
    await invoiceListPage.cancelAndRegenerate();

    // CHECK: cancelled_invoice_id is set on that invoice in the database
    await expect
      .poll(() => getCancelledInvoiceId(db.hub, invoice.id), { message: `cancelled_invoice_id of invoice ${invoice.invoice_number}` })
      .not.toBeNull();
  });

  test('downloads the invoice PDF', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: open a suitable invoice
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);
    await invoiceListPage.openInvoice(invoice.invoice_number);

    // ACTION + CHECK: click "PDF"; downloadPdf() returns the HTTP status of the invoice request
    expect(await invoiceListPage.downloadPdf(), `PDF download status of invoice ${invoice.invoice_number}`).toBe(200);
  });
});
