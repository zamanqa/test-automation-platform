# test-automation-platform

Playwright automation for Circuly — one repo, four suites, shared code:

| Suite (Playwright project) | What it tests | Browser | Migrated from |
|---|---|---|---|
| `hub-e2e` | Hub UI | Google Chrome | `zamanqa/hub-e2e-automation` |
| `checkout-e2e` | Checkout UI + payment iframes | Google Chrome | `zamanqa/checkout-e2e` |
| `customer-api` | Customer API (old, basic auth) | none | `zamanqa/cus-api` |
| `unified-api` | Unified Customer API (2026-04, JWT) | none | `zamanqa/unified-customer-api` |

Load tests stay in `zamanqa/loadtesting` (k6).

## Setup

Requires Node.js 22+ and Google Chrome.

```bash
npm install
cp .env.example .env      # then fill in the values
```

## Running

```bash
npm run test:ui            # Playwright UI mode — use this while writing tests
npm run hub                # hub, headless
npm run hub:headed         # hub, visible Chrome
npm run checkout           # checkout, headless
npm run checkout:headed
npm run api:unified
npm run api:customer
npm test                   # everything
npm run report             # open the last HTML report
```

Any Playwright flag works too, e.g. `npx playwright test --project=unified-api -g "cancels"`.

## Layout

```
tests/<suite>/...          test files only (*.spec.ts)
src/config/env.ts          every environment variable, validated per group
src/db/databases.ts        THE place where databases are defined (hub, checkout)
src/db/connection.ts       pooled, lazy connections — one pool per worker per database
src/db/queries/<db>/       reusable queries, grouped by database and table
src/db/cleanup.ts          undo steps that run after a test, even when it fails
src/api/                   API clients (one per API) and their endpoint groups
src/pages/<app>/           page objects
src/data/                  payloads and random test data (tagged with TEST_DATA_PREFIX)
src/fixtures/index.ts      `test` and `expect` — every test imports from here
```

## Writing a test

```ts
import { test, expect } from '@fixtures';
import { getOrderStatus } from '@db/queries/hub/orders';

test('cancels an order', async ({ unifiedApi, db }) => {
  const response = await unifiedApi.orders.cancel(orderId);
  expect(response.status()).toBe(200);
  expect(await getOrderStatus(db.hub, orderId)).toBe('cancelled');
});
```

Available fixtures: `db` (`db.hub`, `db.checkout`), `cleanup`, `unifiedApi`, `customerApi`,
and page objects (`loginPage`, `orderListPage`, `checkoutPage`).

Rules (enforced by `npm run lint`):

- No fixed waits (`page.waitForTimeout`). Wait for the thing itself: `expect(locator).toBeVisible()`,
  or `expect.poll(() => getOrderStatus(...)).toBe('fulfilled')` for background jobs.
- SQL values go in parameters (`$1`), never into the string.
- Anything a test changes globally (crons, company settings) gets a `cleanup.add(...)` right after.
- A suite does not import another suite's page objects or API client.

## Databases

All suites can use every database through `db`. To add one, add an entry to
`src/db/databases.ts`, its variables to `src/config/env.ts` and `.env.example`, and it
appears as `db.<name>` everywhere.

## CI

GitHub Actions → **Run tests** → pick a suite. Values come from repository secrets with the
same names as in `.env.example`. Runs never overlap, because suites share one dev database.

## Migration status

All Cypress tests are migrated (231 Playwright tests incl. 2 setup steps):

| Suite | Cypress | Playwright | Notes |
|---|---|---|---|
| unified-api | 81 | 74 | chains that passed ids via Cypress.env merged into one test with steps |
| customer-api | 89 | 82 | same |
| hub-e2e | 63 | 61 + login setup | return → repair → stock is one test |
| checkout-e2e | 12 | 12 + wake-up setup | one spec per payment provider |

Behaviour changes on purpose:

- Fixed waits (cy.wait) are replaced by waiting for the actual result (locator, URL or database row).
- Tests that "passed by default" when no suitable data existed now report **skipped** with the reason.
- Global changes (crons, subscription type/quantity) are undone by the cleanup fixture, also when the test fails.
- The two cron tests share one file and run in order; Cypress passed the invoice ids through a fixture file.

Not migrated: unified-customer-api had support code for access-keys and csv but no spec files.

First-time setup also needs Playwright's video binary: `npx playwright install ffmpeg`.
