import { test, expect } from '@fixtures';
import { countOpenRecurringPayments } from '@db/queries/hub/recurring-payments';
import {
  countBuyoutInvoices,
  findSubscriptionForActions,
  getAutoReactivate,
  getBillingInterval,
  getExtensionPrice,
  getPrepaidMonths,
  getSubscriptionDuration,
  getSubscriptionPrice,
  getSerialNumber,
  getSubscriptionQuantity,
  getSubscriptionStatus,
  setSubscriptionStatus,
  setSubscriptionType,
  setSubscriptionTypeAndQuantity,
} from '@db/queries/hub/subscriptions';

// Hub → subscription page → menu actions.
// Needs: active normal checkout subscriptions longer than 3 cycles.
// Changes data: a lot - auto renew, buyout, interval, quantity, length and price, extension price,
// extend, reactivate, serial, end, pending return, swap. Several subscriptions get used up.
// Each test picks a subscription again, because earlier tests end, buy out or swap theirs.
test.describe.configure({ mode: 'default' });

test.describe('Hub - subscription actions', () => {
  let subscriptionId: string;

  // pick a suitable active subscription and open it
  test.beforeEach(async ({ db, hubCompanyId, subscriptionListPage }) => {
    const subscription = await findSubscriptionForActions(db.hub, hubCompanyId);
    subscriptionId = subscription.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });
    await subscriptionListPage.openSubscription(subscriptionId);
  });

  test('turns auto-renew off and on again', async ({ subscriptionDetailPage }) => {
    // ACTION + CHECK: turn it off, then on again (each time the switch must flip)
    await subscriptionDetailPage.toggleAutoRenew(true);
    await subscriptionDetailPage.toggleAutoRenew(false);
  });

  test('turns auto-reactivate off and on again', async ({ subscriptionDetailPage, db, page }) => {
    // ACTION: menu → Auto-reactivate subscription → Disable
    await subscriptionDetailPage.toggleAutoReactivate(true);

    // CHECK: auto_reactivate = false in the database
    await expect
      .poll(() => getAutoReactivate(db.hub, subscriptionId), { message: `auto_reactivate of subscription ${subscriptionId}` })
      .toBe(false);

    // ACTION: reload (the menu keeps the old state) → Auto-reactivate subscription → Enable
    await page.reload();
    await subscriptionDetailPage.toggleAutoReactivate(false);

    // CHECK: auto_reactivate = true again
    await expect
      .poll(() => getAutoReactivate(db.hub, subscriptionId), { message: `auto_reactivate of subscription ${subscriptionId}` })
      .toBe(true);
  });

  test('buys out the subscription and creates the buyout invoice', async ({ subscriptionDetailPage, db }) => {
    // SETUP: number of buyout invoices before
    const invoicesBefore = await countBuyoutInvoices(db.hub, subscriptionId);

    // ACTION: menu → Buyout → invoice line text → submit
    await subscriptionDetailPage.buyout('Buyout Tip Gratuity white');

    // CHECK: status 'bought out' or 'pending buyout'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toMatch(/^(bought out|pending buyout)$/);

    // CHECK: within 1 minute there is a buyout invoice
    await expect
      .poll(() => countBuyoutInvoices(db.hub, subscriptionId), {
        message: `buyout invoice of subscription ${subscriptionId}`,
        timeout: 60_000,
        intervals: [5_000],
      })
      .toBe(invoicesBefore + 1);
  });

  test('changes the billing interval', async ({ subscriptionDetailPage, db }) => {
    // SETUP: current interval
    const current = await getBillingInterval(db.hub, subscriptionId);
    let next = '1';
    if (current === '1') next = '2';

    // ACTION: menu → Change billing frequency → interval → Save changes
    await subscriptionDetailPage.changeBillingInterval(next);

    // CHECK: the new interval is in the database
    await expect
      .poll(() => getBillingInterval(db.hub, subscriptionId), { message: `billing interval of subscription ${subscriptionId}` })
      .toBe(next);
  });

  test('changes the quantity of a consumable subscription to 5', async ({ subscriptionDetailPage, db, cleanup, page }) => {
    // SETUP: quantity can only be changed on consumables, so make it consumable with quantity 2
    await setSubscriptionTypeAndQuantity(db.hub, subscriptionId, 'consumable', 2);
    // back to normal / 2 after the test, also when it fails
    cleanup.add('restore type and quantity', () => setSubscriptionTypeAndQuantity(db.hub, subscriptionId, 'normal', 2));
    await page.reload();

    // ACTION: menu → Change quantity → 5 → Save changes
    await subscriptionDetailPage.changeQuantity(5);

    // CHECK: quantity 5 in the database
    await expect
      .poll(() => getSubscriptionQuantity(db.hub, subscriptionId), { message: `quantity of subscription ${subscriptionId}` })
      .toBe(5);
  });

  test('changes subscription length and installment price', async ({ subscriptionDetailPage, db }) => {
    // SETUP: prepaid months (the database stores duration = length - prepaid months)
    const prepaidMonths = await getPrepaidMonths(db.hub, subscriptionId);

    // ACTION: menu → Change subscription attributes → length 12, installment price 22 → Submit → success
    await subscriptionDetailPage.changeAttributes('12', '22');

    // CHECK: price 22 and duration 12 - prepaid months (e.g. 12 - 1 = 11)
    await expect
      .poll(() => getSubscriptionPrice(db.hub, subscriptionId), { message: `price of subscription ${subscriptionId}` })
      .toBe('22.0000');
    expect(await getSubscriptionDuration(db.hub, subscriptionId), `duration of subscription ${subscriptionId}`).toBe(12 - prepaidMonths);
  });

  test('changes the extension price to 20', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Change subscription extension price → 20 → Confirm → success
    await subscriptionDetailPage.changeExtensionPrice('20');

    // CHECK: extension price 20 in the database
    await expect
      .poll(() => getExtensionPrice(db.hub, subscriptionId), { message: `extension price of subscription ${subscriptionId}` })
      .toBe(20);
  });

  test('extends the subscription by 5 cycles', async ({ subscriptionDetailPage, db }) => {
    // SETUP: duration, billing interval and open recurring payments before.
    // Duration is in months: 5 cycles with interval 2 = 10 months.
    const durationBefore = await getSubscriptionDuration(db.hub, subscriptionId);
    const interval = Number(await getBillingInterval(db.hub, subscriptionId));
    const openPaymentsBefore = await countOpenRecurringPayments(db.hub, subscriptionId);

    // ACTION: menu → Extend subscription → 5 → Confirm → success
    await subscriptionDetailPage.extend('5');

    // CHECK: duration + 5 × interval, and 5 more open recurring payments
    await expect
      .poll(() => getSubscriptionDuration(db.hub, subscriptionId), { message: `duration of subscription ${subscriptionId}` })
      .toBe(durationBefore! + 5 * interval);
    await expect
      .poll(() => countOpenRecurringPayments(db.hub, subscriptionId), { message: `open recurring payments of ${subscriptionId}` })
      .toBe(openPaymentsBefore + 5);
  });

  test('reactivates a subscription pending return', async ({ subscriptionDetailPage, db, page }) => {
    // SETUP: set it to 'pending return' in the database, reload
    await setSubscriptionStatus(db.hub, subscriptionId, 'pending return');
    await page.reload();

    // ACTION: menu → Reactivate subscription → Confirm
    await subscriptionDetailPage.confirmAction('Reactivate subscription');

    // CHECK: status 'active'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('active');
  });

  test('replaces the serial number', async ({ subscriptionDetailPage, db }) => {
    // SETUP: current serial
    const previous = (await getSerialNumber(db.hub, subscriptionId)) ?? '';
    const next = `SN-${Date.now()}`;

    // ACTION: menu → Replace serial number → new + previous → Confirm
    await subscriptionDetailPage.replaceSerialNumber(previous, next);

    // CHECK: the new serial is in the database
    await expect
      .poll(() => getSerialNumber(db.hub, subscriptionId), { message: `serial number of subscription ${subscriptionId}` })
      .toBe(next);
  });

  test('sets a digital subscription as ended', async ({ subscriptionDetailPage, db, page }) => {
    // SETUP: "Set as ended" is only offered for digital, so change the type in the database
    await setSubscriptionType(db.hub, subscriptionId, 'digital');
    await page.reload();

    // ACTION: menu → Set as ended → Confirm
    await subscriptionDetailPage.confirmAction('Set as ended');

    // CHECK: status 'ended'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('ended');
  });

  test('sets the subscription to pending return', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Set as pending return → tick consent → Confirm
    await subscriptionDetailPage.confirmAction('Set as pending return', { checkConsent: true });

    // CHECK: status 'pending return'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('pending return');
  });

  test('swaps the subscription item', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Swap subscription item → Continue → Submit
    await subscriptionDetailPage.swapItem();

    // CHECK: status 'pending replacement'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('pending replacement');
  });

  test('opens the order from the menu', async ({ subscriptionDetailPage, page }) => {
    // ACTION: menu → View order
    await subscriptionDetailPage.runAction('View order');

    // CHECK: an order page is open
    await expect(page).toHaveURL(/\/orders\//);
  });
});
