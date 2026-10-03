import { test, expect } from '@fixtures';
import { createVoucherPayload, updateVoucherPayload } from '@data/payloads/shared/vouchers';

// Unified API - /vouchers (no database checks).
// Needs: at least one voucher.
// Changes data: creates a voucher, then switches it off.
test.describe('Unified API - vouchers', () => {
  test('returns a list of vouchers', async ({ unifiedApi }) => {
    // ACTION: GET /vouchers
    const response = await unifiedApi.vouchers.list();

    // CHECK
    expect(response.status()).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
  });

  test('fetches a voucher by code', async ({ unifiedApi }) => {
    // SETUP: code of the first voucher in the list
    const { data } = await (await unifiedApi.vouchers.list()).json();
    const code = data[0].voucher_code;

    // ACTION: GET /vouchers/{code}
    const response = await unifiedApi.vouchers.byCode(code);

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('voucher_code', code);
  });

  test('creates a voucher, reads it back and updates it', async ({ unifiedApi }) => {
    // Step "create": POST /vouchers (code "test-<timestamp>") → code
    const code = await test.step('create', async () => {
      const response = await unifiedApi.vouchers.create(createVoucherPayload());
      expect([200, 201]).toContain(response.status());
      const body = await response.json();
      expect(body).toHaveProperty('voucher_code');
      return body.voucher_code as string;
    });

    // Step "read back": the voucher is valid; keep it for the update
    const current = await test.step('read back', async () => {
      const response = await unifiedApi.vouchers.byCode(code);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ voucher_code: code, valid: true });
      return body;
    });

    // Step "update": PUT /vouchers/{id}
    await test.step('update', async () => {
      const response = await unifiedApi.vouchers.update(current.id, updateVoucherPayload(current));
      expect([200, 201]).toContain(response.status());
    });
  });
});
