// test, expect ← src/fixtures/index.ts
// customer queries ← src/db/queries/hub/customers.ts
import { test, expect } from '@fixtures';
import {
  countCustomerNotes,
  findLatestCustomerWithOrder,
  getCustomerLocale,
  setCustomerLocale,
} from '@db/queries/hub/customers';
import { findCheckoutOrderNotInSubscriptions, getOrderCustomerId } from '@db/queries/hub/orders';

/**
 * WHAT:   Hub UI → Customers list and customer page (no Cypress tests existed; added 2026-09-28):
 *         search, tabs, account balance, language (default locale), Login CSS, Process open orders,
 *         notes.
 * NEEDS:  a customer with at least one order; for "Process open orders" a checkout order that is not in subscriptions.
 * CHANGES DATA: yes — account balance +5 and −5 again, language changed (put back), a note.
 * customerPage methods ← src/pages/hub/CustomerPage.ts
 */
test.describe.configure({ mode: 'default' });

test.describe('Hub - customers', () => {
  let uid: string; // customer used by the tests below

  test.beforeEach(async ({ db, hubCompanyId }) => {
    const customer = await findLatestCustomerWithOrder(db.hub, hubCompanyId);
    test.skip(!customer, 'No customer with an order in the database');
    uid = customer!.uid;
    test.info().annotations.push({ type: 'customer', description: uid });
  });

  test('finds a customer by id in the list', async ({ customerPage }) => {
    // ACTION + CHECK: list without filters → search the customer id → its row shows
    await customerPage.openList();
    await customerPage.search(uid);
  });

  test('shows orders, history and account balance on the customer page', async ({ customerPage }) => {
    // ACTION: open the customer
    await customerPage.open(uid);

    // CHECK: the General tab lists the orders; History has rows. (Account balance may be empty → only opened.)
    await customerPage.expectTabHasRows('General');
    await customerPage.expectTabHasRows('History');
    await customerPage.openTab('Account balance');
  });

  test('adds 5 € to the account balance and removes it again', async ({ customerPage }) => {
    // SETUP: open the customer, remember the balance shown in "Insights"
    await customerPage.open(uid);
    const before = await customerPage.customerBalance().innerText();

    // ACTION: Change account balance → +5 → Submit
    await customerPage.changeAccountBalance('5', 'QA automation: +5');
    // CHECK: after a reload the balance is different from before
    await customerPage.open(uid);
    await expect(customerPage.customerBalance(), 'customer balance after +5').not.toHaveText(before);

    // ACTION: Change account balance → −5 → Submit (back to the old balance)
    await customerPage.changeAccountBalance('-5', 'QA automation: -5 (undo)');
    // CHECK: the balance is the old one again
    await customerPage.open(uid);
    await expect(customerPage.customerBalance(), 'customer balance after −5').toHaveText(before);
  });

  test('changes the customer language (default locale)', async ({ customerPage, db, cleanup }) => {
    // SETUP: current language ← hub db; put it back afterwards. New language = Deutsch, or English if already German (options: Deutsch | English).
    const oldLocale = (await getCustomerLocale(db.hub, uid)) ?? null;
    cleanup.add('restore language', () => setCustomerLocale(db.hub, uid, oldLocale));
    let language = 'Deutsch';
    let expectedLocale = 'de';
    if (oldLocale?.startsWith('de')) {
      language = 'English';
      expectedLocale = 'en';
    }
    await customerPage.open(uid);

    // ACTION: Edit → Default locale → language → consent → Submit
    await customerPage.changeLanguage(language);

    // CHECK: customers.default_locale is the new language
    await expect.poll(() => getCustomerLocale(db.hub, uid), { message: `default_locale of customer ${uid}` }).toBe(expectedLocale);
  });

  test('opens the Self-Service Portal with "Login CSS"', async ({ customerPage }) => {
    // ACTION + CHECK: Login CSS → the Self-Service Portal (css....) opens for this customer
    await customerPage.open(uid);
    await customerPage.loginToSelfServicePortal();
  });

  test('shows the open orders in "Process open orders"', async ({ customerPage, db, hubCompanyId, page }) => {
    // SETUP: checkout order that is NOT in the subscriptions table + its customer id ← hub db
    //        (the customer of beforeEach may have no such order → the button is disabled)
    const order = await findCheckoutOrderNotInSubscriptions(db.hub, hubCompanyId);
    test.skip(!order, 'No checkout order without subscription in the database');
    test.info().annotations.push({ type: 'order / customer', description: `${order!.order_id} / ${order!.customer_id}` });

    // SETUP CHECK: the order page offers "Process subscriptions" for this order
    await page.goto(`en/cms/orders/${order!.order_id}`);
    await expect(page.getByRole('button', { name: 'Process subscriptions' }), 'order can be processed').toBeEnabled();

    // ACTION: open the order's customer → Process open orders → read the order shown → Close (nothing created)
    await customerPage.open(order!.customer_id);
    const shownOrderId = await customerPage.openAndCloseProcessOpenOrders();

    // CHECK: the order shown in the dialog belongs to this customer ← hub db
    expect(await getOrderCustomerId(db.hub, shownOrderId), `customer of order ${shownOrderId}`).toBe(order!.customer_id);
  });

  test('creates a note on the customer', async ({ customerPage, db }) => {
    // SETUP: unique note text
    const note = `qa_auto customer note ${Date.now()}`;
    await customerPage.open(uid);

    // ACTION + CHECK: Create note → shown on the page and stored in the database
    await customerPage.createNote(note);
    await expect.poll(() => countCustomerNotes(db.hub, uid, note), { message: 'customer note in the database' }).toBe(1);
  });
});
