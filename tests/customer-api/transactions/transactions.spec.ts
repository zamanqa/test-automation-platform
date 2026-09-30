// test, expect ← src/fixtures/index.ts
// find...      ← src/db/queries/hub/transactions.ts
import { test, expect } from '@fixtures';
import { findLatestTransaction, findTransaction } from '@db/queries/hub/transactions';

/**
 * WHAT:   OLD Customer API — /transactions (read only).
 * FROM:   cus-api cypress/e2e/customer-api/08-transactions/transactions.cy.js (2 tests).
 *         "filters transactions by order" is new (Postman: transactions_get by order_id).
 * CHANGES DATA: no.
 */
test.describe('Customer API - transactions', () => {
  test('returns a list of transactions', async ({ customerApi }) => {
    // ACTION: GET /transactions
    const response = await customerApi.transactions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a transaction by id', async ({ customerApi, db }) => {
    // SETUP: newest transaction ← hub db (companyId ← .env)
    const transaction = await findLatestTransaction(db.hub, customerApi.companyId);

    // ACTION: GET /transactions/{transaction_id}  (text id, e.g. "pi_..." / "TR_...")
    const response = await customerApi.transactions.get(transaction.transaction_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findTransaction(db.hub, customerApi.companyId, transaction.transaction_id)).toBeDefined();
  });

  test('filters transactions by order', async ({ customerApi, db }) => {
    // SETUP: newest transaction ← hub db; we filter by its order
    const transaction = await findLatestTransaction(db.hub, customerApi.companyId);
    test.skip(!transaction.order_id, 'newest transaction has no order_id');
    const orderId = String(transaction.order_id);

    // ACTION: GET /transactions?order_id={order_id}
    const response = await customerApi.transactions.listByOrder(orderId);

    // CHECK: our transaction is in the list, and every transaction belongs to that order
    expect(response.status()).toBe(200);
    const transactions = (await response.json()).data;
    expect(transactions.map((t: { id: string }) => t.id)).toContain(transaction.transaction_id);
    for (const t of transactions) {
      expect(t.order_id).toBe(orderId);
    }
  });
});
