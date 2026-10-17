import { test, expect } from '@fixtures';
import { readCssData } from '@data/css';
import { findCustomer } from '@db/queries/hub/customers';
import { getInvoiceNumber } from '@db/queries/hub/invoices';
import { getBillingInterval, getSerialNumber, getSubscriptionQuantity } from '@db/queries/hub/subscriptions';

// CSS pages that the other files do not cover: logout and login page, 404 and unknown ids, invoice / order /
// subscription / delivery details, orders list, profile, and the quantity + frequency forms with wrong values.
// Needs: .auth/css-data.json from 01-css-login.spec.ts.
// Changes data: no (forms are opened and closed without saving; wrong values are refused).
test.describe('CSS - portal pages and checks', () => {
  test.beforeEach(async ({ cssPage }) => {
    const data = readCssData();
    test.skip(!data, 'no .auth/css-data.json, run 01-css-login.spec.ts first');
    await cssPage.loginFromHub(data!.customerId);
  });

  test('Logout goes to the login page, the dashboard then needs a login again', async ({ cssPage }) => {
    // ACTION: Logout
    await cssPage.page.getByRole('button', { name: 'Logout' }).click();

    // CHECK: login page
    await expect(cssPage.page).toHaveURL(/\/en\/auth\/login/);
    await expect(cssPage.page.getByRole('button', { name: 'Send one-time-password' })).toBeVisible();

    // ACTION + CHECK: the dashboard opens the login page
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/dashboard`);
    await expect(cssPage.page).toHaveURL(/\/en\/auth\/login/);
    await expect(cssPage.page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  });

  test('login page: a wrong or empty email is refused, "Revoke your order" opens the revoke page', async ({ cssPage }) => {
    // SETUP: logged out
    await cssPage.page.getByRole('button', { name: 'Logout' }).click();
    await expect(cssPage.page).toHaveURL(/\/en\/auth\/login/);

    // ACTION + CHECK: wrong email
    await cssPage.page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
    await cssPage.page.getByRole('button', { name: 'Send one-time-password' }).click();
    await expect(cssPage.page.getByText('Email must be valid.')).toBeVisible();
    await expect(cssPage.page).toHaveURL(/\/en\/auth\/login/);

    // ACTION + CHECK: empty email
    await cssPage.page.getByRole('textbox', { name: 'Email' }).fill('');
    await cssPage.page.getByRole('button', { name: 'Send one-time-password' }).click();
    await expect(cssPage.page.getByText('Email must be valid.')).toBeVisible();

    // ACTION + CHECK: Revoke your order
    await cssPage.page.getByRole('button', { name: 'Revoke your order' }).click();
    await expect(cssPage.page).toHaveURL(/\/en\/public\/revoke/);
    await expect(cssPage.page.getByRole('textbox', { name: 'Order number' })).toBeVisible();
    await expect(cssPage.page.getByRole('button', { name: 'Check order' })).toBeVisible();
  });

  test('an unknown page shows the 404 page, "Take me back" goes to the dashboard', async ({ cssPage }) => {
    // ACTION: open a page that does not exist
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/does-not-exist`);

    // CHECK: 404 page with the path
    await expect(cssPage.page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(cssPage.page.getByText('Page not found: /en/css/does-not-exist')).toBeVisible();

    // ACTION + CHECK: Take me back
    await cssPage.page.getByRole('button', { name: 'Take me back' }).click();
    await expect(cssPage.page).toHaveURL(/\/en\/css\/dashboard/);
  });

  test('an unknown invoice id shows "Invoice not found."', async ({ cssPage }) => {
    // ACTION
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/invoices/999999999`);

    // CHECK
    await expect(cssPage.page.getByRole('heading', { name: 'Invoice details' })).toBeVisible();
    await expect(cssPage.page.getByText('Invoice not found.')).toBeVisible();
  });

  test('an unknown subscription id shows a not-found message, no empty form', async ({ cssPage }) => {
    // Fails today: an empty details page with "subscription.frequencyAndInterval.undefined" and a working "Report an issue" form (bug CIR-1594)
    // ACTION
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/subscriptions/sub_00000000`);
    await expect(cssPage.page.getByRole('heading', { name: 'Subscription details' })).toBeVisible();

    // CHECK: no raw translation key, no action form
    await expect.soft(cssPage.page.getByText('subscription.frequencyAndInterval.undefined')).toHaveCount(0);
    await expect.soft(cssPage.page.getByRole('button', { name: 'Send' })).toHaveCount(0);

    // CHECK: a not-found message like the invoice page
    await expect(cssPage.page.getByText(/not found/i)).toBeVisible();
  });

  test('an unknown order id shows a not-found message, no empty order', async ({ cssPage }) => {
    // Fails today: an empty order page with "Payment provider not recognized" and "Edit customer details" (bug CIR-1594)
    // ACTION
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/orders/0000000`);
    await expect(cssPage.page.getByRole('heading', { name: 'Order details' })).toBeVisible();

    // CHECK: no empty order with actions
    await expect.soft(cssPage.page.getByText('Payment provider not recognized')).toHaveCount(0);
    await expect.soft(cssPage.page.getByRole('button', { name: 'Edit customer details' })).toHaveCount(0);

    // CHECK: a not-found message like the invoice page
    await expect(cssPage.page.getByText(/not found/i)).toBeVisible();
  });

  test('dashboard invoices: "Load more" shows more invoices', async ({ cssPage }) => {
    // SETUP: invoices shown on the dashboard
    const downloadButtons = cssPage.page.getByRole('button', { name: 'Download invoice' });
    await expect(downloadButtons.first()).toBeVisible();
    const before = await downloadButtons.count();
    test.skip(!(await cssPage.page.getByRole('button', { name: 'Load more' }).isVisible()), 'all invoices fit on the first page');

    // ACTION
    await cssPage.page.getByRole('button', { name: 'Load more' }).click();

    // CHECK: more rows than before
    await expect.poll(() => downloadButtons.count(), { message: 'invoice rows after Load more' }).toBeGreaterThan(before);
  });

  test('invoice details: number and type, PDF download, "View order" opens the order', async ({ cssPage, db }) => {
    // SETUP: first invoice of the normal subscription
    const data = readCssData()!;
    const invoiceId = data.normal.invoiceIds[0];
    const invoiceNumber = await getInvoiceNumber(db.hub, invoiceId);
    const origin = new URL(cssPage.page.url()).origin;

    // ACTION
    await cssPage.page.goto(`${origin}/en/css/invoices/${invoiceId}`);

    // CHECK: number, type and the product row
    await expect(cssPage.page.getByRole('heading', { name: invoiceNumber, level: 4 })).toBeVisible();
    await expect(cssPage.page.getByRole('definition').filter({ hasText: 'Recurring payment' })).toBeVisible();
    await expect(cssPage.page.getByRole('cell', { name: data.normal.product })).toBeVisible();

    // ACTION + CHECK: Download invoice → <invoice number>.pdf
    const download = cssPage.page.waitForEvent('download');
    await cssPage.page.getByRole('button', { name: 'Download invoice' }).click();
    expect((await download).suggestedFilename()).toBe(`${invoiceNumber}.pdf`);

    // ACTION + CHECK: View order
    await cssPage.page.getByRole('button', { name: 'View order' }).click();
    await expect(cssPage.page).toHaveURL(new RegExp(`/en/css/orders/${data.orderId}`));
    await expect(cssPage.page.getByRole('heading', { name: data.orderId, level: 4 })).toBeVisible();
  });

  test('subscription details: serial number from the DB, the order number opens the order', async ({ cssPage, db }) => {
    // SETUP
    const data = readCssData()!;
    const serial = await getSerialNumber(db.hub, data.consumable.subscriptionId);
    const origin = new URL(cssPage.page.url()).origin;

    // ACTION
    await cssPage.page.goto(`${origin}/en/css/subscriptions/${data.consumable.subscriptionId}`);

    // CHECK: product and serial number
    await expect(cssPage.page.getByRole('heading', { name: data.consumable.product, level: 4 })).toBeVisible();
    await expect(cssPage.page.getByRole('definition').filter({ hasText: serial! })).toBeVisible();

    // ACTION + CHECK: order number button
    await cssPage.page.getByRole('button', { name: data.orderId }).click();
    await expect(cssPage.page).toHaveURL(new RegExp(`/en/css/orders/${data.orderId}`));
  });

  test('orders list: the test order is shown, "Show consumable orders" adds other orders, a row opens its details', async ({ cssPage }) => {
    // SETUP
    const data = readCssData()!;
    const origin = new URL(cssPage.page.url()).origin;

    // ACTION: Orders page
    await cssPage.page.goto(`${origin}/en/css/orders`);

    // CHECK: the CSS test order is in the list
    await expect(cssPage.page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
    await expect(cssPage.page.getByRole('cell', { name: data.orderId })).toBeVisible();

    // ACTION: show consumable orders
    await cssPage.page.getByRole('switch', { name: 'Show consumable orders' }).click();
    await expect(cssPage.page.getByRole('switch', { name: 'Show consumable orders' })).toBeChecked();

    // CHECK: the list now shows other orders (the "Add new product" orders)
    const firstRow = cssPage.page.locator('tbody tr').first();
    await expect(firstRow).not.toContainText(data.orderId);
    const orderNumber = (await firstRow.getByRole('cell').first().innerText()).trim();
    test.skip(orderNumber === 'No data available', 'the customer has no consumable orders');

    // ACTION + CHECK: the row arrow opens that order
    await firstRow.getByRole('button').click();
    await expect(cssPage.page).toHaveURL(new RegExp(`/en/css/orders/${orderNumber}`));
    await expect(cssPage.page.getByRole('heading', { name: orderNumber, level: 4 })).toBeVisible();
  });

  test('order details: "Edit customer details" shows the billing address filled in', async ({ cssPage }) => {
    // SETUP
    const data = readCssData()!;
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/orders/${data.orderId}`);

    // ACTION
    await cssPage.page.getByRole('button', { name: 'Edit customer details' }).click();

    // CHECK: the form has the saved address (not saved again)
    await expect(cssPage.page.getByRole('textbox', { name: 'Firstname *' }).first()).not.toHaveValue('');
    await expect(cssPage.page.getByRole('textbox', { name: 'Street *' }).first()).not.toHaveValue('');
    await expect(cssPage.page.getByRole('textbox', { name: 'City *' }).first()).not.toHaveValue('');
    await expect(cssPage.page.getByRole('button', { name: /^Country \*/ }).first()).toContainText('Germany');
  });

  test('profile: name and email from the DB, "Edit customer" shows them in the form', async ({ cssPage, db }) => {
    // SETUP
    const data = readCssData()!;
    const customer = await findCustomer(db.hub, data.customerId);
    const origin = new URL(cssPage.page.url()).origin;

    // ACTION
    await cssPage.page.goto(`${origin}/en/css/profile`);

    // CHECK: name and email
    await expect(cssPage.page.getByRole('heading', { name: `${customer!.first_name} ${customer!.last_name}`, level: 4 })).toBeVisible();
    await expect(cssPage.page.getByText(customer!.email)).toBeVisible();

    // ACTION: Edit customer
    await cssPage.page.getByRole('button', { name: 'Edit customer' }).click();

    // CHECK: the form is filled with the same data
    await expect(cssPage.page.getByRole('textbox', { name: 'Firstname *' })).toHaveValue(customer!.first_name);
    await expect(cssPage.page.getByRole('textbox', { name: 'Lastname *' })).toHaveValue(customer!.last_name);
    await expect(cssPage.page.getByRole('textbox', { name: 'Email *' })).toHaveValue(customer!.email);

    // ACTION + CHECK: Cancel closes the form
    await cssPage.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(cssPage.page.getByRole('textbox', { name: 'Email *' })).toBeHidden();
  });

  test('deliveries: the period list has 1 to 12 months, the first delivery opens its details', async ({ cssPage }) => {
    // SETUP
    const origin = new URL(cssPage.page.url()).origin;
    await cssPage.page.goto(`${origin}/en/css/deliveries`);
    await expect(cssPage.page.getByRole('heading', { name: 'Deliveries', level: 1 })).toBeVisible();

    // ACTION: open the period list
    await cssPage.page.getByRole('button', { name: 'Show deliveries for the next 6 months' }).click();

    // CHECK: the options
    await expect(cssPage.page.getByRole('option')).toHaveText(['1 month', '3 months', '6 months', '9 months', '12 months']);
    await cssPage.page.keyboard.press('Escape');

    // ACTION: arrow of the first delivery
    const firstRow = cssPage.page.locator('tbody tr').first();
    test.skip((await firstRow.innerText()).includes('No data available'), 'no upcoming delivery');
    await firstRow.getByRole('button').click();

    // CHECK: Delivery details page of a date
    await expect(cssPage.page).toHaveURL(/\/en\/css\/deliveries\/\d{4}-\d{2}-\d{2}/);
    await expect(cssPage.page.getByRole('heading', { name: 'Delivery details', level: 1 })).toBeVisible();
  });

  test('consumable: quantity 0 is refused and not saved', async ({ cssPage, db }) => {
    // SETUP: quantity before
    const data = readCssData()!;
    const before = await getSubscriptionQuantity(db.hub, data.consumable.subscriptionId);
    await cssPage.openSubscriptionAction(data.consumable.subscriptionId, 'quantity_change');

    // ACTION: quantity 0 → Save changes
    await cssPage.page.getByRole('spinbutton', { name: 'Quantity' }).fill('0');
    await cssPage.page.getByRole('button', { name: 'Save changes' }).click();

    // CHECK: a message, quantity unchanged in the DB
    await expect(cssPage.page.getByText(/greater than or equal to 1|at least 1/i)).toBeVisible();
    expect(await getSubscriptionQuantity(db.hub, data.consumable.subscriptionId)).toBe(before);
  });

  test('consumable: delivery interval 0 is refused and not saved', async ({ cssPage, db }) => {
    // SETUP: interval before
    const data = readCssData()!;
    const before = await getBillingInterval(db.hub, data.consumable.subscriptionId);
    await cssPage.openSubscriptionAction(data.consumable.subscriptionId, 'frequency_change');

    // CHECK: the time unit list has weekly and monthly
    await cssPage.page.getByRole('button', { name: /^Time unit/ }).click();
    await expect(cssPage.page.getByRole('option')).toHaveText(['weekly', 'monthly']);
    await cssPage.page.keyboard.press('Escape');

    // ACTION: interval 0 → Save changes
    await cssPage.page.getByRole('spinbutton', { name: 'Interval' }).fill('0');
    await cssPage.page.getByRole('button', { name: 'Save changes' }).click();

    // CHECK: a message, interval unchanged in the DB
    await expect(cssPage.page.getByText(/greater than or equal to 1|at least 1/i)).toBeVisible();
    expect(await getBillingInterval(db.hub, data.consumable.subscriptionId)).toBe(before);
  });
});
