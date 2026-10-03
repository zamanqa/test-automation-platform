import { test, expect } from '@fixtures';
import { env } from '@config/env';
import {
  countRetailerSubscriptions,
  countRetailerSubscriptionsByStatus,
  findRetailer,
  getOrderIdOfSerial,
} from '@db/queries/hub/pos';

// POS → Subscriptions tabs. "started": count, Status filter and search.
// "not started": search, the Start subscription dialog, and starting a subscription with a serial number.
// Needs: at least one row in "Subscriptions - not started".
// Changes data: the last test starts the first "not started" subscription with serial "qa_auto_sn_…".
test.describe.configure({ mode: 'default' });

test.describe('POS - subscriptions', () => {
  test.beforeEach(async ({ posPage }) => {
    await posPage.login();
  });

  test('shows the started subscriptions with the number from the DB', async ({ posPage, db }) => {
    // SETUP: number of subscriptions of the retailer's orders
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const total = await countRetailerSubscriptions(db.hub, retailer.retailer_id);

    // ACTION: open "Subscriptions - started"
    await posPage.openStartedSubscriptions();

    // CHECK: "(<total>)" on the tab and under the table
    expect(await posPage.tabCount('Subscriptions - started')).toBe(total);
    await expect(posPage.pageInfo()).toContainText(`of ${total} results`);
  });

  test('started: Status filter "Active" shows only active subscriptions, as many as in the DB', async ({ posPage, db }) => {
    // SETUP: active subscriptions of the retailer
    const retailer = await findRetailer(db.hub, env.pos.POS_LOCATION_ID);
    const active = await countRetailerSubscriptionsByStatus(db.hub, retailer.retailer_id, 'active');

    // ACTION: Status → Active
    await posPage.openStartedSubscriptions();
    await posPage.filterStatus('Active');

    // CHECK: URL has status=active, "... of <active> results", no "ended" row
    await expect(posPage.page).toHaveURL(/status=active/);
    await expect(posPage.pageInfo()).toContainText(`of ${active} results`);
    await expect(posPage.page.getByRole('cell', { name: 'ended', exact: true })).toHaveCount(0);
  });

  test('started: search by order id shows only that order', async ({ posPage }) => {
    // SETUP: order id of the first row (column "ID")
    await posPage.openStartedSubscriptions();
    const orderId = (await posPage.rows().first().getByRole('cell').nth(1).innerText()).trim();

    // ACTION: search it
    await posPage.search(orderId);

    // CHECK: every row has that order id
    await expect(posPage.rows().first()).toContainText(orderId);
    await expect(posPage.rows().filter({ hasNotText: orderId })).toHaveCount(0);
  });

  test('not started: search by order id shows only that order', async ({ posPage }) => {
    // SETUP: order id of the first row
    await posPage.openNotStartedSubscriptions();
    test.skip((await posPage.rows().count()) === 0, 'no "not started" subscription');
    const orderId = (await posPage.rows().first().getByRole('cell').nth(1).innerText()).trim();

    // ACTION: search it
    await posPage.search(orderId);

    // CHECK: every row has that order id
    await expect(posPage.rows().first()).toContainText(orderId);
    await expect(posPage.rows().filter({ hasNotText: orderId })).toHaveCount(0);
  });

  test('Start subscription dialog: Generate fills a serial number, Close starts nothing', async ({ posPage }) => {
    // ACTION: not started → first row → Start subscription → Generate
    await posPage.openNotStartedSubscriptions();
    test.skip((await posPage.rows().count()) === 0, 'no "not started" subscription');
    await posPage.openStartDialogOfFirstRow();
    await posPage.startDialog().getByRole('button', { name: 'Generate' }).click();

    // CHECK: a serial number "SN: …" is shown, plus duration and end date
    await expect(posPage.startDialog().getByText('SN:')).toBeVisible();
    await expect(posPage.startDialog().getByText('Duration:')).toBeVisible();
    await expect(posPage.startDialog().getByText('End date:')).toBeVisible();

    // ACTION: Close
    await posPage.startDialog().getByRole('button', { name: 'Close', exact: true }).click();

    // CHECK: dialog gone
    await expect(posPage.startDialog()).toBeHidden();
  });

  test('starts a subscription with a serial number → the subscription is in the DB', async ({ posPage, db }) => {
    // SETUP: a new serial number
    await posPage.openNotStartedSubscriptions();
    test.skip((await posPage.rows().count()) === 0, 'no "not started" subscription');
    const serialNumber = `qa_auto_sn_${Date.now()}`;

    // ACTION: first row → Start subscription → type serial → Add → Start subscription
    const orderId = await posPage.openStartDialogOfFirstRow();
    await posPage.startDialog().getByRole('textbox', { name: 'Serial number' }).fill(serialNumber);
    await posPage.startDialog().getByRole('button', { name: 'Add', exact: true }).click();
    await posPage.startDialog().getByRole('button', { name: 'Start subscription' }).click();

    // CHECK: dialog closes
    await expect(posPage.startDialog()).toBeHidden({ timeout: 30_000 });

    // CHECK: a subscription with this serial number exists for that order
    await expect
      .poll(() => getOrderIdOfSerial(db.hub, serialNumber), {
        message: `subscription with serial ${serialNumber}`,
        timeout: 30_000,
      })
      .toBe(orderId);
  });
});
