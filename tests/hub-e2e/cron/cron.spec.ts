import dayjs from 'dayjs';
import { test, expect } from '@fixtures';
import { queuedJobCount } from '@api/hub-api/HubApiClient';
import {
  countJobs,
  deleteStaleJobsOf,
  disableAllCrons,
  enableAllCrons,
  enableQueueWorkers,
  RECURRING_PAYMENT_QUEUES,
  resetAllCrons,
} from '@db/queries/hub/crons';
import { findInvoiceById, findInvoicesByIds } from '@db/queries/hub/invoices';
import {
  countInvoicedPayments,
  findLatestSubscriptionWithFourOpenPayments,
  findPaymentInvoices,
  setBillingDate,
} from '@db/queries/hub/recurring-payments';
import { countPendingTransactions } from '@db/queries/hub/transactions';

// Hub crons (no browser): recurring payments → invoices → charging.
// Changes data: sets the billing date of 4 recurring payments, creates and charges invoices.
// All hub crons are off during test 1 and switched on again afterwards (never leave them off).
//
// Test 2 charges the invoices that test 1 created, so they run in order ('serial':
// test 2 is skipped if test 1 fails). hubApi starts the same jobs the crons would.
test.describe.configure({ mode: 'serial' });

// queue names in the hub jobs table
const RP_QUEUES = ['rp', 'invoiceCharge'];
// invoice ids created by test 1, used by test 2
let createdInvoiceIds: string[] = [];

test.describe('Hub - cron processing', () => {
  test('recurring payments due today or earlier become invoices, future ones do not', async ({ db, hubApi, hubCompanyId, cleanup }) => {
    test.setTimeout(15 * 60_000); // background jobs, up to 15 minutes

    // SETUP 1: only the rp and invoiceCharge workers may run; clear old jobs
    await disableAllCrons(db.hub);
    cleanup.add('crons back on', () => resetAllCrons(db.hub));
    await enableQueueWorkers(db.hub, RECURRING_PAYMENT_QUEUES);
    await deleteStaleJobsOf(db.hub, RP_QUEUES);

    // SETUP 2: subscription with 4 open recurring payments
    // rp1 today, rp2 and rp3 yesterday → due, must get an invoice
    // rp4 tomorrow → not due, must not get one
    const target = await findLatestSubscriptionWithFourOpenPayments(db.hub, hubCompanyId);
    test.info().annotations.push({
      type: 'recurring payments',
      description: `subscription ${target.subscription_id}: rp1 ${target.rp1}, rp2 ${target.rp2}, rp3 ${target.rp3}, rp4 ${target.rp4}`,
    });
    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    await setBillingDate(db.hub, target.rp1, today);
    await setBillingDate(db.hub, target.rp2, yesterday);
    await setBillingDate(db.hub, target.rp3, yesterday);
    await setBillingDate(db.hub, target.rp4, tomorrow);

    // ACTION: start the recurring payment jobs of that company
    const response = await hubApi.triggerRecurringPayments(target.company_id);
    const body = await response.json();
    expect(body.success, `recurring-payment trigger answer: ${JSON.stringify(body)}`).toBe(true);
    expect(queuedJobCount(body.message), `queue count in "${body.message}"`).toBeGreaterThanOrEqual(1);
    await expect.poll(() => countJobs(db.hub, RP_QUEUES), { message: 'jobs in the rp / invoiceCharge queues' }).toBeGreaterThan(0);

    // CHECK 1: within 10 minutes rp1, rp2 and rp3 all have an invoice (or a cumulated invoice).
    // The rp worker takes 5 jobs per round, so this can be slow.
    const duePayments = [target.rp1, target.rp2, target.rp3];
    await expect
      .poll(() => countInvoicedPayments(db.hub, duePayments), {
        message: `recurring payments ${duePayments.join(', ')} with an invoice`,
        timeout: 10 * 60_000,
        intervals: [15_000],
      })
      .toBe(3);

    // CHECK 2: rp4 got no invoice
    expect(await countInvoicedPayments(db.hub, [target.rp4]), `recurring payment ${target.rp4} (due tomorrow) must not be invoiced`).toBe(0);

    // keep the invoice ids for test 2 (cumulated_invoice_id when payments were combined)
    createdInvoiceIds = [];
    for (const payment of await findPaymentInvoices(db.hub, duePayments)) {
      createdInvoiceIds.push(payment.invoice_id ?? payment.cumulated_invoice_id ?? '');
    }

    // CHECK 3: each new invoice has an HTML body and no errors
    for (const id of createdInvoiceIds) {
      const invoice = await findInvoiceById(db.hub, id);
      expect(invoice?.body, `invoice ${id}: body must not be empty`).toBeTruthy();
      expect(invoice!.body!.toLowerCase(), `invoice ${id}: body must be HTML`).toMatch(/<html|<body|<table|<div/);
      expect(invoice!.errors, `invoice ${id}: errors must be empty`).toBeNull();
    }
  });

  test('the invoice-charge cron settles the new invoices', async ({ db, hubApi }) => {
    test.setTimeout(15 * 60_000);

    // SETUP: the invoices from test 1 (each only once, also when two payments share one)
    expect(createdInvoiceIds.length, 'invoices created by the previous test').toBeGreaterThan(0);
    const invoices = await findInvoicesByIds(db.hub, createdInvoiceIds);
    const companyId = invoices[0].company_id;
    const invoiceNumbers: string[] = [];
    for (const invoice of invoices) invoiceNumbers.push(invoice.invoice_number);
    test.info().annotations.push({ type: 'invoices', description: invoiceNumbers.join(', ') });

    // SETUP: all crons on (they stay on); clear old jobs
    await enableAllCrons(db.hub);
    await deleteStaleJobsOf(db.hub, RP_QUEUES);

    // ACTION: start the invoice charge jobs
    const response = await hubApi.triggerInvoiceCharge(companyId);
    const body = await response.json();
    expect(body.success, `invoice-charge trigger answer: ${JSON.stringify(body)}`).toBe(true);
    expect(queuedJobCount(body.message), `queue count in "${body.message}"`).toBeGreaterThanOrEqual(1);
    await expect.poll(() => countJobs(db.hub, ['invoiceCharge']), { message: 'jobs in the invoiceCharge queue' }).toBeGreaterThan(0);

    // CHECK: within 10 minutes no transaction of those invoices is pending
    await expect
      .poll(() => countPendingTransactions(db.hub, invoiceNumbers), {
        message: `pending transactions of invoices ${invoiceNumbers.join(', ')}`,
        timeout: 10 * 60_000,
        intervals: [15_000],
      })
      .toBe(0);
  });
});
