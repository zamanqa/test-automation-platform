// test, expect                ← src/fixtures/index.ts
// create/updateVoucherPayload ← src/data/payloads/shared/vouchers.ts
import { test, expect } from '@fixtures';
import { createVoucherPayload, updateVoucherPayload } from '@data/payloads/shared/vouchers';

/**
 * WHAT:   OLD Customer API — /vouchers (API checks only, like Cypress).
 * FROM:   cus-api cypress/e2e/customer-api/13-vouchers/vouchers.cy.js (5 tests → 3).
 * CHANGES DATA: yes — creates a voucher and switches it off.
 */
test.describe('Customer API - vouchers', () => {
  test('returns a list of vouchers', async ({ customerApi }) => {
    // ACTION: GET /vouchers
    const response = await customerApi.vouchers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a voucher by code', async ({ customerApi }) => {
    // SETUP: first voucher's code ← API list
    const { data } = await (await customerApi.vouchers.list()).json();
    const code = data[0].voucher_code;

    // ACTION: GET /vouchers/{code}
    const response = await customerApi.vouchers.byCode(code);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('voucher_code', code);
  });

  // Was tests 3-5 in Cypress, which passed the code between tests through Cypress.env.
  test('creates a voucher, reads it back and updates it', async ({ customerApi }) => {
    // Step "create": POST /vouchers → code ← API response
    const code = await test.step('create', async () => {
      const response = await customerApi.vouchers.create(createVoucherPayload());
      expect([200, 201]).toContain(response.status());
      const body = await response.json();
      expect(body).toHaveProperty('voucher_code');
      return body.voucher_code as string;
    });

    // Step "read back": GET /vouchers/{code} → keep the body (id, name) for the update
    const current = await test.step('read back', async () => {
      const response = await customerApi.vouchers.byCode(code);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ voucher_code: code, valid: true });
      return body;
    });

    // Step "update": PUT /vouchers/{id} — 10%, invalid, invisible
    await test.step('update', async () => {
      const response = await customerApi.vouchers.update(current.id, updateVoucherPayload(current));
      expect([200, 201]).toContain(response.status());
    });
  });
});
