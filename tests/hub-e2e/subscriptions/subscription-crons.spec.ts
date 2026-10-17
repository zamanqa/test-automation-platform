import dayjs from 'dayjs';
import { test, expect } from '@fixtures';
import {
  countDisabledUnsettledPayments,
  countEnabledOpenPayments,
  countExpiredActiveSubscriptions,
  countQueueJobs,
  findCronSubscription,
  findNewEmailEntry,
  findRecurringPaymentsAfter,
  findSubscriptionForAutoRenew,
  findSubscriptionForPendingReturn,
  findSubscriptionForReactivate,
  hasNewEmailEntry,
  getAutoRenewCount,
  getLastEmailEntryId,
  getLastRecurringPaymentId,
  getQueueWorkerCronId,
  getNotifyPendingReturn,
  getReactivatedCount,
  getRenewalAmount,
  getRenewalCycles,
  getSubscriptionSettings,
  setForceReactivate,
  setReturnUntil,
  setReturnUntilDaysAgo,
  setSubscriptionAutoRenew,
  setSubscriptionEndDaysAgo,
  type CronSubscription,
  type SubscriptionSettings,
} from '@db/queries/hub/subscription-crons';
import { getSubscriptionStatus } from '@db/queries/hub/subscriptions';
import type { Database } from '@db/connection';

// Subscription crons started by API: auto renew (sync), expired → pending return, force reactivate.
// Needs: active monthly cms subscriptions, a pending-return subscription with auto_reactivate on.
// Changes data: renews 2 subscriptions, sets 2 to pending return / ended, reactivates 1. force_reactivate stays on.
// Expected values are calculated from subscription_settings of the company, like the hub jobs do.
test.describe.configure({ mode: 'default' });

// the same date maths as PHP strtotime('+N months'): 31 Jan + 1 month = 3 Mar
function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// queues the subscription jobs run on
const SUBSCRIPTION_QUEUES = ['subscription', 'subscriptions'];

// the endpoints only queue jobs: wait until these queues are empty in the jobs table (max 5 minutes)
async function waitForJobs(hub: Database, queues: string[]) {
  await expect
    .poll(() => countQueueJobs(hub, queues), { message: `jobs left in ${queues.join(', ')}`, timeout: 5 * 60_000, intervals: [5_000] })
    .toBe(0);
}

// months a renewal adds: consumable (or "extend by billing cycle" on) counts the billing interval, normal does not
function renewalMonths(settings: SubscriptionSettings, subscription: CronSubscription, cycles: number) {
  if (subscription.subscription_type === 'consumable' || settings.auto_renew_extend_by_billing_cycle) {
    return cycles * subscription.subscription_frequency_interval;
  }
  return cycles;
}

