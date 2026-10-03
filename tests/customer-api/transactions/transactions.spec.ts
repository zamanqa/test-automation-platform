import { test, expect } from '@fixtures';
import { findLatestTransaction, findTransaction } from '@db/queries/hub/transactions';

// Customer API - /transactions (read only).
// Changes data: no.
test.describe('Customer API - transactions', () => {
  test('returns a list of transactions', async ({ customerApi }) => {
    // ACTION: GET /transactions
    const response = await customerApi.transactions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a transaction by id', async ({ customerApi, db }) => {
    // SETUP: newest transaction
    const transaction = await findLatestTransaction(db.hub, customerApi.companyId);

    // ACTION: by the text id like "pi_..." or "TR_..."
    const response = await customerApi.transactions.get(transaction.transaction_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findTransaction(db.hub, customerApi.companyId, transaction.transaction_id)).toBeDefined();
  });

  test('filters transactions by order', async ({ customerApi, db }) => {
    // SETUP: newest transaction
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
