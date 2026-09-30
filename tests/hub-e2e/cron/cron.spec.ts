// dayjs            = date library (today, yesterday, tomorrow)
// test, expect     ← src/fixtures/index.ts (gives: db, hubApi, hubCompanyId, cleanup)
// queuedJobCount   ← src/api/hub-api/HubApiClient.ts (reads "num of required queues: N" from a message)
// cron helpers     ← src/db/queries/hub/crons.ts
// invoice helpers  ← src/db/queries/hub/invoices.ts
// RP helpers       ← src/db/queries/hub/recurring-payments.ts
// countPendingTransactions ← src/db/queries/hub/transactions.ts
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

/**
 * WHAT:   Hub back-end crons (no browser): recurring payments → invoices → charging.
 * FROM:   hub-e2e-automation cypress/e2e/03-cron/
 *           recurringPaymentProcess.cy.js and testInvoiceChargeProcess.cy.js (1 test each).
 * CHANGES DATA: yes — billing dates of 4 recurring payments, creates + charges invoices,
 *         switches ALL hub crons off during test 1; afterwards ALL crons are switched ON again (owner's rule: never leave them off).
 *
 * The invoice-charge test charges the invoices the first test creates. In Cypress they
 * were passed through cypress/fixtures/testData.json; here the two tests share one file
 * and run in order ('serial': the second is skipped if the first fails).
 *
 * hubApi = HubApiClient: logs in to the hub (Lumen) API with HUB_API_EMAIL/PASSWORD (.env)
 * and triggers the same jobs the crons would.
 */
test.describe.configure({ mode: 'serial' });

// Queue names in the hub `jobs` table used by these crons
const RP_QUEUES = ['rp', 'invoiceCharge'];
// Filled by test 1 (ids of the invoices it created), read by test 2
let createdInvoiceIds: string[] = [];

test.describe('Hub - cron processing', () => {
  test('recurring payments due today or earlier become invoices, future ones do not', async ({ db, hubApi, hubCompanyId, cleanup }) => {
    test.setTimeout(15 * 60_000); // background jobs → up to 15 minutes

    // SETUP 1: only the rp + invoiceCharge workers may run; clear old unprocessed jobs
    await disableAllCrons(db.hub);                                  // ALL crons off (global!)
    cleanup.add('crons back on', () => resetAllCrons(db.hub));      // afterwards ALL crons on again, also on failure
    await enableQueueWorkers(db.hub, RECURRING_PAYMENT_QUEUES);     // workers of the rp + invoiceCharge queues
    await deleteStaleJobsOf(db.hub, RP_QUEUES);

    // SETUP 2: subscription with 4 open recurring payments ← hub db; set their billing dates:
    //   rp1 = today, rp2 = yesterday, rp3 = yesterday  → due    → must get an invoice
    //   rp4 = tomorrow                                 → future → must NOT get one
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

    // ACTION: ask the hub API to queue the recurring-payment jobs for that company
    const response = await hubApi.triggerRecurringPayments(target.company_id);
    const body = await response.json();
    expect(body.success, `recurring-payment trigger answer: ${JSON.stringify(body)}`).toBe(true);
    expect(queuedJobCount(body.message), `queue count in "${body.message}"`).toBeGreaterThanOrEqual(1);
    await expect.poll(() => countJobs(db.hub, RP_QUEUES), { message: 'jobs in the rp / invoiceCharge queues' }).toBeGreaterThan(0);

    // CHECK 1: every 15s (max 10 min — the rp worker takes 5 jobs per round, so it can be slow) until rp1, rp2 and rp3 all have an invoice (or cumulated invoice).
    // Was a fixed 2 min wait plus up to 3 retries of 1 min.
    const duePayments = [target.rp1, target.rp2, target.rp3];
    await expect
      .poll(() => countInvoicedPayments(db.hub, duePayments), {
        message: `recurring payments ${duePayments.join(', ')} with an invoice`,
        timeout: 10 * 60_000,
        intervals: [15_000],
      })
      .toBe(3);

    // CHECK 2: the future payment (rp4) got no invoice
    expect(await countInvoicedPayments(db.hub, [target.rp4]), `recurring payment ${target.rp4} (due tomorrow) must not be invoiced`).toBe(0);

    // Remember the invoice ids for test 2 (invoice_id, or cumulated_invoice_id when payments were combined)
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

    // SETUP: company + invoice numbers of the invoices from test 1 ← hub db
    //        (the query returns each invoice once, even if two payments share a cumulated invoice)
    expect(createdInvoiceIds.length, 'invoices created by the previous test').toBeGreaterThan(0);
    const invoices = await findInvoicesByIds(db.hub, createdInvoiceIds);
    const companyId = invoices[0].company_id;
    const invoiceNumbers: string[] = [];
    for (const invoice of invoices) invoiceNumbers.push(invoice.invoice_number);
    test.info().annotations.push({ type: 'invoices', description: invoiceNumbers.join(', ') });

    // SETUP: ALL crons on (as in Cypress) — and they stay on afterwards; clear old jobs
    await enableAllCrons(db.hub);
    await deleteStaleJobsOf(db.hub, RP_QUEUES);

    // ACTION: ask the hub API to queue the invoice-charge jobs
    const response = await hubApi.triggerInvoiceCharge(companyId);
    const body = await response.json();
    expect(body.success, `invoice-charge trigger answer: ${JSON.stringify(body)}`).toBe(true);
    expect(queuedJobCount(body.message), `queue count in "${body.message}"`).toBeGreaterThanOrEqual(1);
    await expect.poll(() => countJobs(db.hub, ['invoiceCharge']), { message: 'jobs in the invoiceCharge queue' }).toBeGreaterThan(0);

    // CHECK: every 15s (max 10 min) until no transaction of those invoices is 'pending' any more
    await expect
      .poll(() => countPendingTransactions(db.hub, invoiceNumbers), {
        message: `pending transactions of invoices ${invoiceNumbers.join(', ')}`,
        timeout: 10 * 60_000,
        intervals: [15_000],
      })
      .toBe(0);
  });
});
