import { test, expect } from '@fixtures';
import { readCssData, type CssData } from '@data/css';
import { getSubscriptionStatus, resetCssCancellation } from '@db/queries/hub/subscriptions';

// The last CSS tests (file 99 runs at the end): "Report an issue" and "Cancel subscription"
// on the consumable and the normal subscription. The normal one also needs a date.
// Needs: .auth/css-data.json from 01-css-login.spec.ts. Before each test both subscriptions are
// set back to active in the database, so the tests can run again.
// Changes data: issue reports, and both subscriptions are cancelled.
test.describe.configure({ mode: 'default' });

test.describe('CSS - report an issue and cancel subscription', () => {
  // read in beforeEach, not here: here it would run before 01 has written the new customer
  let data: CssData | undefined;

  test.beforeEach(async ({ cssPage, db }) => {
    data = readCssData();
    test.skip(!data, 'no .auth/css-data.json, run 01-css-login.spec.ts first');
    // SETUP: both subscriptions active, cancellation fields empty
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
    // (message first: text typed after picking the date is lost)
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

    // CHECK: the subscription is not active any more
    await expect
      .poll(() => getSubscriptionStatus(db.hub, data!.consumable.subscriptionId), { message: `status of ${data!.consumable.subscriptionId}`, timeout: 30_000 })
      .not.toBe('active');
  });

  test('normal: cancel subscription with a pickup date', async ({ cssPage, db }) => {
    // ACTION: Cancel subscription → Normal cancellation → first reason → message → Pickup Date (first free date + slot)
    // (message first: text typed after picking the date is lost)
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

    // CHECK: the subscription is not active any more
    await expect
      .poll(() => getSubscriptionStatus(db.hub, data!.normal.subscriptionId), { message: `status of ${data!.normal.subscriptionId}`, timeout: 30_000 })
      .not.toBe('active');
  });
});