test.describe('Hub - subscription crons', () => {
  test('auto renew extends a normal subscription by one cycle and adds its recurring payment', async ({
    db,
    hubApi,
    hubCompanyId,
    subscriptionListPage,
    subscriptionDetailPage,
    page,
  }) => {
    test.setTimeout(10 * 60_000);

    // SETUP: company settings decide how long the renewal is
    const settings = await getSubscriptionSettings(db.hub, hubCompanyId);
    test.skip(!settings.auto_renew, 'auto renew is off for this company');
    const target = await findSubscriptionForAutoRenew(
      db.hub, hubCompanyId, 'normal', settings.auto_renew_duration, settings.auto_renew_extend_by_billing_cycle, settings.max_duration ?? 0,
    );
    test.skip(!target, 'no active monthly normal subscription that can be renewed');
    const subscriptionId = target!.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });

    // SETUP: the subscription ended yesterday
    await setSubscriptionEndDaysAgo(db.hub, subscriptionId, 1);
    const before = await findCronSubscription(db.hub, subscriptionId);
    const lastRpId = await getLastRecurringPaymentId(db.hub, before.id);

    // expected values (SubscriptionAutoRenewQueue)
    const cycles = await getRenewalCycles(db.hub, hubCompanyId, settings, subscriptionId);
    const months = renewalMonths(settings, before, cycles);
    const expectedEnd = addMonths(before.subscription_end!, months);
    const expectedBillingDate = addDays(before.subscription_end!, 1);
    const expectedAmount = await getRenewalAmount(db.hub, hubCompanyId, before);

    // ACTION: sync queues the auto renew job
    const response = await hubApi.syncSubscription(hubCompanyId, subscriptionId);
    expect(response.status(), 'sync answer status').toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Subscription sync successfully started');
    // run the existing 'subscription' queue worker now (no second job, so no lock clash)
    await hubApi.runCron(hubCompanyId, await getQueueWorkerCronId(db.hub, 'subscription'));

    // WAIT: no job left in the 'subscription' / 'subscriptions' queues
    await waitForJobs(db.hub, SUBSCRIPTION_QUEUES);

    // CHECK: the subscription was renewed
    await expect
      .poll(() => getAutoRenewCount(db.hub, subscriptionId), { message: `auto_renew_count of ${subscriptionId}`, timeout: 5 * 60_000, intervals: [10_000] })
      .toBe((before.auto_renew_count ?? 0) + 1);
    const after = await findCronSubscription(db.hub, subscriptionId);
    expect(after.subscription_end, 'new end = old end + renewal').toBe(expectedEnd);
    expect(after.subscription_duration).toBe(before.subscription_duration + months);
    expect(after.auto_renewed).toBe(true);
    expect(after.next_billing_date, 'next billing date = old end + 1 day').toBe(expectedBillingDate);
    expect(after.status).toBe('active');

    // CHECK: one new recurring payment per renewed cycle, the first on old end + 1 day
    const newPayments = await findRecurringPaymentsAfter(db.hub, before.id, lastRpId);
    expect(newPayments, 'new recurring payments').toHaveLength(cycles);
    expect(newPayments[0].billing_date).toBe(expectedBillingDate);
    expect(Number(newPayments[0].amount)).toBe(expectedAmount);
    expect(newPayments[0].quantity).toBe(before.quantity);
    expect(newPayments[0].payment_settled).toBe(false);

    // CHECK: the hub shows the subscription active with the new recurring payment
    await subscriptionListPage.openSubscription(subscriptionId);
    await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
    await subscriptionDetailPage.showRecurringPayments();
    await expect(page.locator('td', { hasText: new RegExp(`^\\s*${newPayments[0].id}\\s*$`) })).toBeVisible();
  });

  test('auto renew extends a consumable subscription by its billing interval', async ({ db, hubApi, hubCompanyId }) => {
    test.setTimeout(10 * 60_000);

    // SETUP
    const settings = await getSubscriptionSettings(db.hub, hubCompanyId);
    test.skip(!settings.auto_renew, 'auto renew is off for this company');
    const target = await findSubscriptionForAutoRenew(
      db.hub, hubCompanyId, 'consumable', settings.auto_renew_duration, settings.auto_renew_extend_by_billing_cycle, settings.max_duration ?? 0,
    );
    test.skip(!target, 'no active monthly consumable subscription that can be renewed');
    const subscriptionId = target!.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: `${subscriptionId} (interval ${target!.subscription_frequency_interval})` });
    await setSubscriptionEndDaysAgo(db.hub, subscriptionId, 1);
    const before = await findCronSubscription(db.hub, subscriptionId);
    const lastRpId = await getLastRecurringPaymentId(db.hub, before.id);

    // expected values: consumable always counts the interval; a duration that is not a full interval moves the billing date
    const cycles = await getRenewalCycles(db.hub, hubCompanyId, settings, subscriptionId);
    const interval = before.subscription_frequency_interval;
    const months = renewalMonths(settings, before, cycles);
    const offset = (interval - (before.subscription_duration % interval)) % interval;
    const expectedEnd = addMonths(before.subscription_end!, months);
    const expectedBillingDate = addDays(addMonths(before.subscription_end!, offset), 1);

    // ACTION
    const response = await hubApi.syncSubscription(hubCompanyId, subscriptionId);
    expect(response.status(), 'sync answer status').toBe(200);
    // run the existing 'subscription' queue worker now (no second job, so no lock clash)
    await hubApi.runCron(hubCompanyId, await getQueueWorkerCronId(db.hub, 'subscription'));

    // WAIT: no job left in the 'subscription' / 'subscriptions' queues
    await waitForJobs(db.hub, SUBSCRIPTION_QUEUES);

    // CHECK
    await expect
      .poll(() => getAutoRenewCount(db.hub, subscriptionId), { message: `auto_renew_count of ${subscriptionId}`, timeout: 5 * 60_000, intervals: [10_000] })
      .toBe((before.auto_renew_count ?? 0) + 1);
    const after = await findCronSubscription(db.hub, subscriptionId);
    expect(after.subscription_end, `new end = old end + ${cycles} × ${interval} months`).toBe(expectedEnd);
    expect(after.subscription_duration).toBe(before.subscription_duration + months);
    expect(after.next_billing_date).toBe(expectedBillingDate);
    const newPayments = await findRecurringPaymentsAfter(db.hub, before.id, lastRpId);
    expect(newPayments, 'one new recurring payment per interval').toHaveLength(cycles);
    expect(newPayments[0].billing_date).toBe(expectedBillingDate);
  });

  test('sync of an unknown subscription answers 404', async ({ hubApi, hubCompanyId }) => {
    // ACTION
    const response = await hubApi.syncSubscription(hubCompanyId, 'unknown_subscription_id');

    // CHECK
    expect(response.status()).toBe(404);
    expect((await response.json()).message).toBe('Subscription not found.');
  });

  test('an expired normal subscription without auto renew becomes pending return', async ({
    db,
    hubApi,
    hubCompanyId,
    subscriptionListPage,
    page,
  }) => {
    test.setTimeout(10 * 60_000);

    // SETUP: the job handles every expired subscription of the company, so only run when there is none
    const otherExpired = await countExpiredActiveSubscriptions(db.hub, hubCompanyId);
    test.skip(otherExpired > 0, `${otherExpired} other expired active subscriptions would be changed too`);
    const settings = await getSubscriptionSettings(db.hub, hubCompanyId);
    const target = await findSubscriptionForPendingReturn(db.hub, hubCompanyId, 'normal');
    test.skip(!target, 'no active normal subscription with open recurring payments');
    const subscriptionId = target!.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });

    // SETUP: auto renew off, ended 2 days ago (the job takes subscription_end < today - 1 day)
    await setSubscriptionAutoRenew(db.hub, subscriptionId, false);
    await setSubscriptionEndDaysAgo(db.hub, subscriptionId, 2);
    const lastEmailId = await getLastEmailEntryId(db.hub);

    // ACTION: run SubscriptionEndActiveQueue
    const response = await hubApi.launchCron(hubCompanyId, 'SubscriptionEndActiveQueue', 'subscription');
    expect(response.status(), 'system/cron answer status').toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('SubscriptionEndActiveQueue task has been pushed & executed.');

    // WAIT: no job left in the 'subscription' / 'subscriptions' queues
    await waitForJobs(db.hub, SUBSCRIPTION_QUEUES);

    // CHECK: status, dates and reason
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of ${subscriptionId}`, timeout: 5 * 60_000, intervals: [10_000] })
      .toBe('pending return');
    const after = await findCronSubscription(db.hub, subscriptionId);
    const today = dayjs().format('YYYY-MM-DD');
    expect(after.return_until, `return_until = today + ${settings.return_until_period} days`).toBe(addDays(today, settings.return_until_period));
    expect(after.return_reason).toBe('expired');
    expect(after.next_billing_date).toBeNull();
    expect(after.real_end_date).toBe(today);

    // CHECK: open recurring payments are disabled
    expect(await countEnabledOpenPayments(db.hub, after.id), 'enabled open recurring payments').toBe(0);

    // CHECK: the pending-return email is written when the company setting is on (dev SMTP may fail, so success is only info)
    const notifyPendingReturn = await getNotifyPendingReturn(db.hub, hubCompanyId);
    await expect
      .poll(() => hasNewEmailEntry(db.hub, subscriptionId, 'subscription-pending-return', lastEmailId), {
        message: `pending-return email in email_entries (notify_pending_return ${notifyPendingReturn})`,
      })
      .toBe(notifyPendingReturn);
    const email = await findNewEmailEntry(db.hub, subscriptionId, 'subscription-pending-return', lastEmailId);
    test.info().annotations.push({ type: 'INFO email', description: `to ${email?.to}, success ${email?.success} ${email?.error ?? ''}` });

    // CHECK: the hub shows pending return
    await subscriptionListPage.openSubscription(subscriptionId);
    await expect(page.getByText('pending return', { exact: true }).first()).toBeVisible();
  });

  test('an expired digital subscription without auto renew is ended', async ({ db, hubApi, hubCompanyId }) => {
    test.setTimeout(10 * 60_000);

    // SETUP
    const otherExpired = await countExpiredActiveSubscriptions(db.hub, hubCompanyId);
    test.skip(otherExpired > 0, `${otherExpired} other expired active subscriptions would be changed too`);
    const target = await findSubscriptionForPendingReturn(db.hub, hubCompanyId, 'digital');
    test.skip(!target, 'no active digital subscription with open recurring payments');
    const subscriptionId = target!.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });
    await setSubscriptionAutoRenew(db.hub, subscriptionId, false);
    await setSubscriptionEndDaysAgo(db.hub, subscriptionId, 2);

    // ACTION
    const response = await hubApi.launchCron(hubCompanyId, 'SubscriptionEndActiveQueue', 'subscription');
    expect(response.status(), 'system/cron answer status').toBe(200);

    // WAIT: no job left in the 'subscription' / 'subscriptions' queues
    await waitForJobs(db.hub, SUBSCRIPTION_QUEUES);

    // CHECK
    await expect
      .poll(() => getSubscriptionStatus(db.hub, subscriptionId), { message: `status of ${subscriptionId}`, timeout: 5 * 60_000, intervals: [10_000] })
      .toBe('ended');
    const after = await findCronSubscription(db.hub, subscriptionId);
    expect(after.real_end_date).toBe(dayjs().format('YYYY-MM-DD'));
  });

  test('force reactivate makes a pending-return subscription active again', async ({
    db,
    hubApi,
    hubCompanyId,
    cleanup,
    subscriptionListPage,
    page,
  }) => {
    test.setTimeout(10 * 60_000);

    // SETUP: force_reactivate must be on (and stays on after the test)
    await setForceReactivate(db.hub, hubCompanyId, true);
    cleanup.add('force_reactivate on', () => setForceReactivate(db.hub, hubCompanyId, true));
    const settings = await getSubscriptionSettings(db.hub, hubCompanyId);
    const target = await findSubscriptionForReactivate(db.hub, hubCompanyId);
    test.skip(!target, 'no pending-return normal subscription with auto_reactivate on');
    const subscriptionId = target!.subscription_id;
    test.info().annotations.push({ type: 'subscription', description: subscriptionId });

    // SETUP: return_until inside the window (older than reactivate_period days, newer than 2 × reactivate_period)
    await setReturnUntilDaysAgo(db.hub, subscriptionId, settings.reactivate_period + 1);
    const before = await findCronSubscription(db.hub, subscriptionId);
    const lastEmailId = await getLastEmailEntryId(db.hub);

    // ACTION 1: dry run finds the subscription and changes nothing
    const dryRun = await hubApi.processToReactivate(hubCompanyId, { subscription_ids: [subscriptionId], do_not_process: true });
    expect(dryRun.status(), 'dry run answer status').toBe(200);
    const dryBody = await dryRun.json();
    expect(dryBody.success).toBe(true);
    expect(dryBody.message).toBe('Found 1 subscriptions');
    expect(dryBody.subscription_ids).toEqual([subscriptionId]);
    expect(dryBody.reactivate_period).toBe(settings.reactivate_period);
    expect(await getSubscriptionStatus(db.hub, subscriptionId), 'status after the dry run').toBe('pending return');

    // ACTION 2: real run queues the reactivation job for this subscription
    const run = await hubApi.processToReactivate(hubCompanyId, { subscription_ids: [subscriptionId] });
    expect(run.status(), 'run answer status').toBe(200);
    expect((await run.json()).message).toBe('Found 1 subscriptions');
    // run the existing 'notify' queue worker now (no second job)
    await hubApi.runCron(hubCompanyId, await getQueueWorkerCronId(db.hub, 'notify'));

    // WAIT: no job left in the 'subscription' / 'subscriptions' / 'notify' queues
    await waitForJobs(db.hub, ['subscription', 'subscriptions', 'notify']);

    // CHECK: active again, cancellation data cleared, end date unchanged
    await expect
      .poll(() => getReactivatedCount(db.hub, subscriptionId), { message: `reactivated_count of ${subscriptionId}`, timeout: 5 * 60_000, intervals: [10_000] })
      .toBe((before.reactivated_count ?? 0) + 1);
    const after = await findCronSubscription(db.hub, subscriptionId);
    expect(after.status).toBe('active');
    expect(after.return_reason).toBe('Reactivated due to customer no return');
    expect(after.real_end_date).toBeNull();
    expect(after.cancellation_date).toBeNull();
    expect(after.cancellation_type).toBeNull();
    expect(after.cancellation_reason).toBeNull();
    expect(after.cancelled_by_customer).toBe(false);
    expect(after.subscription_end, 'reactivation does not move the end date').toBe(before.subscription_end);
    test.info().annotations.push({ type: 'INFO', description: `auto_renew ${after.auto_renew}, next_billing_date ${after.next_billing_date}` });

    // CHECK: all unsettled recurring payments are enabled again
    expect(await countDisabledUnsettledPayments(db.hub, after.id), 'disabled unsettled recurring payments').toBe(0);

    // CHECK: the reactivated email was written (success only as info)
    await expect
      .poll(() => hasNewEmailEntry(db.hub, subscriptionId, 'subscription-reactivated', lastEmailId), { message: 'reactivated email in email_entries' })
      .toBe(true);
    const email = await findNewEmailEntry(db.hub, subscriptionId, 'subscription-reactivated', lastEmailId);
    test.info().annotations.push({ type: 'INFO email', description: `to ${email!.to}, success ${email!.success} ${email!.error ?? ''}` });

    // CHECK: the hub shows the subscription active
    await subscriptionListPage.openSubscription(subscriptionId);
    await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
  });

  test('force reactivate finds nothing when return_until is outside the window', async ({ db, hubApi, hubCompanyId, cleanup }) => {
    // SETUP
    await setForceReactivate(db.hub, hubCompanyId, true);
    cleanup.add('force_reactivate on', () => setForceReactivate(db.hub, hubCompanyId, true));
    const target = await findSubscriptionForReactivate(db.hub, hubCompanyId);
    test.skip(!target, 'no pending-return normal subscription with auto_reactivate on');
    const subscriptionId = target!.subscription_id;
    cleanup.add('old return_until back', () => setReturnUntil(db.hub, subscriptionId, target!.return_until));
    await setReturnUntilDaysAgo(db.hub, subscriptionId, 0);

    // ACTION
    const response = await hubApi.processToReactivate(hubCompanyId, { subscription_ids: [subscriptionId], do_not_process: true });

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).message).toBe('No subscriptions to process, found 0 records');
    expect(await getSubscriptionStatus(db.hub, subscriptionId)).toBe('pending return');
  });
});
