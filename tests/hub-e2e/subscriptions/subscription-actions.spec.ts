// test, expect     ← src/fixtures/index.ts
// find... / get... / set... ← src/db/queries/hub/subscriptions.ts
// countOpenRecurringPayments ← src/db/queries/hub/recurring-payments.ts
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

/**
 * WHAT:   Hub UI → Subscription detail → 3-dot menu actions (13 from Cypress + auto-reactivate, 2026-09-28).
 * FROM:   hub-e2e-automation cypress/e2e/02-subscription-page/subscriptionDetail.cy.js (13 tests).
 * NEEDS:  active normal checkout subscriptions longer than 3 cycles.
 * CHANGES DATA: yes, heavily — auto-renew, BUYOUT, interval, quantity, length/price, extension
 *         price, extend, reactivate, serial, END, pending return, SWAP (several subscriptions used up).
 * Each test picks the latest suitable active subscription again, because earlier tests
 * end, buy out or swap the one they used.
 * subscriptionListPage / subscriptionDetailPage ← src/pages/hub/SubscriptionListPage.ts / SubscriptionDetailPage.ts
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - subscription actions', () => {
  let subscriptionId: string; // set in beforeEach

  // Before each test: pick a suitable active subscription ← hub db, then open its detail page
  // (openSubscription = list → search → click → wait for /subscriptions/ URL)
  test.beforeEach(async ({ db, hubCompanyId, subscriptionListPage }) => {
    const subscription = await findSubscriptionForActions(db.hub, hubCompanyId);
    subscriptionId = subscription.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });
    await subscriptionListPage.openSubscription(subscriptionId);
  });

  test('turns auto-renew off and on again', async ({ subscriptionDetailPage }) => {
    // ACTION + CHECK: toggleAutoRenew(currentlyOn) checks the dialog text, submits and
    // checks the switch flipped. true = it is on now → turn off; then false → turn on.
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
    // SETUP: buyout invoices of this subscription before ← hub db
    const invoicesBefore = await countBuyoutInvoices(db.hub, subscriptionId);

    // ACTION: menu → Buyout → invoice line text → submit
    await subscriptionDetailPage.buyout('Buyout Tip Gratuity white');

    // CHECK: database status becomes 'bought out' or 'pending buyout'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toMatch(/^(bought out|pending buyout)$/);
    // CHECK: within 1 minute a buyout invoice exists for it (owner's rule: invoice after at most 1 min)
    await expect
      .poll(() => countBuyoutInvoices(db.hub, subscriptionId), {
        message: `buyout invoice of subscription ${subscriptionId}`,
        timeout: 60_000,
        intervals: [5_000],
      })
      .toBe(invoicesBefore + 1);
  });

  test('changes the billing interval', async ({ subscriptionDetailPage, db }) => {
    // SETUP: current interval ← hub db; new interval = 2 if it is 1 now, else 1
    const current = await getBillingInterval(db.hub, subscriptionId);
    let next = '1';
    if (current === '1') next = '2';

    // ACTION: menu → Change billing frequency → interval → Save changes
    await subscriptionDetailPage.changeBillingInterval(next);

    // CHECK: database interval is the new one
    await expect
      .poll(() => getBillingInterval(db.hub, subscriptionId), { message: `billing interval of subscription ${subscriptionId}` })
      .toBe(next);
  });

  test('changes the quantity of a consumable subscription to 5', async ({ subscriptionDetailPage, db, cleanup, page }) => {
    // SETUP: quantity can only be changed on consumables → make it consumable/2 in the database
    await setSubscriptionTypeAndQuantity(db.hub, subscriptionId, 'consumable', 2);
    // Undo: back to normal/2. Cypress did this only after a passing run; this also runs on failure.
    cleanup.add('restore type and quantity', () => setSubscriptionTypeAndQuantity(db.hub, subscriptionId, 'normal', 2));
    await page.reload(); // so the page shows the new type

    // ACTION: menu → Change quantity → 5 → Save changes
    await subscriptionDetailPage.changeQuantity(5);

    // CHECK: database quantity is 5
    await expect
      .poll(() => getSubscriptionQuantity(db.hub, subscriptionId), { message: `quantity of subscription ${subscriptionId}` })
      .toBe(5);
  });

  test('changes subscription length and installment price', async ({ subscriptionDetailPage, db }) => {
    // SETUP: prepaid months ← order_items.subscription_duration_prepaid
    //        (the database stores: duration = length in the hub − prepaid months)
    const prepaidMonths = await getPrepaidMonths(db.hub, subscriptionId);

    // ACTION: menu → Change subscription attributes → length 12, installment price 22 → Submit → success
    await subscriptionDetailPage.changeAttributes('12', '22');

    // CHECK: database price is 22 and duration is 12 − prepaid months (e.g. 12 − 1 = 11)
    await expect
      .poll(() => getSubscriptionPrice(db.hub, subscriptionId), { message: `price of subscription ${subscriptionId}` })
      .toBe('22.0000');
    expect(await getSubscriptionDuration(db.hub, subscriptionId), `duration of subscription ${subscriptionId}`).toBe(12 - prepaidMonths);
  });

  test('changes the extension price to 20', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Change subscription extension price → 20 → Confirm → success
    await subscriptionDetailPage.changeExtensionPrice('20');

    // CHECK: database extension price is 20
    await expect
      .poll(() => getExtensionPrice(db.hub, subscriptionId), { message: `extension price of subscription ${subscriptionId}` })
      .toBe(20);
  });

  test('extends the subscription by 5 cycles', async ({ subscriptionDetailPage, db }) => {
    // SETUP: duration, billing interval and open recurring payments before ← hub db
    //        (duration counts months: 5 cycles with interval 2 = 10 months; the interval test above switches 1 ↔ 2)
    const durationBefore = await getSubscriptionDuration(db.hub, subscriptionId);
    const interval = Number(await getBillingInterval(db.hub, subscriptionId));
    const openPaymentsBefore = await countOpenRecurringPayments(db.hub, subscriptionId);

    // ACTION: menu → Extend subscription → 5 → Confirm → success
    await subscriptionDetailPage.extend('5');

    // CHECK: duration + 5 × interval, and 5 more open recurring payments in the database
    await expect
      .poll(() => getSubscriptionDuration(db.hub, subscriptionId), { message: `duration of subscription ${subscriptionId}` })
      .toBe(durationBefore! + 5 * interval);
    await expect
      .poll(() => countOpenRecurringPayments(db.hub, subscriptionId), { message: `open recurring payments of ${subscriptionId}` })
      .toBe(openPaymentsBefore + 5);
  });

  test('reactivates a subscription pending return', async ({ subscriptionDetailPage, db, page }) => {
    // SETUP: put it into 'pending return' in the database, reload the page
    await setSubscriptionStatus(db.hub, subscriptionId, 'pending return');
    await page.reload();

    // ACTION: menu → Reactivate subscription → Confirm
    await subscriptionDetailPage.confirmAction('Reactivate subscription');

    // CHECK: database status 'active'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('active');
  });

  test('replaces the serial number', async ({ subscriptionDetailPage, db }) => {
    // SETUP: current serial ← hub db; new unique serial "SN-<timestamp>"
    const previous = (await getSerialNumber(db.hub, subscriptionId)) ?? '';
    const next = `SN-${Date.now()}`;

    // ACTION: menu → Replace serial number → new + previous → Confirm
    await subscriptionDetailPage.replaceSerialNumber(previous, next);

    // CHECK: database serial is the new one
    await expect
      .poll(() => getSerialNumber(db.hub, subscriptionId), { message: `serial number of subscription ${subscriptionId}` })
      .toBe(next);
  });

  test('sets a digital subscription as ended', async ({ subscriptionDetailPage, db, page }) => {
    // SETUP: "Set as ended" is only offered for digital → change type in the database, reload
    await setSubscriptionType(db.hub, subscriptionId, 'digital');
    await page.reload();

    // ACTION: menu → Set as ended → Confirm
    await subscriptionDetailPage.confirmAction('Set as ended');

    // CHECK: database status 'ended'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('ended');
  });

  test('sets the subscription to pending return', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Set as pending return → tick consent → Confirm
    await subscriptionDetailPage.confirmAction('Set as pending return', { checkConsent: true });

    // CHECK: database status 'pending return'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('pending return');
  });

  test('swaps the subscription item', async ({ subscriptionDetailPage, db }) => {
    // ACTION: menu → Swap subscription item → Continue → Submit
    await subscriptionDetailPage.swapItem();

    // CHECK: database status 'pending replacement'
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of subscription ${subscriptionId}` })
      .toBe('pending replacement');
  });

  test('opens the order from the menu', async ({ subscriptionDetailPage, page }) => {
    // ACTION: menu → View order
    await subscriptionDetailPage.runAction('View order');

    // CHECK: now on an order page
    await expect(page).toHaveURL(/\/orders\//);
  });
});
