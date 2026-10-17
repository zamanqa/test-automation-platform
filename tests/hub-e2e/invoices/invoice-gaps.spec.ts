import dayjs from 'dayjs';
import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import { findUnpaidInvoiceForActions, isAutoClaimBlocked, unblockAutoClaim } from '@db/queries/hub/invoices';
import {
  countAllEInvoices,
  countCompanyInvoices,
  countEInvoices,
  findInvoiceOfType,
  findInvoiceWithoutEInvoice,
  findInvoiceWithTransactions,
  getInvoiceBody,
  getInvoiceUpdatedAt,
  getLastUploadId,
  hasNewZipUpload,
  setAutoClaimBlocked,
  setInvoiceBody,
} from '@db/queries/hub/invoices-more';

// Hub → invoices: the cases that were missing - regenerate PDF, e-invoice downloads, unblock auto-claim, edit,
// bulk download, type filter, refund limit, disabled buttons of a paid invoice, payments table, no email action + PDF writes e-invoice rows.
// Changes data: regenerates one PDF, writes e-invoice rows, edits one invoice body (old body put back),
// blocks/unblocks auto-claim of one unpaid invoice, starts one zip download.
test.describe.configure({ mode: 'default' });

test.describe('Hub - invoice gaps', () => {
  test('I1 Regenerate pdf updates the invoice', async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP
    const invoice = await findInvoiceOfType(db.hub, hubCompanyId, 'recurring payment', true);
    test.skip(!invoice?.transaction_id, 'no paid recurring invoice with a transaction');
    const before = await getInvoiceUpdatedAt(db.hub, invoice!.id);

    // ACTION
    await invoiceListPage.openById(invoice!.id);
    await page.getByRole('button', { name: 'Regenerate pdf' }).click();

    // CHECK: "Regenerating..." and a newer updated_at
    await expect(page.getByText('Regenerating...')).toBeVisible();
    await expect.poll(() => getInvoiceUpdatedAt(db.hub, invoice!.id), { message: `updated_at of ${invoice!.invoice_number}`, timeout: 30_000 }).not.toBe(before);
  });

  test('I2 e-invoice downloads (ZUGFeRD and XRechnung) write e_invoices rows', async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP: the newest cancellation invoice (cancellation, full_refund and partial_refund had no rows on dev)
    const invoice = await findInvoiceOfType(db.hub, hubCompanyId, 'cancellation');
    test.skip(!invoice, 'no cancellation invoice');
    test.info().annotations.push({ type: 'invoice', description: invoice!.invoice_number });

    // ACTION + CHECK: ZUGFeRD
    await invoiceListPage.openById(invoice!.id);
    const zugferd = page.waitForResponse((r) => r.url().includes(`/invoices/${invoice!.id}/e-invoice`));
    await page.getByRole('button', { name: 'Download e-invoice (ZUGFeRD XML)' }).click();
    expect((await zugferd).status(), 'ZUGFeRD download status').toBe(200);
    await expect.poll(() => countEInvoices(db.hub, invoice!.id, 'zugferd'), { message: 'zugferd row' }).toBeGreaterThanOrEqual(1);

    // ACTION + CHECK: XRechnung
    const xrechnung = page.waitForResponse((r) => r.url().includes(`/invoices/${invoice!.id}/e-invoice`));
    await page.getByRole('button', { name: 'Download XRechnung (XML)' }).click();
    expect((await xrechnung).status(), 'XRechnung download status').toBe(200);
    await expect.poll(() => countEInvoices(db.hub, invoice!.id, 'xrechnung'), { message: 'xrechnung row' }).toBeGreaterThanOrEqual(1);
  });

  test('I3 unblocks the automatic claim of an invoice', async ({ db, hubCompanyId, invoiceListPage, page, cleanup }) => {
    // SETUP: an unpaid invoice that is blocked
    const invoice = await findUnpaidInvoiceForActions(db.hub, hubCompanyId);
    test.skip(!invoice, 'no unpaid invoice');
    await setAutoClaimBlocked(db.hub, invoice!.id, true);
    cleanup.add('unblock auto-claim', () => unblockAutoClaim(db.hub, invoice!.id));

    // ACTION
    await invoiceListPage.openById(invoice!.id);
    await page.getByRole('button', { name: 'Unblock auto-claim' }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: /Unblock auto.claim/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Submit' }).click();

    // CHECK
    await expect.poll(() => isAutoClaimBlocked(db.hub, invoice!.id), { message: `auto_claim_blocked of ${invoice!.invoice_number}` }).toBe(false);
  });

  test('I4 edits the invoice text', async ({ db, hubCompanyId, page, cleanup }) => {
    // SETUP
    const invoice = await findInvoiceOfType(db.hub, hubCompanyId, 'recurring payment', true);
    test.skip(!invoice, 'no paid recurring invoice');
    const oldBody = await getInvoiceBody(db.hub, invoice!.id);
    cleanup.add('old invoice body back', () => setInvoiceBody(db.hub, invoice!.id, oldBody));
    const marker = testName('invoice_edit');

    // ACTION: Edit invoice → Make editable → type at the end → Submit changes
    await page.goto(`en/cms/invoices/${invoice!.id}/edit`);
    await page.getByRole('button', { name: 'Make editable' }).click();
    const body = page.frameLocator('main iframe').locator('body');
    await body.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(` ${marker}`);
    await page.getByRole('button', { name: 'Submit changes' }).click();
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Edit invoice' }) });
    await confirm.getByRole('button', { name: 'Submit' }).click();

    // CHECK: the saved body contains the new text
    await expect.poll(() => getInvoiceBody(db.hub, invoice!.id), { message: 'invoice body' }).toContain(marker);
  });

  test('I5 bulk download of 2 selected invoices is started', async ({ db, hubCompanyId, page }) => {
    // SETUP
    const lastUpload = await getLastUploadId(db.hub);
    const from = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    const to = dayjs().format('YYYY-MM-DD');

    // ACTION: paid recurring invoices of the last 30 days → tick 2 → Invoices → download
    await page.goto(`en/cms/invoices?type=recurring%20payment&paid=true&created_at=between:${from}and${to}`);
    const boxes = page.locator('tbody input[type="checkbox"]');
    await expect(boxes.nth(1)).toBeVisible();
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole('button', { name: 'Invoices', exact: true }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Download invoices' })).toBeVisible();
    await dialog.locator('[data-cy="btn-submit"]').click();

    // CHECK: a zip upload was started for the company
    await expect.poll(() => hasNewZipUpload(db.hub, hubCompanyId, lastUpload), { message: 'zip upload' }).toBe(true);
  });

  test('I6 type filter "cumulated invoice" matches the database', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countCompanyInvoices(db.hub, hubCompanyId, 'cumulated invoice');
    test.skip(expected === 0, 'no cumulated invoice');

    // ACTION
    await hubListPage.open('invoices', { type: 'cumulated invoice', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'cumulated invoices');
  });

  test('I7 refund above the line amount is refused', async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP
    const invoice = await findInvoiceOfType(db.hub, hubCompanyId, 'recurring payment', true);
    test.skip(!invoice, 'no paid recurring invoice');
    const before = await countCompanyInvoices(db.hub, hubCompanyId);

    // ACTION: Refund invoice → tick the first line → amount 99999
    await invoiceListPage.openById(invoice!.id);
    await page.getByRole('button', { name: 'Refund invoice' }).click();
    const dialog = page.getByRole('dialog').last();
    const firstLine = dialog.locator('tbody tr').first();
    await firstLine.getByRole('checkbox').check();
    await firstLine.getByRole('textbox').or(firstLine.getByRole('spinbutton')).first().fill('99999');
    await dialog.getByRole('button', { name: /^Refund\s/ }).click();

    // CHECK: validation message and no new invoice
    await expect(dialog.getByText('Refund amount must be equal or less than the remaining invoiced amount')).toBeVisible();
    expect(await countCompanyInvoices(db.hub, hubCompanyId)).toBe(before);
  });

  test('I8 a paid invoice cannot be marked as paid or charged', async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP
    const invoice = await findInvoiceOfType(db.hub, hubCompanyId, 'recurring payment', true);
    test.skip(!invoice, 'no paid recurring invoice');

    // ACTION
    await invoiceListPage.openById(invoice!.id);

    // CHECK
    await expect(page.getByRole('button', { name: 'Mark as paid' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Charge invoice', exact: true })).toBeDisabled();
  });

  test('I10 the invoice page has no email action; the PDF download writes the e-invoice rows', async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP: invoice emails go out from the payment page ("Payment - Successful", see payments.spec P6)
    const invoice = await findInvoiceWithoutEInvoice(db.hub, hubCompanyId);
    test.skip(!invoice, 'every paid recurring invoice already has e-invoice rows');
    test.info().annotations.push({ type: 'invoice', description: invoice!.invoice_number });

    // ACTION
    await invoiceListPage.openById(invoice!.id);

    // CHECK: no email button or menu item on the invoice page
    await expect(page.locator('main').getByRole('button', { name: /email/i })).toHaveCount(0);
    await expect(page.locator('[data-tw-tooltip]', { hasText: 'Resend email' })).toHaveCount(0);

    // ACTION: PDF
    expect(await invoiceListPage.downloadPdf(), 'PDF answer').toBe(200);

    // CHECK: e_invoices rows were written for the invoice
    await expect.poll(() => countAllEInvoices(db.hub, invoice!.id), { message: `e_invoices of ${invoice!.invoice_number}`, timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  });

  test('I9 the payments table shows the transactions of the invoice',async ({ db, hubCompanyId, invoiceListPage, page }) => {
    // SETUP
    const invoice = await findInvoiceWithTransactions(db.hub, hubCompanyId);
    test.skip(!invoice, 'no invoice with 2 or more transactions');

    // ACTION
    await invoiceListPage.openById(invoice!.id);

    // CHECK: one row per transaction
    const table = page.getByRole('heading', { name: 'Payments' }).locator('xpath=following::table[1]');
    await expect(table.locator('tbody tr')).toHaveCount(invoice!.transaction_ids.length);
  });
});
