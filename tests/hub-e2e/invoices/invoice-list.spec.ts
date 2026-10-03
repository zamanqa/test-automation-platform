import { test, expect } from '@fixtures';
import { countInvoices, getCancelledInvoiceId, findRefundableRecurringInvoice } from '@db/queries/hub/invoices';

// Hub → Invoices list and invoice page: search, filters, refund, cancel, PDF.
// Needs: paid recurring payment invoices of open visa checkout orders, never refunded or cancelled.
// Changes data: full refund of one invoice, partial refund (0.01 €) of the next, cancels a third.
// findRefundableRecurringInvoice(..., nth): 0 = newest (full refund), 1 = the one before (partial refund),
// 2 = the one before that (cancel). After "Successfully requested!" the database is not checked.
test.describe.configure({ mode: 'default' });

test.describe('Hub - invoices', () => {
  test.beforeEach(async ({ invoiceListPage }) => {
    await invoiceListPage.goto();
  });

  test('finds an invoice by number', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: a suitable invoice
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);

    // ACTION + CHECK: clear old filters (the list remembers them), search, the first row shows the invoice
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.search(invoice.invoice_number);
  });

  test('filters by status Succeeded + Settled', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: Status = Succeeded and Settled
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByStatus('Succeeded', 'Settled');

    // CHECK: some invoices shown
    await expect.poll(() => invoiceListPage.totalCount()).toBeGreaterThan(0);
    // INFO only: the database count is shown in the report
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { transactionStatuses: ['succeeded', 'settled'] });
    test.info().annotations.push({ type: 'database total', description: String(dbTotal) });
  });

  test('filters by type Recurring payment and matches the database', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: Type = Recurring payment
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByType('Recurring payment');
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { type: 'recurring payment' });

    // CHECK: the total on the page = the database count
    await expect.poll(() => invoiceListPage.totalCount()).toBe(dbTotal);
  });

  test('filters by payment status Paid and matches the database', async ({ invoiceListPage, db, hubCompanyId }) => {
    // ACTION: Payment status = Paid
    await invoiceListPage.clearAllFilters();
    await invoiceListPage.filterByPaymentStatus('Paid');
    const dbTotal = await countInvoices(db.hub, hubCompanyId, { paid: true });

    // CHECK
    await expect.poll(() => invoiceListPage.totalCount()).toBe(dbTotal);
  });

  test('opens a paid recurring-payment invoice', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);

    // ACTION + CHECK: search, click the row, the invoice page opens
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

  // Runs after the full refund. That refund can take a while to reach the database,
  // so this test takes the second invoice (nth = 1).
  test('refunds 0.01 € of one invoice line (partial refund)', async ({ invoiceListPage, db, hubCompanyId, page }) => {
    // SETUP: second newest suitable invoice
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId, 1);
    test.info().annotations.push({ type: 'invoice', description: invoice.invoice_number });
    await invoiceListPage.openById(invoice.id);

    // ACTION + CHECK: Refund invoice → tick the first line → 0.01 → Refund → "Successfully requested!"
    await invoiceListPage.refundFirstLine('0.01');

    // CHECK: the invoice is not shown as fully refunded (bug fixed in v2.23)
    await page.reload();
    await expect(page.getByText('fully refunded'), 'partly refunded invoice must not say "fully refunded"').toHaveCount(0);
  });

  test('cancels an invoice and generates a new one', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: third newest suitable invoice (0 and 1 were refunded above)
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId, 2);
    await invoiceListPage.openInvoice(invoice.invoice_number);

    // ACTION: Cancel invoice → cancel page → "generate a new invoice" → Cancel → close
    await invoiceListPage.cancelAndRegenerate();

    // CHECK: cancelled_invoice_id is set in the database
    await expect
      .poll(() => getCancelledInvoiceId(db.hub, invoice.id), { message: `cancelled_invoice_id of invoice ${invoice.invoice_number}` })
      .not.toBeNull();
  });

  test('downloads the invoice PDF', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: open a suitable invoice
    const invoice = await findRefundableRecurringInvoice(db.hub, hubCompanyId);
    await invoiceListPage.openInvoice(invoice.invoice_number);

    // ACTION + CHECK: click PDF, the request answers 200
    expect(await invoiceListPage.downloadPdf(), `PDF download status of invoice ${invoice.invoice_number}`).toBe(200);
  });
});
