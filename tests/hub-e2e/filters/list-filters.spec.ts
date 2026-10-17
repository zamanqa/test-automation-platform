import dayjs from 'dayjs';
import { test, expect } from '@fixtures';
import {
  countAssetsByStatusesNameDate,
  countAssetsByStatusesSkuDate,
  countClaimsByStatusStageDate,
  countCustomersByDateBalance,
  countCustomersByEmailDate,
  countInvoicesByPaymentStatusInitialAmount,
  countInvoicesByTypePaidDate,
  countOrdersByEmailDateType,
  countOrdersByStatusesAndVoucher,
  countOrdersByStatusPaymentOrigin,
  countProductsByActiveOrderableStock,
  countRecurringPaymentsBySettledFailedDate,
  countRecurringPaymentsByStatusSystemSubscription,
  countReturnsByStatusTypeSerial,
  countStoresByEnabledName,
  countSubscriptionsByEmailSkuStatuses,
  countSubscriptionsByStatusRenewedEnd,
  countSubscriptionsByStatusTypeFrequency,
  countSubscriptionsByStatusTypeFrequencyCreated,
  countTransactionsByProviderStatusAmount,
  countTransactionsByStatusTypeDate,
  countVouchersByValidOneTimeAmount,
  pickAssetSku,
  pickConsumableOrder,
  pickCustomerEmail,
  pickFailedRecurringPayment,
  pickFailedTransactionType,
  pickOrderVoucherCode,
  pickPendingReturnRenewed,
  pickPendingReturnSerial,
  pickRentedAssetName,
  pickStoreName,
  pickSubscriptionEmailAndSku,
  pickSubscriptionWithSettledStripePayments,
} from '@db/queries/hub/list-filters';

// Hub lists filtered by several parameters at once; the total must match the database.
// Filters are opened by URL in the hub's own format (field=mode:value). Every list gets a default
// "created in the last 30 days" filter from the hub, so each test sets created_at or clears it (created_at=).
// Filter values are picked from real data (never qa_auto). Read-only.
test.describe.configure({ mode: 'default' });

const today = dayjs().format('YYYY-MM-DD');

function daysBefore(date: string, days: number) {
  return dayjs(date).subtract(days, 'day').format('YYYY-MM-DD');
}

