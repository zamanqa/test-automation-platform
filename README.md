# test-automation-platform

Playwright + TypeScript test automation for Circuly (development environment only).
One repository, six test suites, one shared code base, and a local test runner web page.

| Suite (Playwright project) | What it tests | Browser | Tests |
|---|---|---|---|
| `hub-e2e` | Hub (admin) UI: orders, subscriptions, invoices, customers, products, returns/repairs, debt collection, crons | Google Chrome | 116 + login setup |
| `checkout-e2e` | Checkout UI and payments (Stripe, Adyen, Braintree, Mollie) | Google Chrome | 22 + wake-up setup |
| `pos-e2e` | POS portal: login, create order (quote), order list, start subscription, filters | Google Chrome | 17 |
| `css-e2e` | Customer self-service portal: login from hub, outstanding amount, refer a friend, add product, update payment method, cancel / report issue | Google Chrome | 11 |
| `customer-api` | Customer API (basic auth) | none | 96 |
| `unified-api` | Unified Customer API (JWT) | none | 74 |

Total: 338 tests.

## 1. Requirements

- **Node.js 22 or newer** (`node -v`)
- **Google Chrome** installed (tests use the installed Chrome, `channel: 'chrome'`)
- Git
- Network access to the Circuly development environment and the dev PostgreSQL database
- Optional: [Claude Code CLI](https://claude.com/claude-code), logged in, for the runner's "Ask Claude" button

## 2. Install

```bash
git clone https://github.com/zamanqa/test-automation-platform.git
cd test-automation-platform
npm install
npx playwright install ffmpeg      # once: needed to record videos of failed tests
```

On Windows, if PowerShell blocks `npm`, use `npm.cmd` instead.

## 3. Files you must add after installing

These files are **not** in the repository (they hold passwords or are created by the tests).
They are listed in `.gitignore` — never commit them.

### 3.1 `.env` (required — you create it)

Copy the template and fill in every value:

```bash
cp .env.example .env               # Windows PowerShell: Copy-Item .env.example .env
```

| Group | Variables | Needed by |
|---|---|---|
| Hub UI | `HUB_URL`, `HUB_USER_EMAIL`, `HUB_USER_PASSWORD`, `HUB_COMPANY_NAME`, `HUB_API_HEALTH_URL` | hub-e2e, css-e2e |
| Hub (Lumen) API — crons | `HUB_API_BASE_URL`, `HUB_API_EMAIL`, `HUB_API_PASSWORD` | hub-e2e (cron tests) |
| Checkout | `CHECKOUT_URL`, `CHECKOUT_API_URL` | checkout-e2e, css-e2e |
| CSS | `CSS_URL` | css-e2e |
| POS | `POS_URL`, `POS_LOCATION_ID`, `POS_PASSWORD` | pos-e2e |
| Customer API | `CUSTOMER_API_BASE_URL`, `CUSTOMER_API_VERSION`, `CUSTOMER_API_USERNAME`, `CUSTOMER_API_PASSWORD`, `CUSTOMER_API_COMPANY_ID` | customer-api |
| Unified API | `UNIFIED_API_BASE_URL`, `UNIFIED_API_VERSION`, `UNIFIED_API_CONSUMER_KEY`, `UNIFIED_API_CONSUMER_SECRET` | unified-api |
| Hub database | `HUB_DB_HOST`, `HUB_DB_PORT`, `HUB_DB_NAME`, `HUB_DB_USER`, `HUB_DB_PASSWORD` | all suites that check data |
| Checkout database | `CHECKOUT_DB_HOST`, `CHECKOUT_DB_PORT`, `CHECKOUT_DB_NAME`, `CHECKOUT_DB_USER`, `CHECKOUT_DB_PASSWORD` | not used yet (leave empty) |
| Test data | `TEST_DATA_PREFIX` (keep `qa_auto_`) | all |

Ask the project owner for the values. Each group is checked the first time a test uses it,
so to run only the API suites you only need the API, database and test-data groups.

### 3.2 `.auth/` folder (created automatically — do not add by hand)

| File | Created by | Purpose |
|---|---|---|
| `.auth/hub.json` | `tests/hub-e2e/auth.setup.ts` (first hub or CSS run) | saved hub login, reused for 24 hours. `npm run hub:login` forces a new login |
| `.auth/css-data.json` | `tests/css-e2e/01-css-login.spec.ts` | the CSS test customer, order and subscriptions used by css-e2e files 02–99 |

### 3.3 `reports/` folder (created automatically)

Every run writes `reports/<suite>/<start time>/`. Runs older than 3 days are deleted.

### 3.4 GitHub Actions secrets (only for running in CI)

Repository → Settings → Secrets and variables → Actions: add one secret per `.env` variable,
with the same name.

## 4. Check the setup

```bash
npm run typecheck && npm run lint
npx playwright test --project=unified-api --reporter=line --list    # lists the tests, runs nothing
npx playwright test --project=customer-api health.spec --reporter=line   # read-only smoke test
```

## 5. Run tests

> The tests use the shared **dev database** and change real rows (orders, subscriptions, crons).
> Run one suite at a time, and never run two runs at once from the same folder.

```bash
npm run runner             # test runner web page: http://localhost:4455
npm run test:ui            # Playwright UI mode (for writing tests)

npm run hub                # hub, headless          npm run hub:headed
npm run checkout           # checkout, headed       npm run checkout:headless
npm run stripe | adyen | braintree | mollie        # one payment provider, headed
npm run pos                # POS, headless          npm run pos:headed
npm run css                # CSS, headless          npm run css:headed
npm run api:customer       # customer API (no browser)
npm run api:unified        # unified API (no browser)

npx playwright test --project=hub-e2e -g "opens the Draft tab"      # one test by name
npx playwright test tests/hub-e2e/orders/order-list.spec.ts:96 --project=hub-e2e --headed
npx playwright test --project=hub-e2e --last-failed                  # only last failures
```

Headless runs use a 1920 × 1080 page. `--headed` and `--debug` open a maximized Chrome that fits the screen.
css-e2e files run in name order: `01-css-login` creates the data, `99-cancel-and-report` runs last.

### Test runner (`npm run runner`)

A local web page (`runner/server.js` + `runner/index.html`, only on 127.0.0.1:4455):

- Choose suite → all / one file / one test / last failed → headless or headed → **Run**, **+ Add to queue**, **Stop**
- **🐞 Debug** (UI suites): opens Chrome + Playwright Inspector, paused before each test (F10 step, F8 resume)
- Live log and progress, rerun failed tests, env check, notification when a run ends
- Reports (open, PDF, zip, delete, compare two runs), History, Settings
- Test list updates by itself when files in `tests/` change
- **🤖 Ask Claude** on a failed test proposes a fix; **Apply fix** edits the file (with backup + Undo) and reruns the test

Stop switches all crons back on.

## 6. Reports

```bash
npm run summary            # reports/index.html — every suite, runs of the last 3 days
npm run report             # Playwright report of the newest run (screenshots, video, trace)
npm run report -- hub-e2e  # newest run of one suite
```

```
reports/<suite>/<YYYY-MM-DD_HH-mm-ss>/
  index.html       summary + error log
  html-report/     Playwright report
  test-results/    screenshots, videos, traces of failed tests
  summary.json
```

## 7. Project layout

```
playwright.config.ts       suites (projects), browsers, timeouts, report folder
tests/<suite>/             test files (*.spec.ts) + setup files
src/fixtures/index.ts      `test` and `expect` — every test imports from here (the wiring point)
src/config/env.ts          every .env variable, checked per group
src/config/paths.ts        .auth file locations
src/db/databases.ts        the list of databases (hub, checkout)
src/db/connection.ts       database connections
src/db/queries/hub/        SQL queries, one file per table/area
src/db/cleanup.ts          undo steps that run after a test, also when it fails
src/api/                   API clients: unified-api, customer-api, hub-api (+ endpoints/)
src/pages/                 page objects: hub/, checkout/ (+ payment/), pos/, css/
src/data/                  API payloads, fixed values, random test data (prefixed qa_auto_)
src/reporters/             summary reporter (reports/index.html)
runner/                    test runner web page (server.js, index.html, claude.js)
scripts/open-report.js     npm run report
.github/workflows/         GitHub Actions: "Run tests" (manual, pick a suite)
CLAUDE.md                  project notes and facts found while writing the tests
```

## 8. Writing a test

```ts
import { test, expect } from '@fixtures';
import { getOrderStatus } from '@db/queries/hub/orders';

test('cancels an order', async ({ unifiedApi, db }) => {
  // SETUP
  const orderId = ...;                       // pick data with a query from src/db/queries
  // ACTION
  const response = await unifiedApi.orders.cancel(orderId);
  // CHECK
  expect(response.status()).toBe(200);
  await expect.poll(() => getOrderStatus(db.hub, orderId)).toBe('cancelled');
});
```

Fixtures: `db` (`db.hub`), `hubCompanyId`, `cleanup`, `unifiedApi`, `customerApi`, `hubApi`, and one fixture per
page object (`orderListPage`, `customerPage`, `checkoutPage`, `posPage`, `cssPage`, ... — see `src/fixtures/index.ts`).

Rules (most are checked by `npm run lint`):

- Import `test` and `expect` from `@fixtures`, never from `@playwright/test`.
- No fixed waits: wait for a locator, a URL, or `expect.poll(() => query())`.
- SQL values go in parameters (`$1`), never into the SQL string.
- Queries that pick test data skip rows starting with `qa_auto` (`NOT LIKE 'qa_auto%'`).
- No suitable data → `test.skip(!row, 'reason')`, never a silent pass.
- Anything changed globally (crons, settings) gets a `cleanup.add(...)` right after.
- A suite does not import another suite's page objects or API client.
- Keep tests simple: one action per line, comments `// SETUP`, `// ACTION`, `// CHECK`.

## 9. CI

GitHub → **Actions** → **Run tests** → **Run workflow** → pick a suite. Uses the repository secrets (3.4).
Only one run at a time, because all suites share one dev database.
