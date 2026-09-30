// test, expect  ← src/fixtures/index.ts
// find...       ← src/db/queries/hub/transactions.ts
import { test, expect } from '@fixtures';
import { findLatestTransaction, findTransaction } from '@db/queries/hub/transactions';

/**
 * WHAT:   Unified Customer API — /transactions (read only).
 * FROM:   unified-customer-api cypress/e2e/customer-api/08-transactions/transactions.cy.js (2 tests).
 * NEEDS:  at least one transaction.   CHANGES DATA: no.
 */
test.describe('Unified API - transactions', () => {
  test('returns a list of transactions', async ({ unifiedApi }) => {
    // ACTION: GET /transactions
    const response = await unifiedApi.transactions.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a transaction by id', async ({ unifiedApi, db }) => {
    // SETUP: newest transaction of the company ← hub db
    const companyId = await unifiedApi.companyId();
    const transaction = await findLatestTransaction(db.hub, companyId);

    // ACTION: GET /transactions/{transaction_id}  (the text id like "pi_..." / "TR_...", not the numeric id)
    const response = await unifiedApi.transactions.get(transaction.transaction_id);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await findTransaction(db.hub, companyId, transaction.transaction_id)).toBeDefined();
  });
});
