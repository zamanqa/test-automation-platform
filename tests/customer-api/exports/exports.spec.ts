import { test, expect } from '@fixtures';
import { findOldestCustomer } from '@db/queries/hub/customers';
import { findLatestOrder } from '@db/queries/hub/orders';
import { findLatestActiveSubscription } from '@db/queries/hub/subscriptions';

/**
 * WHAT:   OLD Customer API — exports. POST /CSV answers with CSV text right away;
 *         POST /export starts a background export (JSON) and answers with its key.
 *         "ids" = only these rows, "exclude" = leave out these columns, "rename" = new column name.
 * FROM:   Postman collection "circuly_customers API (2025-01) Main" → V1_5 / CSV. New in Playwright.
 * NEEDS:  an order, a customer and an active subscription of the company (ids are read from the hub db).
 * CHANGES DATA: no (the background export only writes an export file).
 */

/**
 * CHECK: the answer is a CSV download (status 200 + "Content-Disposition: attachment; filename=<name>.csv").
 * The API sends Content-Type "text/html" instead of "text/csv" (API bug, 2026-09-29) → not a failure,
 * but shown as an INFO note in the report so the bug stays visible (owner's choice).
 */
function expectCsvDownload(response: { status(): number; headers(): Record<string, string> }, fileName: string) {
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition'], 'download header').toContain(`filename="${fileName}"`);
  const type = response.headers()['content-type'] ?? '';
  if (!type.includes('text/csv')) {
    test.info().annotations.push({ type: 'INFO: API bug', description: `Content-Type is "${type}", expected "text/csv"` });
  }
}

/** The first line of a CSV = the column names. */
function columnsOf(csv: string) {
  return csv.split('\n')[0].split(',');
}

test.describe('Customer API - exports', () => {
  test('exports one order as CSV without customer_id and with tag_date renamed', async ({ customerApi, db }) => {
    // SETUP: newest order of the company
    const order = await findLatestOrder(db.hub, customerApi.companyId);

    // ACTION: POST /CSV
    const response = await customerApi.exports.csv({
      type: 'orders',
      ids: [order.order_id],
      exclude: ['customer_id'],
      rename: { tag_date: 'tag_date_new' },
    });

    // CHECK: a CSV download with the order in it; customer_id left out; tag_date renamed
    expectCsvDownload(response, 'orders.csv');
    const csv = await response.text();
    expect(csv).toContain(order.order_id);
    expect(columnsOf(csv)).toContain('tag_date_new');
    expect(columnsOf(csv)).not.toContain('tag_date');
    expect(columnsOf(csv)).not.toContain('customer_id');
  });

  test('exports one customer as CSV without last_name and with phone renamed', async ({ customerApi, db }) => {
    // SETUP: first customer of the company
    const customer = await findOldestCustomer(db.hub, customerApi.companyId);

    // ACTION: POST /CSV
    const response = await customerApi.exports.csv({
      type: 'customers',
      ids: [customer.uid],
      exclude: ['last_name'],
      rename: { phone: 'phone_new' },
    });

    // CHECK: a CSV download with the customer in it; last_name left out; phone renamed
    expectCsvDownload(response, 'customers.csv');
    const csv = await response.text();
    expect(csv).toContain(customer.uid);
    expect(columnsOf(csv)).toContain('phone_new');
    expect(columnsOf(csv)).not.toContain('phone');
    expect(columnsOf(csv)).not.toContain('last_name');
  });

  test('exports one subscription as CSV without serial_number and with frequency renamed', async ({ customerApi, db }) => {
    // SETUP: newest active subscription of the company
    const subscription = await findLatestActiveSubscription(db.hub, customerApi.companyId);

    // ACTION: POST /CSV
    const response = await customerApi.exports.csv({
      type: 'subscriptions',
      ids: [subscription.subscription_id],
      exclude: ['serial_number'],
      rename: { subscription_frequency: 'frequency' },
    });

    // CHECK: a CSV download with the subscription in it; serial_number left out; subscription_frequency renamed
    expectCsvDownload(response, 'subscriptions.csv');
    const csv = await response.text();
    expect(csv).toContain(subscription.subscription_id);
    expect(columnsOf(csv)).toContain('frequency');
    expect(columnsOf(csv)).not.toContain('subscription_frequency');
    expect(columnsOf(csv)).not.toContain('serial_number');
  });

  test('exports transactions as CSV', async ({ customerApi }) => {
    // ACTION: POST /CSV — the 3 newest transactions
    const response = await customerApi.exports.csv({ type: 'transactions', limit: 3 });

    // CHECK: a CSV download with transaction columns and at least one row
    expectCsvDownload(response, 'transactions.csv');
    const csv = await response.text();
    expect(columnsOf(csv)).toContain('invoice_number');
    expect(columnsOf(csv)).toContain('amount');
    expect(csv.trim().split('\n').length).toBeGreaterThan(1);
  });

  test('exports recurring payments as CSV', async ({ customerApi }) => {
    // ACTION: POST /CSV — the 3 newest recurring payments
    const response = await customerApi.exports.csv({ type: 'recurring-payments', limit: 3 });

    // CHECK: a CSV download with at least one row
    expectCsvDownload(response, 'recurring-payments.csv');
    const csv = await response.text();
    expect(columnsOf(csv)).toContain('id');
    expect(csv.trim().split('\n').length).toBeGreaterThan(1);
  });

  test('starts a JSON export of invoices', async ({ customerApi }) => {
    // ACTION: POST /export — invoices of January 2025 as JSON
    const response = await customerApi.exports.start({
      type: 'invoices',
      limit: 10,
      from: '01-01-2025',
      until: '01-02-2025',
      format: 'json',
    });

    // CHECK: the export started and we got a key to download it later
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.message).toBe('Export process started.');
    expect(body.type).toBe('invoices');
    expect(body.key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
