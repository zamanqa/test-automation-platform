import { test as base, expect } from '@playwright/test';
import { env } from '@config/env';
import { createDatabases, type Databases } from '@db/connection';
import { findCompanyIdByName } from '@db/queries/hub/companies';
import { Cleanup } from '@db/cleanup';
import { UnifiedApiClient } from '@api/unified-api/UnifiedApiClient';
import { CustomerApiClient } from '@api/customer-api/CustomerApiClient';
import { HubApiClient } from '@api/hub-api/HubApiClient';
import { LoginPage } from '@pages/hub/LoginPage';
import { OrderListPage } from '@pages/hub/OrderListPage';
import { OrderDetailPage } from '@pages/hub/OrderDetailPage';
import { OrderCreationPage } from '@pages/hub/OrderCreationPage';
import { OrderWorkflowPage } from '@pages/hub/OrderWorkflowPage';
import { SubscriptionListPage } from '@pages/hub/SubscriptionListPage';
import { SubscriptionDetailPage } from '@pages/hub/SubscriptionDetailPage';
import { InvoiceListPage } from '@pages/hub/InvoiceListPage';
import { ReturnsAndRepairsPage } from '@pages/hub/ReturnsAndRepairsPage';
import { CustomerPage } from '@pages/hub/CustomerPage';
import { ProductPage } from '@pages/hub/ProductPage';
import { DebtCollectionPage } from '@pages/hub/DebtCollectionPage';
import { CheckoutPage } from '@pages/checkout/CheckoutPage';
import { PosPage } from '@pages/pos/PosPage';
import { CssPage } from '@pages/css/CssPage';
import { StripePayment } from '@pages/checkout/payment/StripePayment';
import { AdyenPayment } from '@pages/checkout/payment/AdyenPayment';
import { BraintreePayment } from '@pages/checkout/payment/BraintreePayment';
import { MolliePayment } from '@pages/checkout/payment/MolliePayment';

/**
 * Every test imports `test` and `expect` from here, never from @playwright/test:
 *
 *   import { test, expect } from '@fixtures';
 *   test('...', async ({ db, unifiedApi, cleanup }) => { ... });
 *
 * Fixtures are created only when a test asks for them, so an API test never opens
 * a browser and a UI test that does not use `db` never connects to a database.
 *
 * HOW EVERYTHING CONNECTS — this file is the wiring point:
 *
 *   test file  ──asks for──►  fixture name (below)  ──creates──►  class instance
 *
 *   { db }                 → createDatabases()        src/db/connection.ts   (reads src/db/databases.ts → src/config/env.ts)
 *   { hubCompanyId }       → findCompanyIdByName()    src/db/queries/hub/companies.ts   (uses the db fixture)
 *   { unifiedApi }         → new UnifiedApiClient()   src/api/unified-api/   (extends BaseApiClient)
 *   { customerApi }        → new CustomerApiClient()  src/api/customer-api/  (extends BaseApiClient)
 *   { hubApi }             → new HubApiClient()       src/api/hub-api/       (extends BaseApiClient)
 *   { cleanup }            → new Cleanup()            src/db/cleanup.ts
 *   { orderListPage } ...  → new OrderListPage(page)  src/pages/hub/...      (gets Playwright's `page`)
 *   { checkoutPage } ...   → new CheckoutPage(page)   src/pages/checkout/...
 *   { posPage } ...        → new PosPage(page)        src/pages/pos/PosPage.ts
 *   { cssPage }            → new CssPage(page)        src/pages/css/CssPage.ts
 *
 * Two lifetimes:
 *   scope 'worker' → created ONCE per worker process and shared by all its tests
 *                    (database pools, API clients with their login token).
 *   test-scoped    → created fresh for EVERY test, then torn down (pages, cleanup).
 *
 * Every fixture follows the same shape:
 *   async ({ other fixtures it needs }, use) => {
 *     const thing = ...create...;   // 1. setup   — runs before the test
 *     await use(thing);             // 2. the test runs here, receiving `thing`
 *     ...teardown...;               // 3. teardown — runs after the test, even if it failed
 *   }
 */

