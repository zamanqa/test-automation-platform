// test (renamed `setup`) ← src/fixtures/index.ts
// env                    ← src/config/env.ts (CHECKOUT_API_URL from .env)
// wakeUp                 ← src/api/health-check.ts
import { test as setup } from '@fixtures';
import { env } from '@config/env';
import { wakeUp } from '@api/health-check';

/**
 * WHAT:   Wakes the checkout API once before the checkout tests (project 'checkout-setup',
 *         which playwright.config.ts runs before 'checkout-e2e').
 *         Was an ApiHealthCheck in every Cypress spec's before().
 * Like the original it never fails the run (required: false): it only gives a cold server
 * the chance to start. CHANGES DATA: no.
 */
setup('wake up the checkout API', async ({ request }) => {
  // `request` = Playwright's built-in HTTP client fixture
  await wakeUp(request, env.checkout.CHECKOUT_API_URL, { required: false });
});
