import { test, expect } from '@fixtures';
import { getPaymentInvoiceId } from '@db/queries/hub/recurring-payments';
import {
  countListRecurringPayments,
  countSubscriptionListPayments,
  findPaymentAmountAndQuantity,
  findSettledListPayment,
  findSubscriptionForRecurringTab,
  setPaymentAmountAndQuantity,
  setPaymentFailed,
} from '@db/queries/hub/recurring-tab';

// Hub → Recurring payments tab: totals and status filters, search, edit one payment, charge a failed payment,
// disabled menu items, links to order and subscription.
// Needs: active normal checkout subscriptions (Stripe card) with 4+ open recurring payments.
// Changes data: edits one payment (old values put back), charges one payment (creates its invoice).
test.describe.configure({ mode: 'default' });

test.describe('Hub - recurring payments tab', () => {
  test('R1 list total and the settled / not settled / failed filters match the database', async ({ db, hubCompanyId, recurringTabPage }) => {
    // SETUP
    const all = await countListRecurringPayments(db.hub, hubCompanyId);

    // ACTION + CHECK: all (no billing date filter)
    await recurringTabPage.openList();
    await expect.poll(() => recurringTabPage.total(), { message: 'recurring payment list total' }).toBe(all);

    // ACTION + CHECK: settled
    const settled = await countListRecurringPayments(db.hub, hubCompanyId, 'settled');
    await recurringTabPage.openList({ status: 'settled' });
    await expect.poll(() => recurringTabPage.total(), { message: 'status settled' }).toBe(settled);

    // ACTION + CHECK: not settled
    const notSettled = await countListRecurringPayments(db.hub, hubCompanyId, 'not settled');
    await recurringTabPage.openList({ status: 'not settled' });
    await expect.poll(() => recurringTabPage.total(), { message: 'status not settled' }).toBe(notSettled);

    // ACTION + CHECK: failed
    const failed = await countListRecurringPayments(db.hub, hubCompanyId, 'failed');
    await recurringTabPage.openList({ status: 'failed' });
    await expect.poll(() => recurringTabPage.total(), { message: 'status failed' }).toBe(failed);
  });

  test('R2 search by subscription id and by order id', async ({ db, hubCompanyId, recurringTabPage }) => {
    // SETUP
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!target, 'no subscription with 4 open recurring payments');
    const expected = await countSubscriptionListPayments(db.hub, target!.subscription_id);

    // ACTION + CHECK: subscription id
    await recurringTabPage.openList();
    await recurringTabPage.searchInput.fill(target!.subscription_id);
    await expect.poll(() => recurringTabPage.total(), { message: `search ${target!.subscription_id}` }).toBe(expected);

    // ACTION + CHECK: order id shows the rows of that order (at least this subscription's)
    await recurringTabPage.openList({ search: target!.order_id, per_page: '50' });
    await expect(recurringTabPage.row(target!.rp1)).toBeVisible();
  });

  test('R3 edits the amount of one payment, the other payments stay the same', async ({ db, hubCompanyId, recurringTabPage, cleanup }) => {
    // SETUP
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!target, 'no subscription with 4 open recurring payments');
    const old1 = await findPaymentAmountAndQuantity(db.hub, target!.rp1);
    const old2 = await findPaymentAmountAndQuantity(db.hub, target!.rp2);
    cleanup.add('old amount and quantity back', () => setPaymentAmountAndQuantity(db.hub, target!.rp1, old1.amount, old1.quantity));
    test.info().annotations.push({ type: 'recurring payment', description: `${target!.rp1} (old ${old1.amount} × ${old1.quantity})` });

    // ACTION
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.runRowAction(target!.rp1, 'Edit recurring payment(s)');
    await expect(recurringTabPage.quantityInput, 'quantity is locked for a normal subscription').toBeDisabled();
    await recurringTabPage.setAmount('12.5');
    await recurringTabPage.submitChangesButton.click();
    await recurringTabPage.closeDialog();

    // CHECK: rp1 changed, rp2 unchanged
    await expect.poll(async () => (await findPaymentAmountAndQuantity(db.hub, target!.rp1)).amount, { message: `amount of ${target!.rp1}` }).toBe('12.5000');
    expect((await findPaymentAmountAndQuantity(db.hub, target!.rp1)).quantity).toBe(old1.quantity);
    expect(await findPaymentAmountAndQuantity(db.hub, target!.rp2), `recurring payment ${target!.rp2} unchanged`).toEqual(old2);
  });

  test('R4 edit refuses a negative amount', async ({ db, hubCompanyId, recurringTabPage }) => {
    // SETUP
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!target, 'no subscription with 4 open recurring payments');
    const before = await findPaymentAmountAndQuantity(db.hub, target!.rp2);

    // ACTION + CHECK: negative amount
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.runRowAction(target!.rp2, 'Edit recurring payment(s)');
    await recurringTabPage.setAmount('-1');
    await recurringTabPage.submitChangesButton.click();
    await expect(recurringTabPage.dialog.getByText(/greater than or equal to 0/i)).toBeVisible();

    // CHECK: database unchanged
    expect(await findPaymentAmountAndQuantity(db.hub, target!.rp2)).toEqual(before);
  });

  test('R5 charges a failed payment and creates its invoice', async ({ db, hubCompanyId, recurringTabPage, cleanup }) => {
    // SETUP: an open payment of a Stripe card subscription, marked failed
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!target, 'no subscription with 4 open recurring payments');
    await setPaymentFailed(db.hub, target!.rp4, true, 'qa_auto failed for the charge test');
    cleanup.add('failed flag off again', () => setPaymentFailed(db.hub, target!.rp4, false, ''));
    test.info().annotations.push({ type: 'recurring payment', description: target!.rp4 });

    // ACTION
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.runRowAction(target!.rp4, 'Charge recurring payment');
    await recurringTabPage.confirmConsequences();
    await recurringTabPage.closeDialog('Your invoice was generated successfully!');

    // CHECK: the payment has an invoice
    await expect
      .poll(() => getPaymentInvoiceId(db.hub, target!.rp4), { message: `invoice_id of recurring payment ${target!.rp4}`, timeout: 30_000 })
      .not.toBeNull();
  });

  test('R6 settled payment cannot be settled again, an open one cannot be marked as not paid', async ({ db, hubCompanyId, recurringTabPage }) => {
    // SETUP
    const settled = await findSettledListPayment(db.hub, hubCompanyId);
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!settled || !target, 'no settled payment or no open payment');

    // ACTION + CHECK: settled → "Mark as settled" disabled
    await recurringTabPage.openList({ subscription_id: settled!.subscription_id, per_page: '50' });
    await recurringTabPage.openRowMenuLoaded(settled!.id, 'Mark as not paid');
    await expect(recurringTabPage.menuItem('Mark as settled')).toBeDisabled();

    // ACTION + CHECK: open → "Mark as not paid" disabled
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.openRowMenuLoaded(target!.rp3, 'Mark as settled');
    await expect(recurringTabPage.menuItem('Mark as not paid')).toBeDisabled();
  });

  test('R7 View order and View subscription open the right records', async ({ db, hubCompanyId, recurringTabPage, page }) => {
    // SETUP
    const target = await findSubscriptionForRecurringTab(db.hub, hubCompanyId);
    test.skip(!target, 'no subscription with 4 open recurring payments');

    // ACTION + CHECK: order
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.runRowAction(target!.rp1, 'View order');
    await expect(page).toHaveURL(new RegExp(`/orders/${target!.order_id}`));

    // ACTION + CHECK: subscription
    await recurringTabPage.openList({ subscription_id: target!.subscription_id, per_page: '50' });
    await recurringTabPage.runRowAction(target!.rp1, 'View subscription');
    await expect(page).toHaveURL(new RegExp(`/subscriptions/${target!.subscription_id}`));
  });
});
