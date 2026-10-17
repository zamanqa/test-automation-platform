import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import {
  findActiveSubscriptionOfType,
  findSubscriptionForActions,
  getSerialNumber,
  getSubscriptionDuration,
  getSubscriptionQuantity,
} from '@db/queries/hub/subscriptions';
import {
  findEndedSubscription,
  findNewSubscriptionEmail,
  getNewSubscriptionEmailTemplate,
  getNotifySubscriptions,
  setNotifySubscriptions,
  findImportableOrderItem,
  findOtherActiveSerial,
  findSearchableSerial,
  findSubscriptionWithThreePayments,
} from '@db/queries/hub/subscriptions-more';
import { getLastEmailEntryId } from '@db/queries/hub/subscription-crons';

// Hub → subscriptions: the cases that were missing - CSV import, serial number that is taken, quantity / extend
// validation, menu of an ended subscription, recurring payments on the page, search by serial number.
// Changes data: the CSV import creates one subscription (qa_auto serial) for an order item.
test.describe.configure({ mode: 'default' });

test.describe('Hub - subscription gaps', () => {
  test('S1 imports a subscription from CSV for an order item', async ({ db, hubCompanyId, page }) => {
    // SETUP
    const item = await findImportableOrderItem(db.hub, hubCompanyId);
    test.skip(!item, 'no open order item without subscription');
    const serial = testName('sn_sub_csv');
    const csv = ['order_id,date,serial_number,product_id', `${item!.order_id},${new Date().toISOString().slice(0, 10)},${serial},${item!.sku}`].join('\n');
    test.info().annotations.push({ type: 'order item', description: `${item!.order_id} / ${item!.sku} → ${item!.subscription_id}, serial ${serial}` });

    // ACTION: subscription list → .csv → choose the file → Upload
    await page.goto('en/cms/subscriptions');
    await page.getByRole('button', { name: '.csv' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Import subscriptions from CSV' })).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({ name: `${serial}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await dialog.getByRole('button', { name: 'Upload' }).click();

    // CHECK: success and the subscription exists with the serial from the file
    await expect(dialog.getByText('Successfully requested!')).toBeVisible();
    await expect
      .poll(() => getSerialNumber(db.hub, item!.subscription_id), { message: `subscription ${item!.subscription_id}`, timeout: 60_000 })
      .toBe(serial);
  });

  test('S2 a serial number that another subscription has shows "Serial number exists" and nothing changes', async ({
    db,
    hubCompanyId,
    subscriptionListPage,
    subscriptionDetailPage,
    page,
  }) => {
    // SETUP
    const subscription = await findSubscriptionForActions(db.hub, hubCompanyId);
    const before = await getSerialNumber(db.hub, subscription.subscription_id);
    const other = await findOtherActiveSerial(db.hub, hubCompanyId, subscription.subscription_id);
    test.skip(!before || !other, 'no serial number to replace or none to copy');

    // ACTION: Replace serial number with the other subscription's serial
    await subscriptionListPage.openSubscription(subscription.subscription_id);
    await subscriptionDetailPage.runAction('Replace serial number');
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'New serial number' }).fill(other!.serial_number);
    await dialog.getByRole('textbox', { name: 'Previous serial number' }).fill(before!);
    await subscriptionDetailPage.confirmButton.click();

    // CHECK: warning shown → Close → serial unchanged
    await expect(page.getByText('Serial number exists')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('already associated with')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).last().click();
    expect(await getSerialNumber(db.hub, subscription.subscription_id)).toBe(before);
  });

  test('S3 quantity 0 is refused for a consumable subscription', async ({ db, hubCompanyId, subscriptionListPage, subscriptionDetailPage, page }) => {
    // SETUP
    const subscription = await findActiveSubscriptionOfType(db.hub, hubCompanyId, 'consumable');
    test.skip(!subscription, 'no active consumable subscription');
    const before = await getSubscriptionQuantity(db.hub, subscription!.subscription_id);

    // ACTION
    await subscriptionListPage.openSubscription(subscription!.subscription_id);
    await subscriptionDetailPage.runAction('Change quantity');
    await page.locator('input[path="quantity"]').locator('visible=true').first().fill('0');
    await subscriptionDetailPage.modalSubmit.click();

    // CHECK: no success, quantity unchanged
    await expect(subscriptionDetailPage.successMessage).toBeHidden();
    await expect(subscriptionDetailPage.modal).toBeVisible();
    expect(await getSubscriptionQuantity(db.hub, subscription!.subscription_id)).toBe(before);
  });

  test('S4 extend by 0 cycles is refused', async ({ db, hubCompanyId, subscriptionListPage, subscriptionDetailPage, page }) => {
    // SETUP
    const subscription = await findSubscriptionForActions(db.hub, hubCompanyId);
    const before = await getSubscriptionDuration(db.hub, subscription.subscription_id);

    // ACTION
    await subscriptionListPage.openSubscription(subscription.subscription_id);
    await subscriptionDetailPage.runAction('Extend subscription');
    await page.locator('input[type="number"]').first().fill('0');
    await subscriptionDetailPage.confirmButton.click();

    // CHECK: no success, duration unchanged
    await expect(subscriptionDetailPage.successMessage).toBeHidden();
    expect(await getSubscriptionDuration(db.hub, subscription.subscription_id), 'subscription_duration').toBe(before);
  });

  test('S7 sends the "Subscription - Created" email', async ({ db, hubCompanyId, subscriptionListPage, emailSendPage, cleanup }) => {
    // SETUP: subscription emails are switched off for the company on dev → on for this test, old value back after
    const subscription = await findSubscriptionForActions(db.hub, hubCompanyId);
    const notifyBefore = await getNotifySubscriptions(db.hub, hubCompanyId);
    await setNotifySubscriptions(db.hub, hubCompanyId, true);
    cleanup.add('notify_subscriptions back', () => setNotifySubscriptions(db.hub, hubCompanyId, notifyBefore));
    const lastEmailId = await getLastEmailEntryId(db.hub);

    // ACTION
    await subscriptionListPage.openSubscription(subscription.subscription_id);
    await emailSendPage.send('Subscription - Created', 'qa_auto_hub_email@gmail.com');

    // CHECK: email_entries row for this subscription (dev SMTP may fail, so success is only info)
    await expect
      .poll(() => getNewSubscriptionEmailTemplate(db.hub, subscription.subscription_id, lastEmailId), { message: 'email in email_entries' })
      .toMatch(/^subscription-/);
    const email = await findNewSubscriptionEmail(db.hub, subscription.subscription_id, lastEmailId);
    expect(email!.to).toEqual(['qa_auto_hub_email@gmail.com']);
    test.info().annotations.push({ type: 'INFO email', description: `${email!.template_id}, success ${email!.success}` });
  });

  test('S5 an ended subscription cannot be bought out, extended or changed in quantity', async ({ db, hubCompanyId, subscriptionListPage, page }) => {
    // SETUP
    const subscription = await findEndedSubscription(db.hub, hubCompanyId);
    test.skip(!subscription, 'no ended subscription');
    const actionsLoaded = page.waitForResponse((r) => r.url().includes(`/subscriptions/${subscription!.subscription_id}/actions`));

    // ACTION: open it and wait until its allowed actions are loaded, then open the menu
    await subscriptionListPage.openSubscription(subscription!.subscription_id);
    await actionsLoaded;
    await page.locator('button[aria-haspopup="menu"]:not(.header-btn)').last().click();

    // CHECK
    await expect(page.getByRole('menuitem', { name: 'Buyout subscription', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Extend subscription', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Change quantity', exact: true })).toBeDisabled();
  });

  test('S6 the subscription page lists its recurring payments', async ({ db, hubCompanyId, subscriptionListPage, subscriptionDetailPage, page }) => {
    // SETUP
    const subscription = await findSubscriptionWithThreePayments(db.hub, hubCompanyId);
    test.skip(!subscription, 'no active subscription with duration > 4 and 3 recurring payments');

    // ACTION
    await subscriptionListPage.openSubscription(subscription!.subscription_id);
    await subscriptionDetailPage.showRecurringPayments(50);

    // CHECK: the first 3 recurring payments from the database are shown
    for (const id of subscription!.ids) {
      await expect(page.locator('td', { hasText: new RegExp(`^\\s*${id}\\s*$`) })).toBeVisible();
    }
  });

  test('S8 search by serial number', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await findSearchableSerial(db.hub, hubCompanyId);
    test.skip(!picked, 'no active subscription with a serial number');

    // ACTION
    await hubListPage.open('subscriptions', { search: picked!.serial_number, created_at: '' });

    // CHECK: at least the subscriptions with this serial are found
    await expect.poll(() => hubListPage.total(), { message: `search ${picked!.serial_number}` }).toBeGreaterThanOrEqual(Number(picked!.count));
    await expect(hubListPage.rows.first()).toContainText(picked!.serial_number.slice(0, 6));
  });
});
