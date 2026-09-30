// test, expect  ← src/fixtures/index.ts
// create/validate payloads, randomExternalId ← src/data/payloads/shared/customers.ts
// find... / count... / delete...             ← src/db/queries/hub/customers.ts
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

/**
 * WHAT:   OLD Customer API — /customers and /validate-address.
 * FROM:   cus-api cypress/e2e/customer-api/02-customers/customers.cy.js (11 tests → 9).
 * NEEDS:  a customer; two customers with orders for the transfer test.
 * CHANGES DATA: yes — balance +100, external id, referral code (removed again),
 *         creates a customer, merges two customers.
 * Same as tests/unified-api/customers except: extra address validation test, and the create
 * body has no `region` field.
 */
test.describe.configure({ mode: 'default' });

test.describe('Customer API - customers', () => {
  let customer: CustomerRow; // set in beforeEach

  // Before each test: the company's oldest customer. companyId ← .env CUSTOMER_API_COMPANY_ID
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
    const { remaining_amount } = await response.json(); // ← new balance from the API

    // CHECK: database customer_account (by email) has the same balance
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

  // Was tests 6-8 in Cypress, which passed the code between tests through Cypress.env.
  test('creates, reads back and removes a referral code', async ({ customerApi, db, cleanup }) => {
    // SETUP: remove any existing code of this customer's email
    await deleteReferralCodesOfEmail(db.hub, customer.email);

    // Step "create": POST /customers/{uid}/referral-code → `code` ← API response
    const code = await test.step('create', async () => {
      const response = await customerApi.customers.createReferralCode(customer.uid);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('referral_code');
      return body.referral_code as string;
    });

    // Undo after the test (was Cypress test 8)
    cleanup.add('delete referral code', () => deleteReferralCode(db.hub, code));

    // Step "read back": GET returns the same code
    await test.step('read back', async () => {
      const response = await customerApi.customers.referralCode(customer.uid);
      expect(response.status()).toBe(200);
      expect((await response.json()).referral_code).toBe(code);
    });
  });

  test('creates a customer', async ({ customerApi, db }) => {
    // SETUP: shared body minus `region` (the Customer API body never had it).
    // `const { region, ...payload }` = copy everything except region into `payload`.
    const { region, ...payload } = createCustomerPayload();

    // ACTION: POST /customers
    const response = await customerApi.customers.create(payload);

    // CHECK: email ← payload.email is in the customers table
    expect(response.status()).toBe(201);
    expect(await findCustomerByEmail(db.hub, payload.email)).toBeDefined();
  });

  test('validates a customer address', async ({ customerApi }) => {
    // ACTION: POST /validate-address (an address in Rome ← validateAddressPayload())
    const response = await customerApi.customers.validateAddress(validateAddressPayload());

    // CHECK: valid with no message (Cypress did not check the status code here either)
    expect(await response.json()).toMatchObject({ valid: true, message: '' });
  });

  test('transfers (merges) one customer into another', async ({ customerApi, db }) => {
    // SETUP: two most recent customers with orders (else skipped)
    const companyId = customerApi.companyId;
    const customers = await findTwoRecentCustomersWithOrders(db.hub, companyId);
    test.skip(customers.length < 2, 'Needs two customers with orders');
    const [source, target] = customers;

    // ACTION: POST /customers/transfer
    const response = await customerApi.customers.transfer(source.uid, target.uid);

    // CHECK: source now has 0 orders, target has some (hub db)
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Customer transferred successfully');
    expect(await countOrdersOfCustomer(db.hub, companyId, source.uid)).toBe(0);
    expect(await countOrdersOfCustomer(db.hub, companyId, target.uid)).toBeGreaterThan(0);
  });
});
