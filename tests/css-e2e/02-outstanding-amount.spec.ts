import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { payments } from '@data/static/checkout';
import { getInvoiceNumber, isInvoicePaidByNumber, setInvoicePaidByNumber } from '@db/queries/hub/invoices';
import { findTransactionsOfInvoice, setTransactionStatusOfInvoice } from '@db/queries/hub/transactions';

/**
 * WHAT:   CSS "Outstanding amount": a charged invoice of the normal subscription is made unpaid in the DB
 *         (invoices.paid = false, its transactions status = failed) → the CSS dashboard shows "Outstanding amount"
 *         → click → Payment page → pay by card → the invoice is paid again.
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts (invoice ids of the 2 charged normal payments); hub login (hub-setup).
 * CHANGES DATA: yes — invoices.paid + transactions.status of one invoice, then a Stripe test card payment.
 */
test.describe('CSS - outstanding amount', () => {
  test('an unpaid invoice shows as outstanding amount and can be paid by card', async ({ cssPage, db }) => {
    // SETUP: invoice number of the first charged invoice ← hub db
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    const invoiceNumber = await getInvoiceNumber(db.hub, data!.normal.invoiceIds[0]);
    test.info().annotations.push({ type: 'invoice', description: `${data!.normal.invoiceIds[0]} = ${invoiceNumber}` });

    // SETUP: the invoice has a transaction (INFO only: its status before the change)
    const transactions = await findTransactionsOfInvoice(db.hub, invoiceNumber);
    expect(transactions.length, `transactions of ${invoiceNumber}`).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'transactions before', description: transactions.map((t) => `${t.transaction_id} ${t.status}`).join(', ') });

    // SETUP: make it unpaid → invoices.paid = false, transactions.status = failed
    await setInvoicePaidByNumber(db.hub, invoiceNumber, false);
    await setTransactionStatusOfInvoice(db.hub, invoiceNumber, 'failed');

    // ACTION: Login CSS → dashboard
    await cssPage.loginFromHub(data!.customerId);

    // CHECK: "Outstanding amount" with 1 invoice of 10,00 €
    await expect(cssPage.outstandingAmount()).toBeVisible();
    await expect(cssPage.page.getByText('1 invoice', { exact: true })).toBeVisible();

    // ACTION: click it → the Outstanding amount page
    await cssPage.outstandingAmount().click();

    // CHECK: the invoice is listed and selected, total 10,00 €
    await expect(cssPage.page.getByRole('heading', { name: 'Outstanding amount', level: 1 })).toBeVisible();
    await expect(cssPage.page.getByRole('radio', { name: `Select invoice ${invoiceNumber}` })).toBeChecked();

    // ACTION: "Pay outstanding amount (10,00 €)" → Payment page → pay by card
    await cssPage.page.getByRole('button', { name: 'Pay outstanding amount (10,00 €)' }).click();
    await expect(cssPage.page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    await expect(cssPage.page.getByText('Amount due')).toBeVisible();
    await cssPage.payByCard(payments.stripeCard);

    // CHECK (DB): the invoice is paid again
    await expect
      .poll(() => isInvoicePaidByNumber(db.hub, invoiceNumber), { message: `paid of invoice ${invoiceNumber}`, timeout: 60_000 })
      .toBe(true);
  });
});
