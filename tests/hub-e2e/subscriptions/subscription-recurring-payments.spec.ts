// test, expect ← src/fixtures/index.ts
// ...          ← src/db/queries/hub/recurring-payments.ts ("RP" = recurring payment row)
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

/**
 * WHAT:   Hub UI → Subscription detail → recurring payments table → row menu actions.
 * FROM:   hub-e2e-automation cypress/e2e/02-subscription-page/subscriptionRP.cy.js (5 tests).
 * NEEDS:  an active normal checkout subscription with ≥ 4 open recurring payments.
 * CHANGES DATA: yes — deletes one RP, settles one, un-settles one, CHARGES one (creates an invoice),
 *         changes future amounts to 20.
 * target.rp1..rp4 = ids of the subscription's first four open recurring payments ← hub db.
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - subscription recurring payments', () => {
  // Set in beforeEach: the subscription and the ids of its first four open recurring payments
  let target: { subscription_id: string; rp1: string; rp2: string; rp3: string; rp4: string };

  // Before each test: pick the subscription ← hub db, open it, show 50 RPs per page
  // (re-picked every test, because earlier tests change its payments)
  test.beforeEach(async ({ db, hubCompanyId, subscriptionListPage, subscriptionDetailPage }) => {
    target = await findSubscriptionWithFourOpenPayments(db.hub, hubCompanyId);
    test.info().annotations.push({ type: 'subscription', description: target.subscription_id });
    await subscriptionListPage.openSubscription(target.subscription_id);
    await subscriptionDetailPage.showRecurringPayments(50);
  });

  test('deletes a recurring payment', async ({ subscriptionDetailPage, db }) => {
    // SETUP: number of open RPs before ← hub db
    const before = await countOpenRecurringPayments(db.hub, target.subscription_id);

    // ACTION: row of rp1 → "Delete recurring payment" → tick consequences → Submit → close
    await subscriptionDetailPage.runPaymentAction(target.rp1, 'Delete recurring payment');
    await subscriptionDetailPage.confirmConsequences();
    await subscriptionDetailPage.closeDialog();

    // CHECK: one fewer open RP, and rp1 has deleted_at set
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
    // SETUP: make rp3 settled in the database first (the action only exists for settled RPs), reload
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

    // CHECK: rp4 gets an invoice_id (poll up to 30s). Was a fixed cy.wait(10000).
    await expect
      .poll(() => getPaymentInvoiceId(db.hub, target.rp4), { message: `invoice_id of recurring payment ${target.rp4}`, timeout: 30_000 })
      .not.toBeNull();
  });

  test('changes the amount of all future payments to 20', async ({ subscriptionDetailPage, db }) => {
    // ACTION: row of rp1 → "Edit recurring payment(s)" → "Change all future payments" → 20 → Submit changes
    await subscriptionDetailPage.runPaymentAction(target.rp1, 'Edit recurring payment(s)');
    await subscriptionDetailPage.editFuturePaymentsAmount(20);
    await subscriptionDetailPage.closeDialog();

    // CHECK: amount stored as '20.0000' (4 decimals in the database)
    await expect
      .poll(() => getPaymentAmount(db.hub, target.rp1), { message: `amount of recurring payment ${target.rp1}` })
      .toBe('20.0000');
  });
});
