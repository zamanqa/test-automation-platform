import { test, expect } from '@fixtures';
import { createCustomerPayload, randomExternalId, validateAddressPayload } from '@data/payloads/shared/customers';
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

// Customer API - /customers and /validate-address.
// Needs: a customer; two customers with orders for the transfer test.
// Changes data: adds 100 to a balance, sets an external id, creates a referral code (removed again),
// creates a customer, merges two customers.
// Same as the Unified API test, plus the address check. The create body has no region field.
test.describe.configure({ mode: 'default' });

test.describe('Customer API - customers', () => {
  let customer: CustomerRow;

  // the oldest customer of the company, so every run uses the same one
  test.beforeEach(async ({ db, customerApi }) => {
    customer = await findOldestCustomer(db.hub, customerApi.companyId);
  });

  test('returns a paginated list of customers', async ({ customerApi }) => {
    // ACTION: GET /customers
    const response = await customerApi.customers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a customer by id', async ({ customerApi, db }) => {
    // ACTION: GET /customers/{uid}
    const response = await customerApi.customers.get(customer.uid);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findCustomer(db.hub, customer.uid)).toBeDefined();
  });

  test('shows the customer balance', async ({ customerApi }) => {
    // ACTION: GET /customers/{uid}/balance
    const response = await customerApi.customers.balance(customer.uid);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('remaining_amount');
  });

  test('adds to the customer balance and stores the new amount', async ({ customerApi, db }) => {
    // ACTION: PUT /customers/{uid}/balance { add: 100 }
    const response = await customerApi.customers.addBalance(customer.uid, 100);
    expect(response.status()).toBe(200);
    const { remaining_amount } = await response.json();

    // CHECK: the database has the same balance
    const account = await findCustomerAccount(db.hub, customer.email);
    expect(account).toBeDefined();
    expect(Number(account!.remaining_amount)).toBe(remaining_amount);
  });

  test('updates external_customer_id', async ({ customerApi, db }) => {
    // SETUP: random 4-digit id
    const externalId = randomExternalId();

    // ACTION: PUT /customers/{uid}
    const response = await customerApi.customers.update(customer.uid, { external_customer_id: externalId });

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
    expect((await findCustomer(db.hub, customer.uid))?.external_customer_id).toBe(externalId);
  });

  test('creates, reads back and removes a referral code', async ({ customerApi, db, cleanup }) => {
    // SETUP: a customer can have only one code, so remove an old one first
    await deleteReferralCodesOfEmail(db.hub, customer.email);

    // ACTION: create a code
    const code = await test.step('create', async () => {
      const response = await customerApi.customers.createReferralCode(customer.uid);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('referral_code');
      return body.referral_code as string;
    });

    // remove the code again after the test
    cleanup.add('delete referral code', () => deleteReferralCode(db.hub, code));

    // CHECK: reading it back gives the same code
    await test.step('read back', async () => {
      const response = await customerApi.customers.referralCode(customer.uid);
      expect(response.status()).toBe(200);
      expect((await response.json()).referral_code).toBe(code);
    });
  });

  test('creates a customer', async ({ customerApi, db }) => {
    // SETUP: the customer body without the region field
    const { region, ...payload } = createCustomerPayload();

    // ACTION: POST /customers
    const response = await customerApi.customers.create(payload);

    // CHECK: the customer is in the database
    expect(response.status()).toBe(201);
    expect(await findCustomerByEmail(db.hub, payload.email)).toBeDefined();
  });

  test('validates a customer address', async ({ customerApi }) => {
    // ACTION: an address in Rome
    const response = await customerApi.customers.validateAddress(validateAddressPayload());

    // CHECK: valid, no message (status code is not checked)
    expect(await response.json()).toMatchObject({ valid: true, message: '' });
  });

  test('transfers (merges) one customer into another', async ({ customerApi, db }) => {
    // SETUP: the two newest customers that have orders
    const companyId = customerApi.companyId;
    const customers = await findTwoRecentCustomersWithOrders(db.hub, companyId);
    test.skip(customers.length < 2, 'Needs two customers with orders');
    const [source, target] = customers;

    // ACTION: POST /customers/transfer
    const response = await customerApi.customers.transfer(source.uid, target.uid);

    // CHECK: source has 0 orders now, target has some
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Customer transferred successfully');
    expect(await countOrdersOfCustomer(db.hub, companyId, source.uid)).toBe(0);
    expect(await countOrdersOfCustomer(db.hub, companyId, target.uid)).toBeGreaterThan(0);
  });
});
