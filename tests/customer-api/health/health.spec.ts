import { test, expect } from '@fixtures';

/**
 * WHAT:   OLD Customer API — is it up? GET /ping and GET /version.
 * FROM:   Postman collection "circuly_customers API (2025-01) Main": Ping, Version. New in Playwright.
 * CHANGES DATA: no.
 */
test.describe('Customer API - health', () => {
  test('ping answers pong', async ({ customerApi }) => {
    // ACTION: GET /ping
    const response = await customerApi.ping();

    // CHECK
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('pong');
  });

  test('version shows the app name and the database', async ({ customerApi }) => {
    // ACTION: GET /version
    const response = await customerApi.version();

    // CHECK
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.App_name).toBe('circuly_customers_api');
    expect(body.Database).toContain('PostgreSQL');
  });
});
