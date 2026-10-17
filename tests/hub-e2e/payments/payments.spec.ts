import { test, expect } from '@fixtures';
import { countPayments, findPaymentForDetail } from '@db/queries/hub/payments';
import { getLastEmailEntryId } from '@db/queries/hub/subscription-crons';
import {
  findNewTransactionEmail,
  getNewTransactionEmailTemplate,
  getOrderAndTransactionNotify,
  setNotifyTransactions,
} from '@db/queries/hub/email-entries';

// Hub → Payments (transactions): list totals, status filters, search, payment page, PDF, links, paging.
// Needs: transactions of the company, a succeeded one with invoice, order, customer and subscription.
// Changes data: P6 sends an email (notify_transactions switched on for the test, old value back after).
test.describe.configure({ mode: 'default' });

// 10.5 → "10,50 €" (amounts below 1000, so no thousands separator)
function euro(amount: string) {
  return `${Number(amount).toFixed(2).replace('.', ',')} €`;
}

test.describe('Hub - payments', () => {
  test('P1 list total matches the database', async ({ db, hubCompanyId, paymentPage }) => {
    // SETUP
    const expected = await countPayments(db.hub, hubCompanyId);

    // ACTION
    await paymentPage.openList();

    // CHECK
    await expect.poll(() => paymentPage.total(), { message: 'payment list total' }).toBe(expected);
  });

  test('P2 status filter failed and succeeded match the database', async ({ db, hubCompanyId, paymentPage, page }) => {
    // SETUP
    const failed = await countPayments(db.hub, hubCompanyId, 'failed');
    const succeeded = await countPayments(db.hub, hubCompanyId, 'succeeded');

    // ACTION + CHECK: failed
    await paymentPage.openList({ status: 'failed' });
    await expect.poll(() => paymentPage.total(), { message: 'failed payments' }).toBe(failed);
    await expect(page.locator('tbody td', { hasText: /^\s*failed\s*$/ }).first()).toBeVisible();

    // ACTION + CHECK: succeeded
    await paymentPage.openList({ status: 'succeeded' });
    await expect.poll(() => paymentPage.total(), { message: 'succeeded payments' }).toBe(succeeded);
  });

  test('P3 search by transaction id shows that payment', async ({ db, hubCompanyId, paymentPage }) => {
    // SETUP
    const payment = await findPaymentForDetail(db.hub, hubCompanyId);
    test.skip(!payment, 'no succeeded payment with invoice and subscription');

    // ACTION
    await paymentPage.openList();
    await paymentPage.searchInput.fill(payment!.transaction_id);

    // CHECK
    await expect.poll(() => paymentPage.total(), { message: `search ${payment!.transaction_id}` }).toBe(1);
    await expect(paymentPage.rows.first()).toContainText(payment!.invoice_number);
  });

  test('P4 P5 payment page shows the database values and downloads the invoice PDF', async ({ db, hubCompanyId, paymentPage, page }) => {
    // SETUP
    const payment = await findPaymentForDetail(db.hub, hubCompanyId);
    test.skip(!payment, 'no succeeded payment with invoice and subscription');
    test.info().annotations.push({ type: 'payment', description: payment!.transaction_id });

    // ACTION
    await paymentPage.openPayment(payment!.transaction_id);

    // CHECK: details = transactions row
    await expect(paymentPage.detail('Amount:')).toHaveText(euro(payment!.amount_paid));
    await expect(paymentPage.detail('Payment service provider:')).toHaveText(payment!.payment_service_provider);
    await expect(paymentPage.detail('Type:')).toHaveText(payment!.type);
    await expect(paymentPage.detail('Invoice type:')).toHaveText(payment!.invoice_type);
    await expect(paymentPage.detail('Invoice number:')).toHaveText(payment!.invoice_number);
    await expect(paymentPage.detail('Status:')).toHaveText(payment!.status);
    await expect(page.getByRole('link', { name: payment!.order_id, exact: true })).toHaveAttribute('href', `/en/cms/orders/${payment!.order_id}`);
    await expect(page.getByRole('link', { name: payment!.customer_id, exact: true })).toHaveAttribute('href', `/en/cms/customers/${payment!.customer_id}`);
    await expect(page.locator(`a[href="/en/cms/subscriptions/${payment!.subscription_id}"]`)).toBeVisible();

    // CHECK P5: PDF of the invoice loads
    expect(await paymentPage.downloadPdf(), `PDF of invoice ${payment!.invoice_number}`).toBe(200);
  });

  test('P7 order, customer and subscription links open the right records', async ({ db, hubCompanyId, paymentPage, page }) => {
    // SETUP
    const payment = await findPaymentForDetail(db.hub, hubCompanyId);
    test.skip(!payment, 'no succeeded payment with invoice and subscription');

    // ACTION + CHECK: order
    await paymentPage.openPayment(payment!.transaction_id);
    await page.getByRole('link', { name: payment!.order_id, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${payment!.order_id}`));

    // ACTION + CHECK: customer
    await paymentPage.openPayment(payment!.transaction_id);
    await page.getByRole('link', { name: payment!.customer_id, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/customers/${payment!.customer_id}`));

    // ACTION + CHECK: subscription
    await paymentPage.openPayment(payment!.transaction_id);
    await page.locator(`a[href="/en/cms/subscriptions/${payment!.subscription_id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/subscriptions/${payment!.subscription_id}`));
  });

  test('P6 sends the "Payment - Successful" email', async ({ db, hubCompanyId, paymentPage, emailSendPage, cleanup }) => {
    // SETUP: transaction emails can be switched off for the company → on for this test, old value back after
    const payment = await findPaymentForDetail(db.hub, hubCompanyId);
    test.skip(!payment, 'no succeeded payment with invoice and subscription');
    const before = await getOrderAndTransactionNotify(db.hub, hubCompanyId);
    await setNotifyTransactions(db.hub, hubCompanyId, true);
    cleanup.add('notify_transactions back', () => setNotifyTransactions(db.hub, hubCompanyId, before.notify_transactions));
    const lastEmailId = await getLastEmailEntryId(db.hub);

    // ACTION
    await paymentPage.openPayment(payment!.transaction_id);
    await emailSendPage.send('Payment - Successful', 'qa_auto_hub_email@gmail.com');

    // CHECK: email_entries row for this transaction (dev SMTP may fail, so success is only info)
    await expect
      .poll(() => getNewTransactionEmailTemplate(db.hub, payment!.transaction_id, lastEmailId), { message: 'email in email_entries' })
      .toBe('payment-successful');
    const email = await findNewTransactionEmail(db.hub, payment!.transaction_id, lastEmailId);
    expect(email!.to).toEqual(['qa_auto_hub_email@gmail.com']);
    test.info().annotations.push({ type: 'INFO email', description: `success ${email!.success}` });
  });

  test('P8 page size 25 and the next page', async ({ db, hubCompanyId, paymentPage, page }) => {
    // SETUP
    const expected = await countPayments(db.hub, hubCompanyId);
    test.skip(expected <= 25, 'fewer than 26 payments');

    // ACTION: 25 per page
    await paymentPage.openList();
    await paymentPage.changePageSize(25);

    // CHECK
    await expect(paymentPage.rows).toHaveCount(25);
    await expect(paymentPage.paginationText).toContainText('1-25');

    // ACTION + CHECK: next page
    await page.getByTestId('btn-next-page').first().click();
    await expect(paymentPage.paginationText).toContainText('26-');
    await expect.poll(() => paymentPage.total(), { message: 'total on page 2' }).toBe(expected);
  });
});
