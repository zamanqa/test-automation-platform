// test, expect                     ← src/fixtures/index.ts
// createCustomerPayload, randomExternalId ← src/data/payloads/shared/customers.ts (same for both APIs)
// find... / count... / delete...   ← src/db/queries/hub/customers.ts (SQL on the hub database)
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

/**
 * WHAT:   Unified Customer API — /customers endpoints.
 * FROM:   unified-customer-api cypress/e2e/customer-api/02-customers/customers.cy.js (10 tests → 8).
 * NEEDS:  at least one customer; two customers with orders for the transfer test.
 * CHANGES DATA: yes — balance +100, external id, referral code (removed again),
 *         creates a customer, merges two customers.
 * Labels: SETUP / ACTION / CHECK, "← from:" = where a value comes from.
 */
test.describe.configure({ mode: 'default' });

test.describe('Unified API - customers', () => {
  // Set in beforeEach. CustomerRow ← src/db/queries/hub/customers.ts (uid, email, names, external id)
  let customer: CustomerRow;

  // Before each test: the company's OLDEST customer (stable choice, same as in Cypress).
  // companyId ← Unified API login (consumer key in .env)
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
    // ACTION: GET /customers/{uid}   uid ← customer from beforeEach
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
    const { remaining_amount } = await response.json(); // ← new balance according to the API

    // CHECK: the database (customer_account, found by email) holds the same balance
    const account = await findCustomerAccount(db.hub, customer.email);
    expect(account).toBeDefined();
    expect(Number(account!.remaining_amount)).toBe(remaining_amount);
  });

  test('updates external_customer_id', async ({ unifiedApi, db }) => {
    // SETUP: random 4-digit id ← randomExternalId() in src/data/payloads/shared/customers.ts
    const externalId = randomExternalId();

    // ACTION: PUT /customers/{uid}
    const response = await unifiedApi.customers.update(customer.uid, { external_customer_id: externalId });

    // CHECK: API confirms, and the database now stores that id
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, message: 'Updated' });
    expect((await findCustomer(db.hub, customer.uid))?.external_customer_id).toBe(externalId);
  });

  // Was tests 6-8 in Cypress, which passed the code between tests through Cypress.env.
  test('creates, reads back and removes a referral code', async ({ unifiedApi, db, cleanup }) => {
    // SETUP: a customer can have only one code → remove any old one first (hub db: checkout.checkout_voucher_codes)
    await deleteReferralCodesOfEmail(db.hub, customer.email);

    // ACTION 1 (step "create"): POST /customers/{uid}/referral-code → returns the new code
    const code = await test.step('create', async () => {
      const response = await unifiedApi.customers.createReferralCode(customer.uid);
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body).toHaveProperty('referral_code');
      return body.referral_code as string; // ← becomes `code`
    });

    // Undo: delete the code after the test (was Cypress test 8)
    cleanup.add('delete referral code', () => deleteReferralCode(db.hub, code));

    // ACTION 2 + CHECK (step "read back"): GET returns the same code
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

    // CHECK: 201, and the email (← payload.email) exists in the customers table
    expect(response.status()).toBe(201);
    expect(await findCustomerByEmail(db.hub, payload.email)).toBeDefined();
  });

  test('transfers (merges) one customer into another', async ({ unifiedApi, db }) => {
    // SETUP: the two most recent customers that have orders
    const companyId = await unifiedApi.companyId();
    const customers = await findTwoRecentCustomersWithOrders(db.hub, companyId);
    test.skip(customers.length < 2, 'Needs two customers with orders'); // reported as "skipped", not green
    const [source, target] = customers; // source = newest, target = second newest

    // ACTION: POST /customers/transfer  (moves everything from source to target)
    const response = await unifiedApi.customers.transfer(source.uid, target.uid);

    // CHECK: API message, then in the database: source has 0 orders, target has some
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('message', 'Customer transferred successfully');
    expect(await countOrdersOfCustomer(db.hub, companyId, source.uid)).toBe(0);
    expect(await countOrdersOfCustomer(db.hub, companyId, target.uid)).toBeGreaterThan(0);
  });
});