test.describe('Hub - list filters with several parameters', () => {
  test('F1 orders: status open + payment status paid + origin checkout', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countOrdersByStatusPaymentOrigin(db.hub, hubCompanyId, 'open', 'paid', 'checkout');
    test.skip(expected === 0, 'no open paid checkout order');

    // ACTION
    await hubListPage.open('orders', { status: 'open', payment_status: 'paid', origin: 'checkout', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'orders: open + paid + checkout');
    await expect(hubListPage.rows).toHaveCount(Math.min(expected, 10));
  });

  test('F2 orders: customer email contains + created between + subscription type consumable', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const order = await pickConsumableOrder(db.hub, hubCompanyId);
    test.skip(!order, 'no consumable order');
    const from = daysBefore(order!.day, 60);
    const expected = await countOrdersByEmailDateType(db.hub, hubCompanyId, order!.email, from, order!.day, 'consumable');
    test.info().annotations.push({ type: 'filters', description: `${order!.email}, ${from} - ${order!.day}` });

    // ACTION
    await hubListPage.open('orders', {
      customer_email: `contains:${order!.email}`,
      created_at: `between:${from}and${order!.day}`,
      subscription_type: 'consumable',
    });

    // CHECK
    await hubListPage.expectTotal(expected, 'orders: email + date + consumable');
  });

  test('F3 orders: status matches open or fulfilled + voucher code', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const voucher = await pickOrderVoucherCode(db.hub, hubCompanyId);
    test.skip(!voucher, 'no order item with a voucher code');
    const expected = await countOrdersByStatusesAndVoucher(db.hub, hubCompanyId, ['open', 'fulfilled'], voucher!.voucher_code);
    test.info().annotations.push({ type: 'voucher', description: voucher!.voucher_code });

    // ACTION
    await hubListPage.open('orders', { status: 'matches:open||fulfilled', voucher_code: voucher!.voucher_code, created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, `orders: open|fulfilled + voucher ${voucher!.voucher_code}`);
  });

  test('F4 subscriptions: status active + type normal + frequency monthly', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countSubscriptionsByStatusTypeFrequency(db.hub, hubCompanyId, 'active', 'normal', 'monthly');
    test.skip(expected === 0, 'no active monthly normal subscription');

    // ACTION
    await hubListPage.open('subscriptions', { status: 'active', subscription_type: 'normal', subscription_frequency: 'monthly', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'subscriptions: active + normal + monthly');
    await expect(hubListPage.rows).toHaveCount(Math.min(expected, 10));
  });

  test('F5 subscriptions: status pending return + auto renewed + end date between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickPendingReturnRenewed(db.hub, hubCompanyId);
    test.skip(!picked, 'no auto-renewed pending-return subscription');
    const from = daysBefore(picked!.day, 60);
    const expected = await countSubscriptionsByStatusRenewedEnd(db.hub, hubCompanyId, 'pending return', true, from, picked!.day);

    // ACTION
    await hubListPage.open('subscriptions', {
      status: 'pending return',
      auto_renewed: 'true',
      subscription_end: `between:${from}and${picked!.day}`,
      created_at: '',
    });

    // CHECK
    await hubListPage.expectTotal(expected, `subscriptions: pending return + auto renewed + end ${from} - ${picked!.day}`);
  });

  test('F6 subscriptions: customer email contains + SKU + status active or cancelled', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickSubscriptionEmailAndSku(db.hub, hubCompanyId);
    test.skip(!picked, 'no active subscription with email and SKU');
    const expected = await countSubscriptionsByEmailSkuStatuses(db.hub, hubCompanyId, picked!.email, picked!.sku, ['active', 'cancelled']);
    test.info().annotations.push({ type: 'filters', description: `${picked!.email}, ${picked!.sku}` });

    // ACTION
    await hubListPage.open('subscriptions', {
      customer_email: `contains:${picked!.email}`,
      item_sku: picked!.sku,
      status: 'matches:active||cancelled',
      created_at: '',
    });

    // CHECK
    await hubListPage.expectTotal(expected, 'subscriptions: email + SKU + active|cancelled');
  });

  test('F7 payments: status failed + invoice type + created between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickFailedTransactionType(db.hub, hubCompanyId);
    test.skip(!picked, 'no failed transaction');
    const from = daysBefore(picked!.day, 90);
    const expected = await countTransactionsByStatusTypeDate(db.hub, hubCompanyId, 'failed', picked!.invoice_type, from, picked!.day);
    test.info().annotations.push({ type: 'invoice type', description: picked!.invoice_type });

    // ACTION
    await hubListPage.open('transactions', {
      status: 'failed',
      invoice_type: picked!.invoice_type,
      created_at: `between:${from}and${picked!.day}`,
    });

    // CHECK
    await hubListPage.expectTotal(expected, `payments: failed + ${picked!.invoice_type} + ${from} - ${picked!.day}`);
  });

  test('F8 payments: provider contains stripe + status succeeded + amount greater than 20', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countTransactionsByProviderStatusAmount(db.hub, hubCompanyId, 'stripe', 'succeeded', 20);
    test.skip(expected === 0, 'no succeeded stripe transaction above 20');

    // ACTION
    await hubListPage.open('transactions', { payment_service_provider: 'contains:stripe', status: 'succeeded', amount: 'greater:20', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'payments: stripe + succeeded + amount > 20');
  });

  test('F9 invoices: type recurring payment + not paid + created in the last 30 days', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const from = daysBefore(today, 30);
    const expected = await countInvoicesByTypePaidDate(db.hub, hubCompanyId, 'recurring payment', false, from, today);
    test.skip(expected === 0, 'no unpaid recurring invoice in the last 30 days');

    // ACTION
    await hubListPage.open('invoices', { type: 'recurring payment', paid: 'false', created_at: `between:${from}and${today}` });

    // CHECK
    await hubListPage.expectTotal(expected, 'invoices: recurring payment + not paid + last 30 days');
  });

  test('F10 invoices: payment status succeeded + initial invoice + amount greater than 20', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const from = daysBefore(today, 365);
    const expected = await countInvoicesByPaymentStatusInitialAmount(db.hub, hubCompanyId, 'succeeded', true, 20, from, today);
    test.skip(expected === 0, 'no succeeded initial invoice above 20 in the last year');

    // ACTION
    await hubListPage.open('invoices', {
      payment_status: 'succeeded',
      initial_invoice: 'true',
      amount: 'greater:20',
      created_at: `between:${from}and${today}`,
    });

    // CHECK
    await hubListPage.expectTotal(expected, 'invoices: succeeded + initial + amount > 20');
  });

  test('F11 recurring payments: not settled + failed + billing date between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickFailedRecurringPayment(db.hub, hubCompanyId);
    test.skip(!picked, 'no failed unsettled recurring payment');
    const from = daysBefore(picked!.day, 90);
    const expected = await countRecurringPaymentsBySettledFailedDate(db.hub, hubCompanyId, false, true, from, picked!.day);

    // ACTION
    await hubListPage.open('recurring-payments', {
      payment_settled: 'false',
      failed: 'true',
      billing_date: `between:${from}and${picked!.day}`,
      created_at: '',
    });

    // CHECK
    await hubListPage.expectTotal(expected, `recurring payments: not settled + failed + ${from} - ${picked!.day}`);
  });

  test('F12 recurring payments: status settled + payment system stripe + subscription id', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickSubscriptionWithSettledStripePayments(db.hub, hubCompanyId);
    test.skip(!picked, 'no subscription with settled stripe recurring payments');
    const expected = await countRecurringPaymentsByStatusSystemSubscription(db.hub, hubCompanyId, 'settled', 'stripe', picked!.subscription_id);
    test.info().annotations.push({ type: 'subscription', description: picked!.subscription_id });

    // ACTION
    await hubListPage.open('recurring-payments', { status: 'settled', payment_system: 'stripe', subscription_id: picked!.subscription_id, created_at: '', billing_date: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'recurring payments: settled + stripe + subscription');
    await expect(hubListPage.rows).toHaveCount(Math.min(expected, 10));
  });

  test('F13 customers: created between + account balance greater than 0', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const from = daysBefore(today, 365);
    const expected = await countCustomersByDateBalance(db.hub, hubCompanyId, from, today, 0);
    test.skip(expected === 0, 'no customer with a balance in the last year');

    // ACTION
    await hubListPage.open('customers', { created_at: `between:${from}and${today}`, account_balance: 'greater:0', customer_type: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'customers: last year + balance > 0');
  });

  test('F14 customers: email contains + created between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickCustomerEmail(db.hub, hubCompanyId);
    test.skip(!picked, 'no customer');
    const domain = picked!.email.split('@')[1];
    const from = daysBefore(picked!.day, 90);
    const expected = await countCustomersByEmailDate(db.hub, hubCompanyId, domain, from, picked!.day);
    test.info().annotations.push({ type: 'filters', description: `${domain}, ${from} - ${picked!.day}` });

    // ACTION
    await hubListPage.open('customers', { email: `contains:${domain}`, created_at: `between:${from}and${picked!.day}`, customer_type: '' });

    // CHECK
    await hubListPage.expectTotal(expected, `customers: email contains ${domain} + date`);
  });

  test('F15 debt collection: status open + stage precourt + created between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const from = daysBefore(today, 730);
    const expected = await countClaimsByStatusStageDate(db.hub, hubCompanyId, 'open', 'precourt', from, today);
    test.skip(expected === 0, 'no open precourt claim');

    // ACTION
    await hubListPage.open('debt-collection', { status: 'open', stage: 'precourt', created_at: `between:${from}and${today}` });

    // CHECK
    await hubListPage.expectTotal(expected, 'claims: open + precourt + last 2 years');
  });

  test('F16 returns: status pending return + type normal + serial number contains', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickPendingReturnSerial(db.hub, hubCompanyId);
    test.skip(!picked, 'no normal pending-return subscription with a serial number');
    const expected = await countReturnsByStatusTypeSerial(db.hub, hubCompanyId, 'pending return', 'normal', picked!.serial_number);

    // ACTION
    await hubListPage.open('returns', { status: 'pending return', subscription_type: 'normal', serial_number: `contains:${picked!.serial_number}`, created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, `returns: pending return + normal + serial ${picked!.serial_number}`);
  });

  test('F17 assets: location status in stock + SKU', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickAssetSku(db.hub, hubCompanyId, 'in stock');
    test.skip(!picked, 'no in-stock asset');
    const expected = await countAssetsByStatusesSkuDate(db.hub, hubCompanyId, ['in stock'], picked!.sku, picked!.first_day, picked!.last_day);
    test.info().annotations.push({ type: 'SKU', description: picked!.sku });

    // ACTION
    await hubListPage.open('assets', { location_status: 'in stock', sku: picked!.sku, created_at: `between:${picked!.first_day}and${picked!.last_day}` });

    // CHECK
    await hubListPage.expectTotal(expected, `assets: in stock + SKU ${picked!.sku}`);
  });

  test('F18 assets: status rented out or reserved + product name contains + created between', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickRentedAssetName(db.hub, hubCompanyId);
    test.skip(!picked, 'no rented-out asset');
    const from = daysBefore(picked!.day, 180);
    const statuses = ['rented out', 'reserved'];
    const expected = await countAssetsByStatusesNameDate(db.hub, hubCompanyId, statuses, picked!.product_name, from, picked!.day);
    test.info().annotations.push({ type: 'filters', description: `${picked!.product_name}, ${from} - ${picked!.day}` });

    // ACTION
    await hubListPage.open('assets', {
      location_status: 'matches:rented out||reserved',
      product_name: `contains:${picked!.product_name}`,
      created_at: `between:${from}and${picked!.day}`,
    });

    // CHECK
    await hubListPage.expectTotal(expected, 'assets: rented out|reserved + name + date');
  });

  test('F19 repairs: SKU + created between (status to repair is fixed)', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickAssetSku(db.hub, hubCompanyId, 'to repair');
    test.skip(!picked, 'no asset to repair');
    const expected = await countAssetsByStatusesSkuDate(db.hub, hubCompanyId, ['to repair'], picked!.sku, picked!.first_day, picked!.last_day);
    test.info().annotations.push({ type: 'filters', description: `${picked!.sku}, ${picked!.first_day} - ${picked!.last_day}` });

    // ACTION
    await hubListPage.open('repairs', { sku: picked!.sku, created_at: `between:${picked!.first_day}and${picked!.last_day}` });

    // CHECK
    await hubListPage.expectTotal(expected, `repairs: SKU ${picked!.sku} + date`);
  });

  test('F20 products: active + allow order create + stock greater than 0', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countProductsByActiveOrderableStock(db.hub, hubCompanyId, true, true, 0);
    test.skip(expected === 0, 'no active orderable product in stock');

    // ACTION
    await hubListPage.open('products', { active: 'true', allow_order_create: 'true', stock: 'greater:0', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'products: active + orderable + stock > 0');
  });

  test('F21 vouchers: valid + not one-time use + discount amount greater than 0', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const expected = await countVouchersByValidOneTimeAmount(db.hub, hubCompanyId, true, false, 0);
    test.skip(expected === 0, 'no valid multi-use amount voucher');

    // ACTION
    await hubListPage.open('vouchers', { valid: 'true', one_time_use: 'false', discount_amount: 'greater:0', created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, 'vouchers: valid + multi-use + amount > 0');
  });

  test('F22 stores: enabled + name contains', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const picked = await pickStoreName(db.hub, hubCompanyId);
    test.skip(!picked, 'no enabled store');
    const word = picked!.name.split(' ')[0];
    const expected = await countStoresByEnabledName(db.hub, hubCompanyId, true, word);
    test.info().annotations.push({ type: 'name contains', description: word });

    // ACTION
    await hubListPage.open('stores', { enabled: 'true', name: `contains:${word}`, created_at: '' });

    // CHECK
    await hubListPage.expectTotal(expected, `stores: enabled + name contains ${word}`);
  });

  test('F23 filters stay in the URL and give the same total after a reload', async ({ db, hubCompanyId, hubListPage, page }) => {
    // SETUP: a real date range (an empty created_at= is dropped from the URL, then the 30-day default comes back)
    const from = daysBefore(today, 730);
    const expected = await countSubscriptionsByStatusTypeFrequencyCreated(db.hub, hubCompanyId, 'active', 'consumable', 'monthly', from, today);
    test.skip(expected === 0, 'no active monthly consumable subscription');
    await hubListPage.open('subscriptions', {
      status: 'active',
      subscription_type: 'consumable',
      subscription_frequency: 'monthly',
      created_at: `between:${from}and${today}`,
    });
    await hubListPage.expectTotal(expected, 'subscriptions before the reload');

    // ACTION
    await page.reload();

    // CHECK
    await hubListPage.expectTotal(expected, 'subscriptions after the reload');
    expect(hubListPage.urlFilter('status')).toBe('active');
    expect(hubListPage.urlFilter('subscription_type')).toBe('consumable');
    expect(hubListPage.urlFilter('subscription_frequency')).toBe('monthly');
    expect(hubListPage.urlFilter('created_at')).toBe(`between:${from}and${today}`);
  });

  test('F24 the filtered total stays the same on page 2', async ({ db, hubCompanyId, hubListPage, page }) => {
    // SETUP: a filter with more than 10 rows
    const expected = await countSubscriptionsByStatusTypeFrequency(db.hub, hubCompanyId, 'active', 'normal', 'monthly');
    test.skip(expected <= 10, 'fewer than 11 rows, there is no page 2');
    await hubListPage.open('subscriptions', { status: 'active', subscription_type: 'normal', subscription_frequency: 'monthly', created_at: '' });
    await hubListPage.expectTotal(expected, 'page 1');

    // ACTION
    await page.getByTestId('btn-next-page').first().click();

    // CHECK
    await expect(hubListPage.paginationText).toContainText('11-');
    await hubListPage.expectTotal(expected, 'page 2');
    expect(hubListPage.urlFilter('status')).toBe('active');
  });
});
