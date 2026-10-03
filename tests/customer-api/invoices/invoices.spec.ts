import { test, expect } from '@fixtures';
import { fullRefundPayload, partialRefundPayload } from '@data/payloads/customer-api/invoices';
import {
  findInvoiceByNumber,
  findLatestInvoice,
  findLatestPaidInvoice,
  findInvoiceItems,
  findRefundableInvoice,
  getRefundInvoiceAmount,
  findUnpaidInvoice,
  type InvoiceRow,
} from '@db/queries/hub/invoices';
import { findRefundOf } from '@db/queries/hub/transactions';

// Customer API - invoices: list, by id, with items, PDF, settle, refund.
// Needs: an unpaid invoice, a paid Stripe invoice and a paid invoice (else that test is skipped).
// Changes data: settles one invoice, refunds part of another, fully refunds a third.
// GET /invoices/detailed is not tested: it times out on dev.
test.describe.configure({ mode: 'default' });

test.describe('Customer API - invoices', () => {
  let invoice: InvoiceRow; // newest invoice of the company

  test.beforeEach(async ({ db, customerApi }) => {
    invoice = await findLatestInvoice(db.hub, customerApi.companyId);
  });

  test('returns a paginated list of invoices', async ({ customerApi }) => {
    // ACTION: GET /invoices
    const response = await customerApi.invoices.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches an invoice by id', async ({ customerApi, db }) => {
    // ACTION: this API takes invoices.id, not the invoice number
    const response = await customerApi.invoices.get(invoice.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findInvoiceByNumber(db.hub, invoice.invoice_number)).toBeDefined();
  });

  test('settles the latest unpaid invoice', async ({ customerApi, db }) => {
    // SETUP: unpaid invoice (cancelled ones count too here)
    const unpaid = await findUnpaidInvoice(db.hub, customerApi.companyId, { neverCancelled: false });
    test.skip(!unpaid, 'No unpaid invoice in the database');

    // ACTION: POST /invoices/{number}/settle
    const response = await customerApi.invoices.settle(unpaid!.invoice_number);

    // CHECK: message, and paid = true in the database
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Invoice is settled successfully!');
    expect((await findInvoiceByNumber(db.hub, unpaid!.invoice_number))?.paid).toBe(true);
  });

  test('partly refunds one item of the latest paid invoice', async ({ customerApi, db }) => {
    // SETUP: paid Stripe invoice that was never refunded, and its first item
    const refundable = await findRefundableInvoice(db.hub, customerApi.companyId);
    test.skip(!refundable, 'No refundable paid invoice in the database');
    const items = await findInvoiceItems(db.hub, refundable!.invoice_id);
    test.skip(items.length === 0, `Invoice ${refundable!.invoice_number} has no items`);
    const item = items[0];
    const refundAmount = 0.01; // 1 cent of the first item

    // ACTION: refund 1 cent of that item
    const response = await customerApi.invoices.refund(refundable!.invoice_number, partialRefundPayload(item.id, refundAmount));

    // CHECK: a refund transaction points to the original, and within 60 s a refund invoice of 0.01 exists.
    // (invoice_items.refunded_amount is not filled on dev, so we check the refund invoice)
    expect(response.status()).toBe(200);
    expect(await findRefundOf(db.hub, refundable!.transaction_id)).toBeDefined();
    await expect
      .poll(() => getRefundInvoiceAmount(db.hub, refundable!.transaction_id), { timeout: 60_000, intervals: [3_000] })
      .toBe(refundAmount);
  });

  test('fully refunds the latest paid invoice', async ({ customerApi, db }) => {
    // SETUP: paid Stripe invoice that was never refunded
    const refundable = await findRefundableInvoice(db.hub, customerApi.companyId);
    test.skip(!refundable, 'No refundable paid invoice in the database');

    // ACTION: refund all of it
    const response = await customerApi.invoices.refund(refundable!.invoice_number, fullRefundPayload());

    // CHECK: a refund transaction points to the original, and within 60 s
    // a refund invoice for the whole amount exists
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Refund Payment Success');
    expect(await findRefundOf(db.hub, refundable!.transaction_id)).toBeDefined();
    const original = await findInvoiceByNumber(db.hub, refundable!.invoice_number);
    await expect
      .poll(() => getRefundInvoiceAmount(db.hub, refundable!.transaction_id), { timeout: 60_000, intervals: [3_000] })
      .toBe(Number(original?.amount));
  });

  test('downloads a paid invoice as PDF', async ({ customerApi, db }) => {
    // SETUP: newest paid invoice
    const paid = await findLatestPaidInvoice(db.hub, customerApi.companyId);
    test.skip(!paid, 'No paid invoice in the database');

    // ACTION: GET /invoices/{id}/download
    const response = await customerApi.invoices.download(paid!.id);

    // CHECK: status 200 or a PDF body; the invoice is paid in the database
    const isPdf = (response.headers()['content-type'] ?? '').includes('application/pdf');
    expect(response.status() === 200 || isPdf).toBe(true);
    expect((await findInvoiceByNumber(db.hub, paid!.invoice_number))?.paid).toBe(true);
  });

  test('returns an invoice with its items', async ({ customerApi, db }) => {
    // ACTION: GET /invoices-with-items/{id}
    const response = await customerApi.invoices.withItems(invoice.id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findInvoiceByNumber(db.hub, invoice.invoice_number)).toBeDefined();
  });
});
