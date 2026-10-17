import { test, expect } from '@fixtures';
import { testName } from '@data/random';
import { countCustomerNotes, findLatestCustomerWithOrder } from '@db/queries/hub/customers';
import {
  countCustomerData,
  countCustomerOrders,
  countCustomerSections,
  countCustomersWithEmail,
  findCustomerToEdit,
  findCustomerWithSubscriptions,
  findCustomerValues,
  findEmptyCustomer,
  findTransferSource,
  getAccountBalance,
  setCustomerValues,
} from '@db/queries/hub/customers-more';

// Hub → customers: the cases that were missing - edit details (address is locked), data transfer there and back,
// transfer without consent, search by email, section totals, wrong balance input, edit and delete a note.
// Changes data: edits one customer (old values put back), moves one customer's data to an empty customer and back,
// creates, edits and deletes a qa_auto note.
test.describe.configure({ mode: 'default' });

test.describe('Hub - customer gaps', () => {
  test('C1 edits phone, external customer id and marketing consent (address fields are locked in the dialog)', async ({ db, hubCompanyId, customerPage, page, cleanup }) => {
    // SETUP
    const customer = await findCustomerToEdit(db.hub, hubCompanyId);
    test.skip(!customer, 'no real customer with an order and a city');
    cleanup.add('old customer values back', () => setCustomerValues(db.hub, customer!));
    test.info().annotations.push({ type: 'customer', description: customer!.uid });

    // ACTION: Edit (pencil) → fields → consent → Submit
    await customerPage.open(customer!.uid);
    await page.locator('[data-test-id="btn-open-edit"]').first().click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.getByRole('heading', { name: 'Edit customer' })).toBeVisible();
    // the billing address cannot be changed here
    await expect(dialog.getByLabel('Street').first()).toBeDisabled();
    await expect(dialog.getByLabel('City').first()).toBeDisabled();
    await dialog.getByLabel('Phone').fill('4915112345678');
    await dialog.getByLabel('External Customer ID').fill('QA-EXT-1');
    await dialog.getByRole('checkbox', { name: /marketing/i }).setChecked(!customer!.marketing_consent);
    await dialog.getByRole('checkbox', { name: 'I consent to the consequences.' }).check();
    await dialog.getByRole('button', { name: 'Submit' }).click();

    // CHECK: customers row has the new values
    await expect.poll(async () => (await findCustomerValues(db.hub, customer!.uid)).external_customer_id, { message: 'external customer id' }).toBe('QA-EXT-1');
    const after = await findCustomerValues(db.hub, customer!.uid);
    expect(after.phone).toContain('4915112345678');
    expect(after.marketing_consent).toBe(!customer!.marketing_consent);
  });

  test('C3 transfers the data of a customer to an empty customer and back', async ({ db, hubCompanyId, customerPage, page }) => {
    // SETUP
    const source = await findTransferSource(db.hub, hubCompanyId);
    const target = await findEmptyCustomer(db.hub, hubCompanyId);
    test.skip(!source || !target, 'no source customer with orders or no empty target customer');
    const before = await countCustomerData(db.hub, source!.uid);
    test.info().annotations.push({ type: 'customers', description: `${source!.email} → ${target!.email} → back` });

    await test.step('source → empty target', async () => {
      await customerPage.open(source!.uid);
      await transferTo(page, customerPage, target!.email);
      await expect.poll(() => countCustomerOrders(db.hub, target!.uid), { message: 'orders of the target' }).toBe(before.orders);
      expect(await countCustomerData(db.hub, source!.uid)).toEqual({ orders: 0, subscriptions: 0 });
      expect((await countCustomerData(db.hub, target!.uid)).subscriptions).toBe(before.subscriptions);
    });

    await test.step('target → back to the source', async () => {
      await customerPage.open(target!.uid);
      await transferTo(page, customerPage, source!.email);
      await expect.poll(() => countCustomerOrders(db.hub, source!.uid), { message: 'orders of the source' }).toBe(before.orders);
      expect(await countCustomerData(db.hub, source!.uid)).toEqual(before);
      expect(await countCustomerData(db.hub, target!.uid)).toEqual({ orders: 0, subscriptions: 0 });
    });
  });

  test('C4 transfer is not possible without consent', async ({ db, hubCompanyId, customerPage, page }) => {
    // SETUP
    const source = await findTransferSource(db.hub, hubCompanyId);
    const target = await findEmptyCustomer(db.hub, hubCompanyId);
    test.skip(!source || !target, 'no source customer with orders or no empty target customer');
    const before = await countCustomerData(db.hub, source!.uid);

    // ACTION: pick the target but do not tick consent
    await customerPage.open(source!.uid);
    await customerPage.runMenuAction('Transfer customer data');
    const dialog = page.getByRole('dialog').last();
    await pickTarget(page, target!.email);
    await dialog.getByRole('button', { name: 'Submit' }).click();

    // CHECK: still open, nothing moved
    await expect(dialog.getByRole('heading', { name: 'Transfer customer data' })).toBeVisible();
    expect(await countCustomerData(db.hub, source!.uid)).toEqual(before);
  });

  test('C5 search by email finds the customer', async ({ db, hubCompanyId, hubListPage }) => {
    // SETUP
    const customer = await findLatestCustomerWithOrder(db.hub, hubCompanyId);
    test.skip(!customer, 'no customer with an order');
    const email = (await findCustomerValues(db.hub, customer!.uid)).email;
    const expected = await countCustomersWithEmail(db.hub, hubCompanyId, email);

    // ACTION
    await hubListPage.open('customers', { email, created_at: '', customer_type: '' });

    // CHECK
    await hubListPage.expectTotal(expected, `customers with ${email}`);
  });

  test('C6 the Orders, Subscriptions, Payments and Assets sections show the rows of the customer', async ({ db, hubCompanyId, customerPage, page }) => {
    // SETUP
    const customer = await findCustomerWithSubscriptions(db.hub, hubCompanyId);
    test.skip(!customer, 'no customer with 2 or more subscriptions');
    const expected = await countCustomerSections(db.hub, customer!.uid);
    test.info().annotations.push({ type: 'customer', description: `${customer!.uid} ${JSON.stringify(expected)}` });

    // ACTION
    await customerPage.open(customer!.uid);

    // CHECK: "1-10 of N" of each section = DB
    await expect.poll(() => sectionTotal(page, 'Orders'), { message: 'Orders section', timeout: 30_000 }).toBe(expected.orders);
    await expect.poll(() => sectionTotal(page, 'Subscriptions'), { message: 'Subscriptions section', timeout: 30_000 }).toBe(expected.subscriptions);
    await expect.poll(() => sectionTotal(page, 'Payments'), { message: 'Payments section', timeout: 30_000 }).toBe(expected.payments);
    await expect.poll(() => sectionTotal(page, 'Assets'), { message: 'Assets section', timeout: 30_000 }).toBe(expected.assets);
  });

  test('C7 a balance that is not a number is refused',async ({ db, hubCompanyId, customerPage, page }) => {
    // SETUP
    const customer = await findLatestCustomerWithOrder(db.hub, hubCompanyId);
    test.skip(!customer, 'no customer with an order');
    const before = await getAccountBalance(db.hub, customer!.uid);

    // ACTION
    await customerPage.open(customer!.uid);
    await customerPage.runMenuAction('Change account balance');
    const dialog = page.getByRole('dialog').last();
    await dialog.getByRole('textbox', { name: 'Add balance' }).fill('abc');
    await dialog.getByRole('textbox', { name: 'Notes' }).fill('qa_auto wrong input');
    await dialog.getByRole('button', { name: 'Submit' }).click();

    // CHECK: no success, balance unchanged
    await expect(page.getByText('Successfully requested!')).toBeHidden();
    expect(await getAccountBalance(db.hub, customer!.uid)).toBe(before);
  });

  test('C8 edits and deletes a note on the customer', async ({ db, hubCompanyId, customerPage, orderDetailPage }) => {
    // SETUP
    const customer = await findLatestCustomerWithOrder(db.hub, hubCompanyId);
    test.skip(!customer, 'no customer with an order');
    const message = testName('customer_note');

    // ACTION + CHECK: create
    await customerPage.open(customer!.uid);
    await customerPage.createNote(message);

    // ACTION + CHECK: edit
    await orderDetailPage.editNote(message, `${message}_edited`);
    await orderDetailPage.expectNote(`${message}_edited`);
    await expect.poll(() => countCustomerNotes(db.hub, customer!.uid, `${message}_edited`), { message: 'edited note in notes' }).toBe(1);

    // ACTION + CHECK: delete
    await orderDetailPage.deleteNote(`${message}_edited`);
    await expect.poll(() => countCustomerNotes(db.hub, customer!.uid, `${message}_edited`), { message: 'note deleted' }).toBe(0);
  });
});

