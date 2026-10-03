import { test, expect } from '@fixtures';
import {
  countOpenRecurringPayments,
  findRecurringPaymentRow,
  findSubscriptionWithFourOpenPayments,
  getPaymentAmount,
  getPaymentInvoiceId,
  isPaymentSettled,
  setRecurringPaymentSettled,
} from '@db/queries/hub/recurring-payments';

// Hub → subscription page → recurring payments table → row menu actions.
// Needs: an active normal checkout subscription with at least 4 open recurring payments.
// Changes data: deletes one recurring payment, settles one, un-settles one, charges one (creates an invoice),
// sets future amounts to 20.
test.describe.configure({ mode: 'default' });

test.describe('Hub - subscription recurring payments', () => {
  // the subscription and the ids of its first four open recurring payments
  let target: { subscription_id: string; rp1: string; rp2: string; rp3: string; rp4: string };

  // picked again for every test, because earlier tests change its payments
  test.beforeEach(async ({ db, hubCompanyId, subscriptionListPage, subscriptionDetailPage }) => {
    target = await findSubscriptionWithFourOpenPayments(db.hub, hubCompanyId);
    test.info().annotations.push({ type: 'subscription', description: target.subscription_id });
    await subscriptionListPage.openSubscription(target.subscription_id);
    await subscriptionDetailPage.showRecurringPayments(50);
  });

  test('deletes a recurring payment', async ({ subscriptionDetailPage, db }) => {
    // SETUP: number of open recurring payments before
    const before = await countOpenRecurringPayments(db.hub, target.subscription_id);

    // ACTION: row of rp1 → "Delete recurring payment" → tick consequences → Submit → close
    await subscriptionDetailPage.runPaymentAction(target.rp1, 'Delete recurring payment');
    await subscriptionDetailPage.confirmConsequences();
    await subscriptionDetailPage.closeDialog();

    // CHECK: one open payment less, and rp1 has deleted_at set
    await expect
      .poll(() => countOpenRecurringPayments(db.hub, target.subscription_id), { message: `open RPs of ${target.subscription_id}` })
      .toBe(before - 1);
    const deleted = await findRecurringPaymentRow(db.hub, target.rp1);
    expect(deleted?.deleted_at, `deleted_at of recurring payment ${target.rp1}`).not.toBeNull();
  });

  test('marks a recurring payment as settled', async ({ subscriptionDetailPage, db }) => {
    // ACTION: row of rp2 → "Mark as settled" → confirm → close
    await subscriptionDetailPage.runPaymentAction(target.rp2, 'Mark as settled');
    await subscriptionDetailPage.confirmMarkAs('Mark as settled');
    await subscriptionDetailPage.closeDialog();

    // CHECK: payment_settled = true in the database
    await expect
      .poll(() => isPaymentSettled(db.hub, target.rp2), { message: `payment_settled of recurring payment ${target.rp2}` })
      .toBe(true);
  });

  test('marks a settled recurring payment as not paid', async ({ subscriptionDetailPage, db, page }) => {
    // SETUP: make rp3 settled in the database first (the action is only offered for settled payments)
    await setRecurringPaymentSettled(db.hub, target.rp3);
    await page.reload();
    await subscriptionDetailPage.showRecurringPayments(50);

    // ACTION: row of rp3 → "Mark as not paid" → confirm → close
    await subscriptionDetailPage.runPaymentAction(target.rp3, 'Mark as not paid');
    await subscriptionDetailPage.confirmMarkAs('Mark as not paid');
    await subscriptionDetailPage.closeDialog();

    // CHECK: payment_settled = false
    await expect
      .poll(() => isPaymentSettled(db.hub, target.rp3), { message: `payment_settled of recurring payment ${target.rp3}` })
      .toBe(false);
  });

  test('charges a recurring payment and creates its invoice', async ({ subscriptionDetailPage, db }) => {
    // ACTION: row of rp4 → "Charge recurring payment" → consequences → Submit
    await subscriptionDetailPage.runPaymentAction(target.rp4, 'Charge recurring payment');
    await subscriptionDetailPage.confirmConsequences();
    await subscriptionDetailPage.closeDialog('Your invoice was generated successfully!');

    // CHECK: within 30 s rp4 has an invoice_id
    await expect
      .poll(() => getPaymentInvoiceId(db.hub, target.rp4), { message: `invoice_id of recurring payment ${target.rp4}`, timeout: 30_000 })
      .not.toBeNull();
  });

  test('changes the amount of all future payments to 20', async ({ subscriptionDetailPage, db }) => {
    // ACTION: row of rp1 → "Edit recurring payment(s)" → "Change all future payments" → 20 → Submit changes
    await subscriptionDetailPage.runPaymentAction(target.rp1, 'Edit recurring payment(s)');
    await subscriptionDetailPage.editFuturePaymentsAmount(20);
    await subscriptionDetailPage.closeDialog();

    // CHECK: amount '20.0000' (4 decimals in the database)
    await expect
      .poll(() => getPaymentAmount(db.hub, target.rp1), { message: `amount of recurring payment ${target.rp1}` })
      .toBe('20.0000');
  });
});
