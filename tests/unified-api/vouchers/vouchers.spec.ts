// test, expect                ← src/fixtures/index.ts
// create/updateVoucherPayload ← src/data/payloads/shared/vouchers.ts (same for both APIs)
import { test, expect } from '@fixtures';
import { createVoucherPayload, updateVoucherPayload } from '@data/payloads/shared/vouchers';

/**
 * WHAT:   Unified Customer API — /vouchers. (No database checks here — same as the Cypress tests.)
 * FROM:   unified-customer-api cypress/e2e/customer-api/13-vouchers/vouchers.cy.js (5 tests → 3).
 * NEEDS:  at least one voucher.   CHANGES DATA: yes — creates a voucher, then switches it off.
 */
test.describe('Unified API - vouchers', () => {
  test('returns a list of vouchers', async ({ unifiedApi }) => {
    // ACTION: GET /vouchers
    const response = await unifiedApi.vouchers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a voucher by code', async ({ unifiedApi }) => {
    // SETUP: code of the first voucher in the list ← API (not the database, like Cypress)
    const { data } = await (await unifiedApi.vouchers.list()).json();
    const code = data[0].voucher_code;

    // ACTION: GET /vouchers/{code}
    const response = await unifiedApi.vouchers.byCode(code);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('voucher_code', code);
  });

  // Was tests 3-5 in Cypress, which passed the code between tests through Cypress.env.
  test('creates a voucher, reads it back and updates it', async ({ unifiedApi }) => {
    // Step "create": POST /vouchers (code "test-<timestamp>") → code ← API response
    const code = await test.step('create', async () => {
      const response = await unifiedApi.vouchers.create(createVoucherPayload());
      expect([200, 201]).toContain(response.status());
      const body = await response.json();
      expect(body).toHaveProperty('voucher_code');
      return body.voucher_code as string;
    });

    // Step "read back": GET /vouchers/{code} → valid voucher; keep the full body (`current`) for the update
    const current = await test.step('read back', async () => {
      const response = await unifiedApi.vouchers.byCode(code);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ voucher_code: code, valid: true });
      return body;
    });

    // Step "update": PUT /vouchers/{id} — id and name ← `current`; switches it to 10% and invalid
    await test.step('update', async () => {
      const response = await unifiedApi.vouchers.update(current.id, updateVoucherPayload(current));
      expect([200, 201]).toContain(response.status());
    });
  });
});