// N from the "1-10 of N" label of a customer page section (the box under its title)
async function sectionTotal(page: import('@playwright/test').Page, title: string) {
  const section = page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::*[.//*[@data-testid="from-to-of-total"]][1]');
  const label = (await section.getByTestId('from-to-of-total').first().textContent()) ?? '';
  return Number(label.match(/of\s+(\d+)/)?.[1] ?? -1);
}

// Transfer dialog: type the target email and pick it from the list
async function pickTarget(page: import('@playwright/test').Page, email: string) {
  const dialog = page.getByRole('dialog').last();
  await dialog.getByRole('combobox').last().fill(email);
  await page.getByRole('option', { name: email }).first().click();
}

// Customer menu → Transfer customer data → target → consent → Submit → success
async function transferTo(
  page: import('@playwright/test').Page,
  customerPage: { runMenuAction: (name: 'Transfer customer data') => Promise<void> },
  email: string,
) {
  await customerPage.runMenuAction('Transfer customer data');
  const dialog = page.getByRole('dialog').last();
  await expect(dialog.getByRole('heading', { name: 'Transfer customer data' })).toBeVisible();
  await pickTarget(page, email);
  await dialog.getByRole('checkbox', { name: 'I consent to the consequences.' }).check();
  await dialog.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Successfully requested!')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
}
