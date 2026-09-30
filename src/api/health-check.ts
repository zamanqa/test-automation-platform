import type { APIRequestContext } from '@playwright/test';

// USED BY (files that import this one):
//   tests/checkout-e2e/checkout.setup.ts
//   tests/hub-e2e/orders/create-order.spec.ts
//   tests/unified-api/orders/orders.spec.ts

const HEALTHY = [200, 301, 302];

/**
 * Pings a server until it answers, to wake up services that sleep when idle
 * (Heroku / Cloud Run cold starts). Replaces the four copies of apiHealthCheck.js.
 *
 * Throws if the server is still not healthy after all attempts, unless required: false
 * (the checkout Cypress tests only logged the result).
 */
export async function wakeUp(
  request: APIRequestContext,
  url: string,
  { attempts = 2, delayMs = 15_000, okStatuses = HEALTHY, required = true } = {},
): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await request.get(url, { failOnStatusCode: false, timeout: 30_000 }).catch(() => null);
    lastStatus = response?.status() ?? 0;
    if (okStatuses.includes(lastStatus)) return;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (!required) return;
  throw new Error(`${url} is not healthy after ${attempts} attempts (last status: ${lastStatus})`);
}
