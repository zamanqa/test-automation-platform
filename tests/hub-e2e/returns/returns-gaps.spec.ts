import dayjs from 'dayjs';
import { test, expect } from '@fixtures';
import {
  countOpenEnabledRps,
  countReturnsList,
  findPendingReturn,
  findReturnCandidate,
  getSubscriptionAssetStatus,
  getSubscriptionEnd,
} from '@db/queries/hub/returns-more';

// Hub → Returns: the cases that were missing - Mark as returned ends the subscription and disables open RPs,
// the same with "Delete future recurring payments" off, Mark as bought, list counts and status filter, search by order id.
// Needs: 3 active normal subscriptions with a unique serial, an asset row and open recurring payments.
// Changes data: ends 2 subscriptions (asset 'to repair') and buys out 1 (asset 'bought out'). This cannot be undone.
test.describe.configure({ mode: 'default' });

test.describe('Hub - returns gaps', () => {
  // a failed test restarts the worker and empties this list; the picker also skips ended subscriptions
  const used: string[] = [];

  test('RT1 Mark as returned ends the subscription and disables its open recurring payments', async ({ db, hubCompanyId, returnsAndRepairsPage, page }) => {
    // SETUP
    const sub = await findReturnCandidate(db.hub, hubCompanyId, used);
    test.skip(!sub, 'no active normal subscription with a serial and open RPs');
    used.push(sub!.subscription_id);
    test.info().annotations.push({ type: 'subscription', description: `${sub!.subscription_id} / ${sub!.serial_number}` });

    // ACTION: Handle → "Delete future recurring payments" stays ticked → Mark as returned
    const dialog = await returnsAndRepairsPage.openHandle(sub!.serial_number);
    await expect(dialog.getByRole('checkbox', { name: 'Delete future recurring payments' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Mark as returned' }).click();
    await expect(page.getByText('Successfully requested!')).toBeVisible();

    // CHECK: ended today, asset to repair, no open enabled RPs left (they are disabled, not deleted)
    await expect.poll(async () => (await getSubscriptionEnd(db.hub, sub!.subscription_id)).status, { message: 'subscription status' }).toBe('ended');
    expect((await getSubscriptionEnd(db.hub, sub!.subscription_id)).real_end_date, 'real_end_date').toBe(dayjs().format('YYYY-MM-DD'));
    expect(await getSubscriptionAssetStatus(db.hub, hubCompanyId, sub!.subscription_id), 'asset status').toBe('to repair');
    expect(await countOpenEnabledRps(db.hub, sub!.id), 'open enabled RPs').toBe(0);
  });

  test('RT2 Mark as returned with "Delete future recurring payments" off keeps the open recurring payments', async ({ db, hubCompanyId, returnsAndRepairsPage, page }) => {
    // SETUP
    const sub = await findReturnCandidate(db.hub, hubCompanyId, used);
    test.skip(!sub, 'no active normal subscription with a serial and open RPs');
    used.push(sub!.subscription_id);
    const openBefore = await countOpenEnabledRps(db.hub, sub!.id);
    test.info().annotations.push({ type: 'subscription', description: `${sub!.subscription_id} / ${openBefore} open RPs` });

    // ACTION: untick the checkbox → Mark as returned
    const dialog = await returnsAndRepairsPage.openHandle(sub!.serial_number);
    await dialog.getByRole('checkbox', { name: 'Delete future recurring payments' }).uncheck();
    await dialog.getByRole('button', { name: 'Mark as returned' }).click();
    await expect(page.getByText('Successfully requested!')).toBeVisible();

    // CHECK: ended, but the open RPs are still enabled
    await expect.poll(async () => (await getSubscriptionEnd(db.hub, sub!.subscription_id)).status, { message: 'subscription status' }).toBe('ended');
    expect(await countOpenEnabledRps(db.hub, sub!.id), 'open enabled RPs').toBe(openBefore);
  });

  test('RT3 Mark as bought sets the subscription to manual bought out and the asset to bought out', async ({ db, hubCompanyId, returnsAndRepairsPage, page }) => {
    // SETUP
    const sub = await findReturnCandidate(db.hub, hubCompanyId, used);
    test.skip(!sub, 'no active normal subscription with a serial and open RPs');
    used.push(sub!.subscription_id);
    test.info().annotations.push({ type: 'subscription', description: `${sub!.subscription_id} / ${sub!.serial_number}` });

    // ACTION
    const dialog = await returnsAndRepairsPage.openHandle(sub!.serial_number);
    await dialog.getByRole('button', { name: 'Mark as bought' }).click();
    await expect(page.getByText('Successfully requested!')).toBeVisible();

    // CHECK: status 'manual bought out' (hub = manual), not 'ended', ended today, asset bought out, open RPs disabled
    await expect.poll(async () => (await getSubscriptionEnd(db.hub, sub!.subscription_id)).status, { message: 'subscription status' }).toBe('manual bought out');
    expect((await getSubscriptionEnd(db.hub, sub!.subscription_id)).real_end_date, 'real_end_date').toBe(dayjs().format('YYYY-MM-DD'));
    expect(await getSubscriptionAssetStatus(db.hub, hubCompanyId, sub!.subscription_id), 'asset status').toBe('bought out');
    expect(await countOpenEnabledRps(db.hub, sub!.id), 'open enabled RPs').toBe(0);
  });

  test('RT4 the list total and the "pending return" filter match the database', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const all = await countReturnsList(db.hub, hubCompanyId);
    const pending = await countReturnsList(db.hub, hubCompanyId, 'pending return');

    // ACTION + CHECK: whole list (default date filter cleared)
    await hubListPage.open('returns', { created_at: '' });
    await hubListPage.expectTotal(all, 'returns list: active + pending return + pending replacement');

    // ACTION + CHECK: status filter
    await hubListPage.open('returns', { status: 'pending return', created_at: '' });
    await hubListPage.expectTotal(pending, 'returns list: pending return');
  });

  test('RT5 search by order id shows its subscription', async ({ db, hubCompanyId, returnsAndRepairsPage, page }) => {
    // SETUP
    const sub = await findPendingReturn(db.hub, hubCompanyId);
    test.skip(!sub, 'no pending return subscription');

    // ACTION
    await returnsAndRepairsPage.searchReturns(sub!.order_id);

    // CHECK: a row links to that order
    await expect(page.locator(`tbody a[href*="/orders/${sub!.order_id}"]`).first()).toBeVisible({ timeout: 30_000 });
  });
});
