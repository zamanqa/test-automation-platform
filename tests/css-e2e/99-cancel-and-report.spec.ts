import { test, expect } from '@fixtures';
import { readCssData, type CssData } from '@data/css';
import { getSubscriptionStatus, resetCssCancellation } from '@db/queries/hub/subscriptions';

/**
 * WHAT:   The last CSS tests (file 99 runs at the very end, owner): "Report an issue" and "Cancel subscription"
 *         on the consumable and on the normal subscription. The normal one needs a date (Appointment / Pickup Date).
 * NEEDS:  .auth/css-data.json from 01-css-login.spec.ts. Before each test both subscriptions are reset in the DB
 *         (owner): status 'active' and the cancellation fields emptied, so the tests can run again.
 * CHANGES DATA: yes — issue reports, and both subscriptions are cancelled.
 */
test.describe.configure({ mode: 'default' });

test.describe('CSS - report an issue and cancel subscription', () => {
  // read in beforeEach, not here: this line would run when the files are loaded — before 01 writes the new customer
  let data: CssData | undefined;

  test.beforeEach(async ({ cssPage, db }) => {
    data = readCssData();
    test.skip(!data, 'no .auth/css-data.json — run 01-css-login.spec.ts first');
    // SETUP: both subscriptions active, cancellation fields empty ← hub db
    await resetCssCancellation(db.hub, data!.normal.subscriptionId);
    await resetCssCancellation(db.hub, data!.consumable.subscriptionId);
    await cssPage.loginFromHub(data!.customerId);
  });

  test('consumable: report an issue', async ({ cssPage }) => {
    // ACTION: Report an issue → message → Send
    await cssPage.openSubscriptionAction(data!.consumable.subscriptionId, 'report_issue');
    await cssPage.page.getByRole('textbox', { name: 'Your message' }).fill('qa_auto: consumable issue report');
    await cssPage.page.getByRole('button', { name: 'Send' }).click();

    // CHECK: the success message "Thank You"
    await expect(cssPage.page.getByText('Thank You', { exact: true })).toBeVisible();
  });

  test('normal: report an issue with an appointment date', async ({ cssPage }) => {
    // ACTION: Report an issue → message → Appointment date (first free date + slot) → Send
    // (message FIRST: text typed after picking the date is lost — the box stays empty, "Is required."; CSS bug?)
    await cssPage.openSubscriptionAction(data!.normal.subscriptionId, 'report_issue');
    await cssPage.page.getByRole('textbox', { name: 'Your message' }).fill('qa_auto: normal issue report');
    await cssPage.pickFirstFreeDate('Appointment date');
    await expect(cssPage.page.getByRole('textbox', { name: 'Your message' })).toHaveValue('qa_auto: normal issue report');
    await cssPage.page.getByRole('button', { name: 'Send' }).click();

    // CHECK: the success message "Thank You"
    await expect(cssPage.page.getByText('Thank You', { exact: true })).toBeVisible();
  });

  test('consumable: cancel subscription (normal cancellation)', async ({ cssPage, db }) => {
    // ACTION: Cancel subscription → Normal cancellation → first reason → message → Cancel now
    await cssPage.openSubscriptionAction(data!.consumable.subscriptionId, 'cancel_subscription');
    await cssPage.chooseCancellationType('Normal cancellation');
    const reason = await cssPage.chooseFirstCancellationReason();
    test.info().annotations.push({ type: 'cancellation reason', description: reason });
    await cssPage.page.getByRole('textbox', { name: 'Your message' }).fill('qa_auto: consumable cancellation');

    // CHECK: the form still has the reason and the message (the form can reset itself)
    await expect(cssPage.page.getByRole('button', { name: /^Cancellation reason \*/ })).toContainText(reason);
    await expect(cssPage.page.getByRole('textbox', { name: 'Your message' })).toHaveValue('qa_auto: consumable cancellation');

    // ACTION: Cancel now
    await cssPage.page.getByRole('button', { name: 'Cancel now' }).click();

    // CHECK (DB): the subscription is no longer active
    await expect
      .poll(() => getSubscriptionStatus(db.hub, data!.consumable.subscriptionId), { message: `status of ${data!.consumable.subscriptionId}`, timeout: 30_000 })
      .not.toBe('active');
  });

  test('normal: cancel subscription with a pickup date', async ({ cssPage, db }) => {
    // ACTION: Cancel subscription → Normal cancellation → first reason → message → Pickup Date (first free date + slot)
    // (message BEFORE the date: text typed after picking the date is lost — CSS bug?)
    await cssPage.openSubscriptionAction(data!.normal.subscriptionId, 'cancel_subscription');
    await cssPage.chooseCancellationType('Normal cancellation');
    const reason = await cssPage.chooseFirstCancellationReason();
    test.info().annotations.push({ type: 'cancellation reason', description: reason });
    await cssPage.page.getByRole('textbox', { name: 'Your message' }).fill('qa_auto: normal cancellation');
    await cssPage.pickFirstFreeDate('Pickup Date *');

    // CHECK: the form still has the reason and the message (the form can reset itself)
    await expect(cssPage.page.getByRole('button', { name: /^Cancellation reason \*/ })).toContainText(reason);
    await expect(cssPage.page.getByRole('textbox', { name: 'Your message' })).toHaveValue('qa_auto: normal cancellation');

    // ACTION: Cancel now
    await cssPage.page.getByRole('button', { name: 'Cancel now' }).click();

    // CHECK (DB): the subscription is no longer active
    await expect
      .poll(() => getSubscriptionStatus(db.hub, data!.normal.subscriptionId), { message: `status of ${data!.normal.subscriptionId}`, timeout: 30_000 })
      .not.toBe('active');
  });
});
