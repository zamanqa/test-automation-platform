import { test, expect } from '@fixtures';
import { findLatestTransaction, findTransaction } from '@db/queries/hub/transactions';

// Unified API - /transactions (read only).
// Needs: at least one transaction.
// Changes data: no.
test.describe('Unified API - transactions', () => {
  test('returns a list of transactions', async ({ unifiedApi }) => {
    // ACTION: GET /transactions
    const response = await unifiedApi.transactions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a transaction by id', async ({ unifiedApi, db }) => {
    // SETUP: newest transaction of the company
    const companyId = await unifiedApi.companyId();
    const transaction = await findLatestTransaction(db.hub, companyId);

    // ACTION: GET /transactions/{transaction_id}  (the text id like "pi_..." / "TR_...", not the numeric id)
    const response = await unifiedApi.transactions.get(transaction.transaction_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findTransaction(db.hub, companyId, transaction.transaction_id)).toBeDefined();
  });
});
