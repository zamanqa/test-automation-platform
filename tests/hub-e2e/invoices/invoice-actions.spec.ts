// test, expect ← src/fixtures/index.ts
// invoice queries ← src/db/queries/hub/invoices.ts, claim setup ← debtist.ts
import { test, expect } from '@fixtures';
import { backdateInvoiceAsFailed, findClaimableInvoice } from '@db/queries/hub/debtist';
import {
  findFailedCardInvoice,
  findUnpaidInvoiceForActions,
  getInvoiceClaimId,
  getInvoiceTransactionStatus,
  isAutoClaimBlocked,
  isInvoicePaid,
  unblockAutoClaim,
} from '@db/queries/hub/invoices';

/**
 * WHAT:   Hub UI → invoice detail actions that the Cypress suite did not cover (added 2026-09-28):
 *         mark as paid, block auto-claim, claim unpaid invoice
 *         (→ debt collection), charge invoice.
 * NEEDS:  an unpaid Circuly (TR_) invoice, a failed card invoice
 *         (tests are skipped when the data is missing).
 * CHANGES DATA: yes — marks one invoice paid, blocks auto-claim
 *         (unblocked again), files a claim with Debtist dev, charges a failed card invoice.
 * (The per-line partial refund test is in invoice-list.spec.ts, right after the full refund.)
 * invoiceListPage methods ← src/pages/hub/InvoiceListPage.ts
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - invoice actions', () => {
  test('marks an unpaid invoice as paid', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: unpaid Circuly (TR_) invoice ← hub db (else skipped)
    const invoice = await findUnpaidInvoiceForActions(db.hub, hubCompanyId);
    test.skip(!invoice, 'No unpaid TR_ invoice in the database');
    test.info().annotations.push({ type: 'invoice', description: invoice!.invoice_number });
    await invoiceListPage.openById(invoice!.id);

    // ACTION: Mark as paid → offline transaction id → Submit
    await invoiceListPage.markAsPaid(`qa_auto_offline_${Date.now()}`);

    // CHECK: paid = true in the database
    await expect.poll(() => isInvoicePaid(db.hub, invoice!.id), { message: `paid flag of ${invoice!.invoice_number}` }).toBe(true);
  });

  test('blocks the automatic claim of an unpaid invoice', async ({ invoiceListPage, db, hubCompanyId, cleanup }) => {
    // SETUP: unpaid Circuly invoice ← hub db (else skipped); unblock it again afterwards
    const invoice = await findUnpaidInvoiceForActions(db.hub, hubCompanyId);
    test.skip(!invoice, 'No unpaid TR_ invoice in the database');
    cleanup.add('unblock auto-claim', () => unblockAutoClaim(db.hub, invoice!.id));
    await invoiceListPage.openById(invoice!.id);

    // ACTION: Block auto-claim → reason → Submit
    await invoiceListPage.blockAutoClaim('QA automation: in clarification');

    // CHECK: auto_claim_blocked = true in the database
    await expect.poll(() => isAutoClaimBlocked(db.hub, invoice!.id), { message: `auto_claim_blocked of ${invoice!.invoice_number}` }).toBe(true);
  });

  test('claims an overdue unpaid invoice (debt collection)', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: unpaid invoice without claim ← hub db; make it "overdue + failed" (same as the API debtist test)
    const invoice = await findClaimableInvoice(db.hub, hubCompanyId);
    await backdateInvoiceAsFailed(db.hub, hubCompanyId, invoice.transaction_id);
    test.info().annotations.push({ type: 'invoice id', description: invoice.invoice_id });
    await invoiceListPage.openById(invoice.invoice_id);

    // ACTION: Claim unpaid invoice → confirm
    await invoiceListPage.runAndConfirm('Claim unpaid invoice');

    // CHECK: the invoice gets a claim id (it is now in debt collection)
    await expect
      .poll(() => getInvoiceClaimId(db.hub, invoice.invoice_id), { message: `claim_id of invoice ${invoice.invoice_id}`, timeout: 60_000 })
      .toBeTruthy();
  });

  test('charges an unpaid invoice whose card payment failed', async ({ invoiceListPage, db, hubCompanyId }) => {
    // SETUP: unpaid invoice with a failed card payment ← hub db (else skipped)
    const invoice = await findFailedCardInvoice(db.hub, hubCompanyId);
    test.skip(!invoice, 'No failed card invoice in the database');
    test.info().annotations.push({ type: 'invoice', description: invoice!.invoice_number });
    await invoiceListPage.openById(invoice!.id);

    // ACTION: Charge invoice → confirm
    await invoiceListPage.runAndConfirm('Charge invoice');

    // CHECK: the payment is no longer "failed" (charged again: succeeded, or pending while the provider works)
    await expect
      .poll(() => getInvoiceTransactionStatus(db.hub, invoice!.id), { message: `payment status of ${invoice!.invoice_number}`, timeout: 60_000 })
      .not.toBe('failed');
  });
});