type WorkerFixtures = {
  /** Every database from src/db/databases.ts: db.hub, db.checkout ... One pool per worker. */
  db: Databases;
  /** company_id of HUB_COMPANY_NAME — the company the hub tests are logged into. */
  hubCompanyId: string;
  unifiedApi: UnifiedApiClient;
  customerApi: CustomerApiClient;
  /** Hub (Lumen) API, for triggering crons. */
  hubApi: HubApiClient;
};

type TestFixtures = {
  /** Undo steps that run after the test, even when it fails. */
  cleanup: Cleanup;

  // hub pages
  loginPage: LoginPage;
  orderListPage: OrderListPage;
  orderDetailPage: OrderDetailPage;
  orderCreationPage: OrderCreationPage;
  orderWorkflowPage: OrderWorkflowPage;
  subscriptionListPage: SubscriptionListPage;
  subscriptionDetailPage: SubscriptionDetailPage;
  invoiceListPage: InvoiceListPage;
  returnsAndRepairsPage: ReturnsAndRepairsPage;
  customerPage: CustomerPage;
  productPage: ProductPage;
  debtCollectionPage: DebtCollectionPage;

  // checkout pages
  checkoutPage: CheckoutPage;
  posPage: PosPage;
  cssPage: CssPage;
  stripePayment: StripePayment;
  adyenPayment: AdyenPayment;
  braintreePayment: BraintreePayment;
  molliePayment: MolliePayment;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ---------- worker-scoped: created once per worker, shared by its tests ----------
  db: [
    async ({}, use) => {
      const db = createDatabases();
      await use(db);
      await db.closeAll();
    },
    { scope: 'worker' },
  ],

  hubCompanyId: [
    async ({ db }, use) => {
      await use(await findCompanyIdByName(db.hub, env.hub.HUB_COMPANY_NAME));
    },
    { scope: 'worker' },
  ],

  // API clients: `playwright.request.newContext()` is Playwright's HTTP client (no browser).
  // It is passed to the client's constructor → BaseApiClient stores it as `this.request`.
  unifiedApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new UnifiedApiClient(request)); // token is cached for the whole worker
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  customerApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new CustomerApiClient(request));
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  hubApi: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext();
      await use(new HubApiClient(request));
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  // ---------- test-scoped ----------
  // `cleanup` collects undo steps during the test (cleanup.add(...)) and runs them
  // after `use` returns — i.e. after the test, pass or fail.
  cleanup: async ({}, use) => {
    const cleanup = new Cleanup();
    await use(cleanup);
    await cleanup.runAll();
  },

  // Page objects: `page` is Playwright's built-in browser tab fixture. Each page object
  // receives it in its constructor and builds its locators from it.
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  orderListPage: async ({ page }, use) => use(new OrderListPage(page)),
  orderDetailPage: async ({ page }, use) => use(new OrderDetailPage(page)),
  orderCreationPage: async ({ page }, use) => use(new OrderCreationPage(page)),
  orderWorkflowPage: async ({ page }, use) => use(new OrderWorkflowPage(page)),
  subscriptionListPage: async ({ page }, use) => use(new SubscriptionListPage(page)),
  subscriptionDetailPage: async ({ page }, use) => use(new SubscriptionDetailPage(page)),
  invoiceListPage: async ({ page }, use) => use(new InvoiceListPage(page)),
  returnsAndRepairsPage: async ({ page }, use) => use(new ReturnsAndRepairsPage(page)),
  customerPage: async ({ page }, use) => use(new CustomerPage(page)),
  productPage: async ({ page }, use) => use(new ProductPage(page)),
  debtCollectionPage: async ({ page }, use) => use(new DebtCollectionPage(page)),
  checkoutPage: async ({ page }, use) => use(new CheckoutPage(page)),
  posPage: async ({ page }, use) => use(new PosPage(page)),
  cssPage: async ({ page }, use) => use(new CssPage(page)),
  stripePayment: async ({ page }, use) => use(new StripePayment(page)),
  adyenPayment: async ({ page }, use) => use(new AdyenPayment(page)),
  braintreePayment: async ({ page }, use) => use(new BraintreePayment(page)),
  molliePayment: async ({ page }, use) => use(new MolliePayment(page)),
});

export { expect };
