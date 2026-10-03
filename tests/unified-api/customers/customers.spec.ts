import { test, expect } from '@fixtures';
import { createCustomerPayload, randomExternalId } from '@data/payloads/shared/customers';
import {
  countOrdersOfCustomer,
  deleteReferralCode,
  deleteReferralCodesOfEmail,
  findCustomer,
  findCustomerAccount,
  findCustomerByEmail,
  findOldestCustomer,
  findTwoRecentCustomersWithOrders,
  type CustomerRow,
} from '@db/queries/hub/customers';

// Unified API - /customers endpoints.
// Needs: at least one customer; two customers with orders for the transfer test.
// Changes data: adds 100 to a balance, sets an external id, creates a referral code (removed again),
// creates a customer, merges two customers.
test.describe.configure({ mode: 'default' });

test.describe('Unified API - customers', () => {
  let customer: CustomerRow;

  // the oldest customer of the company, so every run uses the same one
  test.beforeEach(async ({ db, unifiedApi }) => {
    customer = await findOldestCustomer(db.hub, await unifiedApi.companyId());
  });

  test('returns a paginated list of customers', async ({ unifiedApi }) => {
    // ACTION: GET /customers
    const response = await unifiedApi.customers.list();

    // CHECK: 200 and a non-empty `data` list
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a customer by id', async ({ unifiedApi, db }) => {
    // ACTION
    const response = await unifiedApi.customers.get(customer.uid);

    // CHECK: API answers, and the row is in the database
    expect(response.status()).toBe(200);
    expect(await findCustomer(db.hub, customer.uid)).toBeDefined();
  });

  test('shows the customer balance', async ({ unifiedApi }) => {
    // ACTION: GET /customers/{uid}/balance
    const response = await unifiedApi.customers.balance(customer.uid);

    // CHECK: response has a remaining_amount field
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('remaining_amount');
  });

  test('adds to the customer balance and stores the new amount', async ({ unifiedApi, db }) => {
    // ACTION: PUT /customers/{uid}/balance  { add: 100 }
    const response = await unifiedApi.customers.addBalance(customer.uid, 100);
    expect(response.status()).toBe(200);
    const { remaining_amount } = await response.json();

    // CHECK: the database (customer_account, found by email) holds the same balance
    const account = await findCustomerAccount(db.hub, customer.email);
    expect(account).toBeDefined();
    expect(Number(account!.remaining_amount)).toBe(remaining_amount);
  });

  test('updates external_customer_id', async ({ unifiedApi, db }) => {
    // SETUP: random 4-digit id
    const externalId = randomExternalId();

    // ACTION: PUT /customers/{uid}
    const response = await unifiedApi.customers.update(customer.uid, { external_customer_id: externalId });

    // CHECK: API confirms, and the database now stores that id
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
    expect((await findCustomer(db.hub, customer.uid))?.external_customer_id).toBe(externalId);
  });

  test('creates, reads back and removes a referral code', async ({ unifiedApi, db, cleanup }) => {
    // SETUP: a customer can have only one code, so remove an old one first
    await deleteReferralCodesOfEmail(db.hub, customer.email);

    // ACTION: create a code
    const code = await test.step('create', async () => {
      const response = await unifiedApi.customers.createReferralCode(customer.uid);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('referral_code');
      return body.referral_code as string;
    });

    // remove the code again after the test
    cleanup.add('delete referral code', () => deleteReferralCode(db.hub, code));

    // CHECK: reading it back gives the same code
    await test.step('read back', async () => {
      const response = await unifiedApi.customers.referralCode(customer.uid);
      expect(response.status()).toBe(200);
      expect((await response.json()).referral_code).toBe(code);
    });
  });

  test('creates a customer', async ({ unifiedApi, db }) => {
    // SETUP: body with a random qa_auto_ email and random external id
    const payload = createCustomerPayload();

    // ACTION: POST /customers
    const response = await unifiedApi.customers.create(payload);

    // CHECK: 201, and the customer is in the database
    expect(response.status()).toBe(201);
    expect(await findCustomerByEmail(db.hub, payload.email)).toBeDefined();
  });

  test('transfers (merges) one customer into another', async ({ unifiedApi, db }) => {
    // SETUP: the two most recent customers that have orders
    const companyId = await unifiedApi.companyId();
    const customers = await findTwoRecentCustomersWithOrders(db.hub, companyId);
    test.skip(customers.length < 2, 'Needs two customers with orders');
    const [source, target] = customers; // source = newest, target = second newest

    // ACTION: move everything from source to target
    const response = await unifiedApi.customers.transfer(source.uid, target.uid);

    // CHECK: API message, then in the database: source has 0 orders, target has some
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Customer transferred successfully');
    expect(await countOrdersOfCustomer(db.hub, companyId, source.uid)).toBe(0);
    expect(await countOrdersOfCustomer(db.hub, companyId, target.uid)).toBeGreaterThan(0);
  });
});
